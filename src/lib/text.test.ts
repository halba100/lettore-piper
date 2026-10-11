import { describe, expect, it } from 'vitest';
import { hasSpeakableText, normalizeForSpeech, splitSentences } from './text';

describe('splitSentences', () => {
  it('divide su punto, esclamativo e interrogativo seguiti da spazio', () => {
    expect(splitSentences('Arrivò tardi. Chi era? Nessuno! Poi uscì.')).toEqual([
      'Arrivò tardi.',
      'Chi era?',
      'Nessuno!',
      'Poi uscì.',
    ]);
  });

  it('non spezza numeri con le migliaia né le abbreviazioni comuni', () => {
    expect(splitSentences('Camminò per 1.250 metri. Il Sig. Bellandi aspettava.')).toEqual([
      'Camminò per 1.250 metri.',
      'Il Sig. Bellandi aspettava.',
    ]);
  });

  it('tiene la chiusura delle virgolette con la frase', () => {
    expect(splitSentences('«Non succedeva dal 1998.» Poi tacque.')).toEqual(['«Non succedeva dal 1998.»', 'Poi tacque.']);
  });

  it('spezza le frasi molto lunghe sulle virgole, senza perdere testo', () => {
    const long = Array.from({ length: 40 }, (_, i) => `parola${i}`).join(', ') + '.';
    const parts = splitSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 220)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long);
  });

  it('restituisce una lista vuota per testo vuoto', () => {
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('normalizeForSpeech', () => {
  it('toglie il punto delle migliaia ma lascia i decimali', () => {
    expect(normalizeForSpeech('1.250 metri e 3,14')).toBe('1250 metri e 3,14');
    expect(normalizeForSpeech('1.250.000')).toBe('1250000');
  });

  it('rimuove virgolette a caporale e spazi doppi', () => {
    expect(normalizeForSpeech('«Ciao»,  disse.')).toBe('Ciao, disse.');
  });
});

describe('hasSpeakableText', () => {
  it('riconosce lettere e cifre', () => {
    expect(hasSpeakableText('...')).toBe(false);
    expect(hasSpeakableText('a')).toBe(true);
    expect(hasSpeakableText('42')).toBe(true);
  });
});
