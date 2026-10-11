/**
 * Motore Kokoro-82M (Apache-2.0, versione int8) nel WebView:
 *   testo -> fonemi IPA (espeak-ng WASM) -> token -> modello StyleTTS2 (ONNX Runtime Web) -> audio a 24 kHz.
 * Segue la logica di kokoro-onnx (MIT), con la stessa fonemizzazione e lo stesso vettore di stile per lunghezza.
 */
import type * as OrtTypes from 'onnxruntime-web/wasm';
import type { Engine, LoadProgress, SynthResult } from '../engine';
import { concatPcm, getFile, pcmToWav } from '../files';
import { getOrt } from '../ortRuntime';
import { phonemize, preloadPhonemizer } from '../phonemizer';
import {
  KOKORO_MODEL_BYTES,
  KOKORO_MODEL_URL,
  kokoroBundledModel,
  kokoroStyleUrl,
  type KokoroVoice,
} from '../voices';
import { MAX_TOKENS, SAMPLE_RATE, STYLE_DIM, joinPhonemes, prepareText, splitPhonemes, styleRow, tokenize, trimSilence } from './core';

export class KokoroEngine implements Engine {
  readonly voice: KokoroVoice;
  private session: OrtTypes.InferenceSession;
  private styles: Float32Array;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(voice: KokoroVoice, session: OrtTypes.InferenceSession, styles: Float32Array) {
    this.voice = voice;
    this.session = session;
    this.styles = styles;
  }

  static async load(voice: KokoroVoice, onProgress: (p: LoadProgress) => void): Promise<KokoroEngine> {
    getOrt();
    const styleResponse = await fetch(kokoroStyleUrl(voice));
    if (!styleResponse.ok) throw new Error(`Voce ${voice.name} non trovata nell'app (HTTP ${styleResponse.status})`);
    const styles = new Float32Array(await styleResponse.arrayBuffer());
    if (styles.length !== MAX_TOKENS * STYLE_DIM) throw new Error(`File della voce ${voice.name} non valido`);

    const modelBlob = await getFile(KOKORO_MODEL_URL, kokoroBundledModel(), KOKORO_MODEL_BYTES, 50_000_000, (loaded, total) =>
      onProgress({ phase: 'download', loaded, total }),
    );
    onProgress({ phase: 'init', loaded: 0, total: 1 });
    const ort = getOrt();
    const session = await ort.InferenceSession.create(await modelBlob.arrayBuffer(), { executionProviders: ['wasm'] });
    await preloadPhonemizer();
    return new KokoroEngine(voice, session, styles);
  }

  /** Per i test e per usi senza rete: costruisce il motore da dati già in memoria. */
  static fromParts(voice: KokoroVoice, session: OrtTypes.InferenceSession, styles: Float32Array): KokoroEngine {
    return new KokoroEngine(voice, session, styles);
  }

  synth(text: string, pauseAfterSeconds = 0.2): Promise<SynthResult> {
    const run = () => this.synthNow(text, pauseAfterSeconds);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async synthNow(text: string, pauseAfterSeconds: number): Promise<SynthResult> {
    const started = performance.now();
    const ort = getOrt();
    const lines = await phonemize(prepareText(text), 'it');
    const phonemes = joinPhonemes(lines.map((l) => l.phonemes));

    const pieces: Float32Array[] = [];
    for (const chunk of splitPhonemes(phonemes)) {
      const ids = tokenize(chunk);
      if (!ids.length) continue;
      const tokens = BigInt64Array.from([0n, ...ids.map((id) => BigInt(id)), 0n]);
      const output = await this.session.run({
        tokens: new ort.Tensor('int64', tokens, [1, tokens.length]),
        style: new ort.Tensor('float32', styleRow(this.styles, ids.length), [1, STYLE_DIM]),
        speed: new ort.Tensor('float32', Float32Array.from([1]), [1]),
      });
      const audio = output[this.session.outputNames[0]].data as Float32Array;
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
      await this.session.release();
    } catch {
      /* già rilasciata */
    }
  }
}
