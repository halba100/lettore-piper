import type { VoiceDef } from './voices';

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

export interface Engine {
  readonly voice: VoiceDef;
  /** Sintetizza una frase. Le chiamate vengono messe in coda: il motore lavora una frase alla volta. */
  synth(text: string, pauseAfterSeconds?: number): Promise<SynthResult>;
  dispose(): Promise<void>;
}

export async function loadEngine(voice: VoiceDef, onProgress: (p: LoadProgress) => void): Promise<Engine> {
  if (voice.engine === 'kokoro') {
    const { KokoroEngine } = await import('./kokoro/kokoro');
    return KokoroEngine.load(voice, onProgress);
  }
  const { PiperEngine } = await import('./piper');
  return PiperEngine.load(voice, onProgress);
}
