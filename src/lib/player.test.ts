import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from './epub';

const synthCalls: string[] = [];
let synthDelayMs = 0;

vi.mock('./engine', () => ({
  isVoiceDownloaded: async () => false,
  loadEngine: vi.fn(async (voice: { id: string }) => ({
      voice,
      synth: async (text: string, pause: number) => {
        synthCalls.push(text);
        if (synthDelayMs) await new Promise((r) => setTimeout(r, synthDelayMs));
        return { blob: new Blob([text]), seconds: 1 + pause, elapsedMs: 10 };
      },
      dispose: async () => {},
    })),
}));

const { Player } = await import('./player');

const book: Book = {
  id: 'test',
  title: 'Prova',
  chapters: [
    {
      title: 'Uno',
      paragraphs: [
        { text: 'Titolo uno', heading: true },
        { text: 'Prima frase. Seconda frase con 1.250 metri.', heading: false },
        { text: 'Terza.', heading: false },
      ],
    },
    { title: 'Due', paragraphs: [{ text: 'Quarta frase del secondo capitolo.', heading: false }] },
  ],
};

async function until(check: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timeout in attesa della condizione');
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  synthCalls.length = 0;
  synthDelayMs = 0;
  let n = 0;
  URL.createObjectURL = () => `blob:test-${n++}`;
  URL.revokeObjectURL = () => {};
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    setTimeout(() => this.onended?.(new Event('ended')), 1);
    return Promise.resolve();
  };
});

describe('Player', () => {
  it('legge tutto il libro in ordine, passa al capitolo successivo e torna a riposo', async () => {
    const player = new Player();
    player.setBook(book);
    await player.play();
    await until(() => player.getSnapshot().status === 'idle' && synthCalls.length >= 5);

    expect(synthCalls).toEqual([
      'Titolo uno',
      'Prima frase.',
      'Seconda frase con 1250 metri.',
      'Terza.',
      'Quarta frase del secondo capitolo.',
    ]);
    expect(player.getSnapshot().chapter).toBe(1);
  });

  it('non sintetizza più di quanto serve: anticipa solo poche frasi', async () => {
    const player = new Player();
    player.setBook(book);
    HTMLMediaElement.prototype.play = () => new Promise<void>(() => {}); // l'audio non finisce mai
    await player.play();
    await until(() => synthCalls.length >= 4);
    await new Promise((r) => setTimeout(r, 50));
    expect(synthCalls).toHaveLength(4); // frase in ascolto + 3 di anticipo
    expect(player.getSnapshot().status).toBe('playing');
  });

  it('la pausa ferma la lettura e conserva la posizione', async () => {
    const player = new Player();
    player.setBook(book);
    HTMLMediaElement.prototype.play = () => new Promise<void>(() => {});
    await player.play();
    await until(() => player.getSnapshot().status === 'playing');
    player.pause();
    const state = player.getSnapshot();
    expect(state.status).toBe('paused');
    expect(state.para).toBe(0);
  });

  it('seek riparte dalla frase indicata', async () => {
    const player = new Player();
    player.setBook(book);
    await player.prepareVoice();
    player.seek(1, 1);
    await until(() => synthCalls.includes('Seconda frase con 1250 metri.'));
    expect(synthCalls[0]).toBe('Seconda frase con 1250 metri.');
  });

  it('cambiare capitolo da fermo non avvia la lettura', async () => {
    const player = new Player();
    player.setBook(book);
    player.goChapter(1);
    expect(player.getSnapshot().chapter).toBe(1);
    expect(player.getSnapshot().status).toBe('idle');
    expect(synthCalls).toHaveLength(0);
  });

  it('ricorda dove era arrivato quando si riapre il libro', () => {
    const player = new Player();
    player.setBook(book, 0, 2);
    expect(player.getSnapshot().para).toBe(2);
    player.setBook(book, 9, 99); // valori fuori intervallo vengono riportati nei limiti
    expect(player.getSnapshot().chapter).toBe(1);
    expect(player.getSnapshot().para).toBe(0);
  });

  it('mostra un errore leggibile se la sintesi fallisce', async () => {
    const player = new Player();
    player.setBook(book);
    synthDelayMs = 0;
    const mod = await import('./engine');
    vi.mocked(mod.loadEngine).mockRejectedValueOnce(new Error('Download non riuscito (HTTP 403)'));
    await player.play();
    expect(player.getSnapshot().status).toBe('error');
    expect(player.getSnapshot().error).toContain('Download non riuscito');
  });
});
