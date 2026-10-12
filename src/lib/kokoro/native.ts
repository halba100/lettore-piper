/** Ponte verso il plugin Android KokoroNativePlugin (ONNX Runtime nativo, più thread). */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface KokoroNativePlugin {
  status(): Promise<{ downloaded: boolean; bytes: number; cores: number }>;
  download(options: { urls: string[]; expectedBytes: number }): Promise<{ bytes: number }>;
  load(options: { threads?: number }): Promise<{ threads: number; cores: number }>;
  synth(options: { tokens: number[]; style: number[] }): Promise<{ pcm: string; samples: number; ms: number }>;
  release(): Promise<void>;
  addListener(
    event: 'progress',
    listener: (p: { loaded: number; total: number }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

export const KokoroNative = registerPlugin<KokoroNativePlugin>('KokoroNative');

export const nativeKokoroAvailable = () =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('KokoroNative');

/** PCM a 16 bit little-endian in base64 -> campioni float. */
export function decodePcm16(base64: string): Float32Array {
  const binary = atob(base64);
  const out = new Float32Array(binary.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const lo = binary.charCodeAt(2 * i);
    const hi = binary.charCodeAt(2 * i + 1);
    const s = (hi << 8) | lo;
    out[i] = (s >= 0x8000 ? s - 0x10000 : s) / 32768;
  }
  return out;
}
