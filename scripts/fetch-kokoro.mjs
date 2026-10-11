// Scarica il modello Kokoro (int8) in public/models/ e ne controlla l'impronta SHA-256.
// Lo usa la build web su GitHub: il file viene pubblicato con l'app su Pages e il telefono lo scarica da lì.
//   node scripts/fetch-kokoro.mjs
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx';
const SHA256 = '6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb';
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'kokoro-v1.0.int8.onnx');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
if (existsSync(target) && sha(readFileSync(target)) === SHA256) {
  console.log('Modello Kokoro già presente e valido.');
  process.exit(0);
}
mkdirSync(dirname(target), { recursive: true });
console.log('Scarico Kokoro (92 MB)…');
const response = await fetch(URL_);
if (!response.ok) throw new Error(`Download non riuscito (HTTP ${response.status})`);
const data = Buffer.from(await response.arrayBuffer());
if (sha(data) !== SHA256) throw new Error('Impronta SHA-256 del modello diversa da quella attesa');
writeFileSync(target, data);
console.log('Modello Kokoro salvato in', target);
