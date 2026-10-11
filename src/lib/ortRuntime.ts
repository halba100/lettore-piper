import * as ort from 'onnxruntime-web/wasm';

let configured = false;

/** ONNX Runtime Web condiviso. Il binario WASM è incluso da Vite nella build (nessuna CDN). */
export function getOrt(): typeof ort {
  if (!configured) {
    // Senza cross-origin isolation (il caso del WebView) ONNX Runtime usa comunque un solo thread.
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    configured = true;
  }
  return ort;
}
