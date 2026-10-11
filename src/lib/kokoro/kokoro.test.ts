// @vitest-environment node
import { copyFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configurePhonemizer, phonemize } from '../phonemizer';
import { joinPhonemes, prepareText, splitPhonemes, styleRow, tokenize, trimSilence } from './core';
import fixtures from './fixtures.json';

const dir = join(process.cwd(), 'public', 'vendor', 'piper');

beforeAll(() => {
  const copy = join(mkdtempSync(join(tmpdir(), 'piper-')), 'piper_phonemize.cjs');
  copyFileSync(join(dir, 'piper_phonemize.js'), copy);
  configurePhonemizer({ factory: createRequire(import.meta.url)(copy), locate: (f) => join(dir, f) });
});

describe('fonemizzazione per Kokoro', () => {
  // Differenze note e innocue rispetto al fonemizzatore Python: il WASM scrive i trattini come ";",
  // toglie le parentesi e legge "7:45" come "sette e quarantacinque".
  const known: Record<string, string> = {
    'Non lo so... forse domani; forse mai.': 'non lo sˈɔ, fˈorse domˈanɪ; fˈorse mˈaj.',
    'Era il 12 ottobre 1998, alle 7:45 del mattino.':
      'ˌɛra il dˈoditʃɪ ˌɔtːˈobre mˈille novetʃˈɛnto novˈantˈɔtːo, ˌalle sˈɛtːe e kʊaɾˈaːntatʃˈinkwe del matːˈino.',
    "L'uomo — stanco e infreddolito — si sedette.": 'lwˈɔmo; stˈanko e infredːolˈito; sɪ sedˈetːe.',
    'Cosa pensi di fare (ammesso che tu pensi)?': 'kˈɔza pˈɛnsɪ dɪ fˈare ammˈesso ke tʊ pˈɛnsɪ?',
  };
  it.each(fixtures.map((f) => [f.text, f] as const))('come il riferimento Python: %s', async (_text, f) => {
    const lines = await phonemize(prepareText(f.text), 'it');
    const phonemes = joinPhonemes(lines.map((l) => l.phonemes));
    expect(phonemes).toBe(known[f.text] ?? f.phonemes);
    if (!known[f.text]) expect(tokenize(phonemes)).toEqual(f.tokens);
  });
});

describe('parti pure di Kokoro', () => {
  it('divide le frasi lunghe sugli spazi senza perdere simboli', () => {
    const text = Array.from({ length: 200 }, (_, i) => `parola${i}`).join(' ');
    const chunks = splitPhonemes(text, 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => Array.from(c).length <= 400)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });
  it('sceglie la riga di stile in base ai token', () => {
    const styles = Float32Array.from({ length: 510 * 256 }, (_, i) => Math.floor(i / 256));
    expect(styleRow(styles, 1)[0]).toBe(0);
    expect(styleRow(styles, 30)[255]).toBe(29);
    expect(styleRow(styles, 9999)[0]).toBe(509);
  });
  it('toglie il silenzio ai bordi', () => {
    const pcm = new Float32Array(24000);
    pcm.fill(0.5, 10000, 11000);
    const out = trimSilence(pcm);
    expect(out.length).toBeLessThan(1000 + 24000 * 0.06);
    expect(out.length).toBeGreaterThan(1000);
  });
});
