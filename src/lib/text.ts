const ABBREVIATIONS = /\b(Sigg?|Dott|Dr|Prof|Ing|Avv|Arch|Mons|Gen|Col|Sr|St|pag|art|cfr|ecc)\.\s/g;
const MAX_LEN = 220;

/**
 * Divide un paragrafo in frasi. Ogni frase diventa una "unità" di sintesi:
 * abbastanza corta da sintetizzare in fretta, abbastanza lunga da suonare naturale.
 * Il punto dentro un numero (1.250) e nelle abbreviazioni comuni (Sig. Rossi) non spezza la frase.
 */
export function splitSentences(text: string): string[] {
  const guarded = text.replace(ABBREVIATIONS, '$1.\u0002');
  const marked = guarded.replace(/([.!?…]+["»”’)\]]*)\s+/g, '$1\u0000');
  const out: string[] = [];
  for (const raw of marked.split('\u0000')) {
    let piece = raw.replace(/\u0002/g, ' ').trim();
    while (piece.length > MAX_LEN) {
      let cut = piece.lastIndexOf(', ', MAX_LEN - 20);
      if (cut < 80) cut = piece.lastIndexOf(' ', MAX_LEN - 20);
      if (cut < 1) cut = MAX_LEN - 20;
      out.push(piece.slice(0, cut + 1).trim());
      piece = piece.slice(cut + 1).trim();
    }
    if (piece) out.push(piece);
  }
  if (out.length) return out;
  const t = text.trim();
  return t ? [t] : [];
}

/** Ripulisce una frase per il fonemizzatore. Non cambia il testo mostrato a schermo. */
export function normalizeForSpeech(sentence: string): string {
  return sentence
    .replace(/­/g, '')
    .replace(/(\d)\.(?=\d{3}(?!\d))/g, '$1') // 1.250 -> 1250 (in italiano il punto separa le migliaia)
    .replace(/[«»“”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasSpeakableText(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s);
}
