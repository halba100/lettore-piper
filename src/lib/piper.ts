/**
 * Motore di sintesi Piper che gira interamente nel WebView:
 *   testo -> fonemi (espeak-ng compilato in WASM) -> modello VITS (ONNX Runtime Web) -> audio WAV.
 *
 * La logica di inferenza segue @diffusionstudio/vits-web e @mintplex-labs/piper-tts-web (MIT),
 * ma legge modello e WASM da posizioni scelte da noi, così l'app può funzionare senza rete.
 */
import * as ort from 'onnxruntime-web/wasm';
import {
  bundledConfig,
  bundledOnnx,
  remoteConfig,
  remoteOnnx,
  type VoiceDef,
} from './voices';
import { downloadBlob, readCached, writeCached } from './modelStore';

export interface LoadProgress {
  phase: 'download' | 'init';
  loaded: number;
  total: number;
}

export interface SynthResult {
  blob: Blob;
  /** Durata dell'audio generato, in secondi. */
  seconds: number;
  /** Tempo impiegato dalla sintesi, in millisecondi. */
  elapsedMs: number;
}

interface ModelConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers: number;
}

type PhonemizerModule = {
  callMain: (args: string[]) => void;
};
type PhonemizerFactory = (options: {
  print: (line: string) => void;
  printErr: (line: string) => void;
  locateFile: (file: string) => string;
}) => Promise<PhonemizerModule>;

declare global {
  interface Window {
    createPiperPhonemize?: PhonemizerFactory;
  }
}

const assetUrl = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href;

/* ---------- fonemizzatore (espeak-ng in WASM, caricato come script classico) ---------- */

let phonemizerLoading: Promise<PhonemizerFactory> | null = null;

function loadPhonemizer(): Promise<PhonemizerFactory> {
  if (window.createPiperPhonemize) return Promise.resolve(window.createPiperPhonemize);
  phonemizerLoading ??= new Promise<PhonemizerFactory>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = assetUrl('vendor/piper/piper_phonemize.js');
    script.onload = () =>
      window.createPiperPhonemize
        ? resolve(window.createPiperPhonemize)
        : reject(new Error('Fonemizzatore Piper non disponibile'));
    script.onerror = () => {
      phonemizerLoading = null;
      reject(new Error('Impossibile caricare il fonemizzatore (public/vendor/piper). Esegui "npm run assets".'));
    };
    document.head.appendChild(script);
  });
  return phonemizerLoading;
}

/** Restituisce una lista di sequenze di id fonetici: normalmente una sola per frase. */
async function phonemize(text: string, espeakVoice: string): Promise<number[][]> {
  const create = await loadPhonemizer();
  const lines: string[] = [];
  const errors: string[] = [];
  const module = await create({
    print: (line) => lines.push(line),
    printErr: (line) => errors.push(line),
    locateFile: (file) => {
      if (file.endsWith('.wasm')) return assetUrl('vendor/piper/piper_phonemize.wasm');
      if (file.endsWith('.data')) return assetUrl('vendor/piper/piper_phonemize.data');
      return file;
    },
  });
  try {
    module.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  } catch (error) {
    // Emscripten lancia ExitStatus a fine esecuzione: va bene se abbiamo già l'output.
    if (!lines.length) throw error;
  }
  const sequences = lines
    .map((line) => {
      try {
        return (JSON.parse(line) as { phoneme_ids?: number[] }).phoneme_ids ?? [];
      } catch {
        return [];
      }
    })
    .filter((ids) => ids.length > 0);
  if (!sequences.length) throw new Error(`Fonemizzazione fallita: ${errors.join(' ').slice(0, 160)}`);
  return sequences;
}

