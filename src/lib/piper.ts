/**
 * Motore di sintesi Piper che gira interamente nel WebView:
 *   testo -> fonemi (espeak-ng compilato in WASM) -> modello VITS (ONNX Runtime Web) -> audio WAV.
 *
 * La logica di inferenza segue @diffusionstudio/vits-web e @mintplex-labs/piper-tts-web (MIT),
 * ma legge modello e WASM da posizioni scelte da noi, così l'app può funzionare senza rete.
 */
import type * as OrtTypes from 'onnxruntime-web/wasm';
import { bundledConfig, bundledOnnx, remoteConfig, remoteOnnx, type PiperVoice } from './voices';
import type { Engine, LoadProgress, SynthResult } from './engine';
import { concatPcm, getFile, pcmToWav } from './files';
import { getOrt } from './ortRuntime';
import { phonemize, preloadPhonemizer } from './phonemizer';

interface ModelConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers: number;
}

export class PiperEngine implements Engine {
  readonly voice: PiperVoice;
  private session: OrtTypes.InferenceSession;
  private config: ModelConfig;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(voice: PiperVoice, session: OrtTypes.InferenceSession, config: ModelConfig) {
    this.voice = voice;
    this.session = session;
    this.config = config;
  }

  static async load(voice: PiperVoice, onProgress: (p: LoadProgress) => void): Promise<PiperEngine> {
    const ort = getOrt();
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
    await preloadPhonemizer();
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
    const ort = getOrt();
    const sequences = (await phonemize(text, this.config.espeak.voice)).map((l) => l.ids);

    const pieces: Float32Array[] = [];
    for (let i = 0; i < sequences.length; i++) {
      const ids = sequences[i];
      const feeds: Record<string, OrtTypes.Tensor> = {
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

    const pcm = concatPcm(pieces);
    const total = pcm.length;
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
