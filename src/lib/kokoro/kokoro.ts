/**
 * Motore Kokoro-82M (Apache-2.0, versione int8) nel WebView:
 *   testo -> fonemi IPA (espeak-ng WASM) -> token -> modello StyleTTS2 (ONNX Runtime Web) -> audio a 24 kHz.
 * Segue la logica di kokoro-onnx (MIT), con la stessa fonemizzazione e lo stesso vettore di stile per lunghezza.
 */
import type { Engine, LoadProgress, SynthResult } from '../engine';
import { concatPcm, getFile, pcmToWav } from '../files';
import { KokoroNative, decodePcm16, nativeKokoroAvailable } from './native';
import { getOrt } from '../ortRuntime';
import { phonemize, preloadPhonemizer } from '../phonemizer';
import {
  KOKORO_MODEL_BYTES,
  KOKORO_MODEL_URL,
  KOKORO_ORIGINAL_URL,
  kokoroBundledModel,
  kokoroStyleUrl,
  type KokoroVoice,
} from '../voices';
import { MAX_TOKENS, SAMPLE_RATE, STYLE_DIM, joinPhonemes, prepareText, splitPhonemes, styleRow, tokenize, trimSilence } from './core';

/** Esegue il modello su una sequenza di token e restituisce i campioni a 24 kHz. */
type Runner = (tokens: number[], style: Float32Array) => Promise<Float32Array>;

async function loadStyles(voice: KokoroVoice): Promise<Float32Array> {
  const response = await fetch(kokoroStyleUrl(voice));
  if (!response.ok) throw new Error(`Voce ${voice.name} non trovata nell'app (HTTP ${response.status})`);
  const styles = new Float32Array(await response.arrayBuffer());
  if (styles.length !== MAX_TOKENS * STYLE_DIM) throw new Error(`File della voce ${voice.name} non valido`);
  return styles;
}

export class KokoroEngine implements Engine {
  readonly voice: KokoroVoice;
  readonly info: string;
  private run: Runner;
  private releaseModel: () => Promise<void>;
  private styles: Float32Array;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(voice: KokoroVoice, styles: Float32Array, run: Runner, release: () => Promise<void>, info: string) {
    this.voice = voice;
    this.styles = styles;
    this.run = run;
    this.releaseModel = release;
    this.info = info;
  }

  static async load(voice: KokoroVoice, onProgress: (p: LoadProgress) => void): Promise<KokoroEngine> {
    const styles = await loadStyles(voice);
    if (nativeKokoroAvailable()) return KokoroEngine.loadNative(voice, styles, onProgress);
    return KokoroEngine.loadWasm(voice, styles, onProgress);
  }

  private static async loadNative(voice: KokoroVoice, styles: Float32Array, onProgress: (p: LoadProgress) => void) {
    const status = await KokoroNative.status();
    if (!status.downloaded) {
      const listener = await KokoroNative.addListener('progress', (p) =>
        onProgress({ phase: 'download', loaded: p.loaded, total: p.total }),
      );
      try {
        // Prima la pagina dell'app (stessa copia che usa il web), poi la release originale.
        await KokoroNative.download({ urls: [KOKORO_MODEL_URL, KOKORO_ORIGINAL_URL], expectedBytes: KOKORO_MODEL_BYTES });
      } finally {
        await listener.remove();
      }
    }
    onProgress({ phase: 'init', loaded: 0, total: 1 });
    const loaded = await KokoroNative.load({});
    await preloadPhonemizer();
    const run: Runner = async (tokens, style) =>
      decodePcm16((await KokoroNative.synth({ tokens, style: Array.from(style) })).pcm);
    return new KokoroEngine(voice, styles, run, () => KokoroNative.release(), `motore nativo, ${loaded.threads} thread su ${loaded.cores} core`);
  }

  private static async loadWasm(voice: KokoroVoice, styles: Float32Array, onProgress: (p: LoadProgress) => void) {
    const ort = getOrt();
    const modelBlob = await getFile(KOKORO_MODEL_URL, kokoroBundledModel(), KOKORO_MODEL_BYTES, 50_000_000, (loaded, total) =>
      onProgress({ phase: 'download', loaded, total }),
    );
    onProgress({ phase: 'init', loaded: 0, total: 1 });
    const session = await ort.InferenceSession.create(await modelBlob.arrayBuffer(), { executionProviders: ['wasm'] });
    await preloadPhonemizer();
    const run: Runner = async (tokens, style) => {
      const ids = BigInt64Array.from(tokens.map((t) => BigInt(t)));
      const output = await session.run({
        tokens: new ort.Tensor('int64', ids, [1, ids.length]),
        style: new ort.Tensor('float32', style, [1, STYLE_DIM]),
        speed: new ort.Tensor('float32', Float32Array.from([1]), [1]),
      });
      return output[session.outputNames[0]].data as Float32Array;
    };
    return new KokoroEngine(voice, styles, run, () => session.release(), 'motore del browser (lento)');
  }

  synth(text: string, pauseAfterSeconds = 0.2): Promise<SynthResult> {
    const run = () => this.synthNow(text, pauseAfterSeconds);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async synthNow(text: string, pauseAfterSeconds: number): Promise<SynthResult> {
    const started = performance.now();
    const lines = await phonemize(prepareText(text), 'it');
    const phonemes = joinPhonemes(lines.map((l) => l.phonemes));

    const pieces: Float32Array[] = [];
    for (const chunk of splitPhonemes(phonemes)) {
      const ids = tokenize(chunk);
      if (!ids.length) continue;
      const audio = await this.run([0, ...ids, 0], styleRow(this.styles, ids.length));
      pieces.push(trimSilence(audio));
      pieces.push(new Float32Array(Math.round(SAMPLE_RATE * 0.12))); // respiro tra i blocchi
    }
    if (!pieces.length) throw new Error('Niente da leggere in questa frase');
    pieces.pop();
    pieces.push(new Float32Array(Math.round(SAMPLE_RATE * pauseAfterSeconds)));

    const pcm = concatPcm(pieces);
    return {
      blob: pcmToWav(pcm, SAMPLE_RATE),
      seconds: pcm.length / SAMPLE_RATE,
      elapsedMs: performance.now() - started,
    };
  }

  async dispose(): Promise<void> {
    try {
      await this.releaseModel();
    } catch {
      /* già rilasciata */
    }
  }
}
