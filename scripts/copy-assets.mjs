// Copia in public/vendor i file del fonemizzatore Piper (espeak-ng compilato in WASM),
// così l'app non dipende da nessuna CDN. Il runtime ONNX, invece, lo include Vite nella build.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', '@diffusionstudio', 'piper-wasm', 'build');
const to = join(root, 'public', 'vendor', 'piper');

if (!existsSync(from)) {
  console.warn(`[assets] non trovato: ${from} (esegui "npm install")`);
} else {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name.startsWith('piper_phonemize.')) cpSync(join(from, name), join(to, name));
  }
  console.log('[assets] fonemizzatore copiato in public/vendor/piper');
}
