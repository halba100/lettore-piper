/**
 * Archivio dei modelli vocali scaricati. Usa Cache Storage (disponibile nel WebView Android
 * e in ogni browser su origine sicura). Se manca, il modello viene riscaricato a ogni avvio.
 */
const CACHE_NAME = 'piper-models-v1';

function available(): boolean {
  return typeof caches !== 'undefined';
}

export async function readCached(url: string): Promise<Blob | null> {
  if (!available()) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

export async function isCached(url: string): Promise<boolean> {
  if (!available()) return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(url)) !== undefined;
  } catch {
    return false;
  }
}

export async function writeCached(url: string, blob: Blob): Promise<void> {
  if (!available()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, new Response(blob));
    // Chiede al sistema di non eliminare i dati quando lo spazio scarseggia.
    await navigator.storage?.persist?.();
  } catch (error) {
    console.warn('Impossibile salvare il modello in cache', error);
  }
}

export async function deleteCached(url: string): Promise<void> {
  if (!available()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(url);
  } catch {
    /* niente da fare */
  }
}

export async function downloadBlob(
  url: string,
  expectedBytes: number,
  onProgress: (loaded: number, total: number) => void,
): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download non riuscito (HTTP ${response.status})`);
  const total = Number(response.headers.get('content-length')) || expectedBytes;
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  return new Blob(parts as BlobPart[]);
}
