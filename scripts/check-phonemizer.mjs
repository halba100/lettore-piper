// Verifica che il fonemizzatore italiano (espeak-ng in WASM) funzioni, senza browser né modelli.
//   node scripts/check-phonemizer.mjs "Il Sig. Bellandi aspettava."
import { copyFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vendor', 'piper');
// Il file è uno script UMD pensato per il browser: in un progetto "type": "module" Node lo
// tratterebbe come ESM, quindi lo copiamo come .cjs per poterlo caricare.
const copy = join(mkdtempSync(join(tmpdir(), 'piper-')), 'piper_phonemize.cjs');
copyFileSync(join(dir, 'piper_phonemize.js'), copy);
const create = require(copy);

const text = process.argv[2] ?? 'La nave attraccò al molo tre poco dopo le sette e quarantacinque.';
const lines = [];
const errors = [];
const mod = await create({
  print: (l) => lines.push(l),
  printErr: (l) => errors.push(l),
  locateFile: (f) => join(dir, f),
});
try {
  mod.callMain(['-l', 'it', '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
} catch (e) {
  if (!lines.length) throw e;
}
console.log(`Testo: ${text}`);
console.log(`Righe di output: ${lines.length}`);
for (const l of lines) {
  const j = JSON.parse(l);
  console.log(`  ${j.phoneme_ids.length} id fonetici, primi 12: ${j.phoneme_ids.slice(0, 12).join(' ')}`);
}
if (errors.length) console.log('stderr:', errors.join(' ').slice(0, 200));
if (!lines.length) process.exit(1);
