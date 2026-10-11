import { Capacitor } from '@capacitor/core';
import { downloadBlob, readCached, readResponse, writeCached } from './modelStore';

/**
 * Restituisce un file del modello cercandolo, in ordine, in: cache del dispositivo, file inclusi
 * nell'app / serviti dalla stessa origine (`local`), indirizzo remoto (`remote`).
 * La cache usa `remote` come chiave, così lo stato "scaricata" è lo stesso in ogni caso.
 */
export async function getFile(
  remote: string,
  local: string,
  expectedBytes: number,
  minBytes: number,
  onProgress: (loaded: number, total: number) => void,
): Promise<Blob> {
  const cached = await readCached(remote);
  if (cached && cached.size >= minBytes) return cached;

  try {
    const response = await fetch(local);
    const type = response.headers.get('content-type') ?? '';
    if (response.ok && !type.includes('text/html')) {
      const blob = await readResponse(response, expectedBytes, onProgress);
      if (blob.size >= minBytes) {
        // Nell'APK i file inclusi sono già sul telefono: non si duplicano in cache.
        if (!Capacitor.isNativePlatform()) await writeCached(remote, blob);
        return blob;
      }
    }
  } catch {
    /* non disponibile in locale: si scarica */
  }

  const blob = await downloadBlob(remote, expectedBytes, onProgress);
  await writeCached(remote, blob);
  return blob;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

export function pcmToWav(pcm: Float32Array, sampleRate: number): Blob {
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

export function concatPcm(pieces: Float32Array[]): Float32Array {
  const total = pieces.reduce((n, p) => n + p.length, 0);
  const pcm = new Float32Array(total);
  let offset = 0;
  for (const piece of pieces) {
    pcm.set(piece, offset);
    offset += piece.length;
  }
  return pcm;
}