/* ---------- WAV ---------- */

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function pcmToWav(pcm: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/* ---------- caricamento del modello ---------- */

async function getFile(
  remote: string,
  bundled: string,
  expectedBytes: number,
  minBytes: number,
  onProgress: (loaded: number, total: number) => void,
): Promise<Blob> {
  const cached = await readCached(remote);
  if (cached && cached.size >= minBytes) return cached;

  // Modello incluso nell'app (public/models): nessun download.
  try {
    const response = await fetch(bundled);
    const type = response.headers.get('content-type') ?? '';
    if (response.ok && !type.includes('text/html')) {
      const blob = await response.blob();
      if (blob.size >= minBytes) return blob;
    }
  } catch {
    /* non incluso: si scarica */
  }

  const blob = await downloadBlob(remote, expectedBytes, onProgress);
  await writeCached(remote, blob);
  return blob;
}

let ortConfigured = false;
function configureOrt() {
  if (ortConfigured) return;
  // Il binario WASM di ONNX Runtime viene incluso da Vite nella build (nessuna CDN, nessun .mjs da caricare a runtime).
  // Senza cross-origin isolation (il caso del WebView) ONNX Runtime usa comunque un solo thread.
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  ortConfigured = true;
}

export class PiperEngine {
  readonly voice: VoiceDef;
  private session: ort.InferenceSession;
  private config: ModelConfig;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(voice: VoiceDef, session: ort.InferenceSession, config: ModelConfig) {
    this.voice = voice;
    this.session = session;
    this.config = config;
  }

  static async load(voice: VoiceDef, onProgress: (p: LoadProgress) => void): Promise<PiperEngine> {
    configureOrt();
    const configBlob = await getFile(remoteConfig(voice), bundledConfig(voice), 8_000, 500, () => {});
    const config = JSON.parse(await configBlob.text()) as ModelConfig;

    const modelBlob = await getFile(remoteOnnx(voice), bundledOnnx(voice), voice.onnxBytes, 1_000_000, (loaded, total) =>
      onProgress({ phase: 'download', loaded, total }),
    );
    onProgress({ phase: 'init', loaded: 0, total: 1 });
    const session = await ort.InferenceSession.create(await modelBlob.arrayBuffer(), {
      executionProviders: ['wasm'],
    });
    // Scalda il fonemizzatore: il primo caricamento è il più lento.
    await loadPhonemizer();
    return new PiperEngine(voice, session, config);
  }

  /** Sintetizza una frase. Le chiamate vengono messe in coda: il motore lavora una frase alla volta. */
  synth(text: string, pauseAfterSeconds = 0.2): Promise<SynthResult> {
    const run = () => this.synthNow(text, pauseAfterSeconds);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async synthNow(text: string, pauseAfterSeconds: number): Promise<SynthResult> {
    const started = performance.now();
    const sampleRate = this.config.audio.sample_rate;
    const sequences = await phonemize(text, this.config.espeak.voice);

    const pieces: Float32Array[] = [];
    for (let i = 0; i < sequences.length; i++) {
      const ids = sequences[i];
      const feeds: Record<string, ort.Tensor> = {
        input: new ort.Tensor('int64', BigInt64Array.from(ids.map((id) => BigInt(id))), [1, ids.length]),
        input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new ort.Tensor(
          'float32',
          Float32Array.from([
            this.config.inference.noise_scale,
            this.config.inference.length_scale,
            this.config.inference.noise_w,
          ]),
          [3],
        ),
      };
      if (this.config.num_speakers > 1) {
        feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
      }
      const output = await this.session.run(feeds);
      pieces.push(output.output.data as Float32Array);
      // Pausa tra due sequenze della stessa frase (es. dopo "Sig.").
      if (i < sequences.length - 1) pieces.push(new Float32Array(Math.round(sampleRate * 0.2)));
    }
    pieces.push(new Float32Array(Math.round(sampleRate * pauseAfterSeconds)));

    const total = pieces.reduce((n, p) => n + p.length, 0);
    const pcm = new Float32Array(total);
    let offset = 0;
    for (const piece of pieces) {
      pcm.set(piece, offset);
      offset += piece.length;
    }
    return {
      blob: pcmToWav(pcm, sampleRate),
      seconds: total / sampleRate,
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
