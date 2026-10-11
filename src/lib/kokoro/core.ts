/** Parti di Kokoro che non dipendono dal browser: così si possono provare con i test. */
import vocab from './vocab.json';

export const SAMPLE_RATE = 24000;
export const MAX_TOKENS = 510;
export const STYLE_DIM = 256;
/** Sotto questo numero di simboli per blocco restiamo lontani dal limite del modello. */
const CHUNK_SYMBOLS = 400;

const VOCAB = vocab as Record<string, number>;

/**
 * espeak-ng elimina i puntini di sospensione e attacca le parole ai due lati ("sˈɔfˈorse"):
 * li trasformiamo in una virgola, che produce una breve pausa.
 */
export function prepareText(text: string): string {
  return text
    .replace(/\s*(?:\.{2,}|…)\s*/g, ', ')
    .replace(/,\s*([.!?;:])/g, '$1')
    .replace(/,\s*$/, '')
    .trim();
}

/**
 * Unisce le righe IPA di espeak come fa il fonemizzatore Python di riferimento:
 * una riga per frase, spazio dopo la punteggiatura, spazi ripetuti ridotti a uno.
 */
export function joinPhonemes(lines: string[]): string {
  return lines
    .join(' ')
    .replace(/([.!?])(?=\S)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Simboli IPA -> id del vocabolario di Kokoro. I simboli sconosciuti vengono ignorati. */
export function tokenize(phonemes: string): number[] {
  const ids: number[] = [];
  for (const ch of phonemes) {
    const id = VOCAB[ch];
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/** Divide una stringa IPA troppo lunga in blocchi, andando a capo sugli spazi. */
export function splitPhonemes(phonemes: string, max = CHUNK_SYMBOLS): string[] {
  const symbols = Array.from(phonemes);
  if (symbols.length <= max) return [phonemes];
  const chunks: string[] = [];
  let start = 0;
  while (start < symbols.length) {
    let end = Math.min(start + max, symbols.length);
    if (end < symbols.length) {
      let cut = end;
      while (cut > start && symbols[cut] !== ' ') cut--;
      if (cut > start) end = cut;
    }
    const piece = symbols.slice(start, end).join('').trim();
    if (piece) chunks.push(piece);
    start = end;
  }
  return chunks;
}

/** Il modello vuole il vettore di stile scelto in base al numero di token. */
export function styleRow(styles: Float32Array, tokenCount: number): Float32Array {
  const index = Math.min(Math.max(tokenCount, 1), MAX_TOKENS) - 1;
  return styles.slice(index * STYLE_DIM, (index + 1) * STYLE_DIM);
}

/** Toglie il silenzio in testa e in coda (con un piccolo margine) per avere pause regolate da noi. */
export function trimSilence(pcm: Float32Array, threshold = 0.004, headMs = 15, tailMs = 40): Float32Array {
  let first = 0;
  let last = pcm.length - 1;
  while (first < pcm.length && Math.abs(pcm[first]) < threshold) first++;
  while (last > first && Math.abs(pcm[last]) < threshold) last--;
  if (first >= pcm.length) return pcm.slice(0, 0);
  const head = Math.round((SAMPLE_RATE * headMs) / 1000);
  const tail = Math.round((SAMPLE_RATE * tailMs) / 1000);
  return pcm.slice(Math.max(0, first - head), Math.min(pcm.length, last + 1 + tail));
}
