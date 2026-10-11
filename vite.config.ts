import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Percorsi relativi: l'app Capacitor serve i file dalla radice del WebView.
  base: './',
  // onnxruntime-web carica da solo i suoi .mjs/.wasm: va lasciato fuori dal pre-bundling.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { environment: 'jsdom' },
});
