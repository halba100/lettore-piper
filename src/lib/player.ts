import type { Book } from './epub';
import { hasSpeakableText, normalizeForSpeech, splitSentences } from './text';
import { loadEngine, type Engine, type LoadProgress } from './engine';
import { isCached } from './modelStore';
import { DEFAULT_VOICE_ID, VOICES, modelUrl, type VoiceDef } from './voices';
import { SAMPLE_BOOK } from './sample';

export type Status = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'error';

export interface PlayerState {
  status: Status;
  book: Book;
  chapter: number;
  para: number;
  sent: number;
  voiceId: string;
  rate: number;
  /** Avanzamento di download/preparazione del modello, quando in corso. */
  load: LoadProgress | null;
  /** Voci già scaricate sul dispositivo. */
  downloaded: Record<string, boolean>;
  /** Secondi di audio prodotti per ogni secondo di calcolo (media mobile). Sotto 1 la voce non regge il tempo reale. */
  rtf: number | null;
  error: string | null;
}

interface Unit {
  p: number;
  s: number;
  text: string;
  pauseAfter: number;
}

interface Ready {
  url: string;
  seconds: number;
}

/** Quante frasi, oltre a quella in ascolto, vengono sintetizzate in anticipo. */
const LOOKAHEAD = 3;

function buildUnits(book: Book, chapter: number): Unit[] {
  const units: Unit[] = [];
  book.chapters[chapter].paragraphs.forEach((paragraph, p) => {
    const sentences = splitSentences(paragraph.text);
    sentences.forEach((sentence, s) => {
      const last = s === sentences.length - 1;
      units.push({
        p,
        s,
        text: normalizeForSpeech(sentence),
        pauseAfter: paragraph.heading ? 0.7 : last ? 0.45 : 0.15,
      });
    });
  });
  return units;
}

export class Player {
  private state: PlayerState = {
    status: 'idle',
    book: SAMPLE_BOOK,
    chapter: 0,
    para: 0,
    sent: 0,
    voiceId: DEFAULT_VOICE_ID,
    rate: 1,
    load: null,
    downloaded: {},
    rtf: null,
    error: null,
  };

  private listeners = new Set<() => void>();
  private audio = new Audio();
  private engine: Engine | null = null;
  private engineLoading: { voiceId: string; promise: Promise<Engine> } | null = null;

  private units: Unit[] = buildUnits(SAMPLE_BOOK, 0);
  private cur = 0;
  private ready = new Map<number, Ready>();
  private generation = 0;
  private runToken = 0;
  private active = false;
  private pumping = false;
  private waiters = new Set<() => void>();
  private stopPlayback: (() => void) | null = null;

  constructor() {
    this.audio.preload = 'auto';
    void this.refreshDownloaded();
  }

  /* ---------- store per React ---------- */

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /* ---------- impostazioni ---------- */

  async refreshDownloaded() {
    const entries = await Promise.all(VOICES.map(async (v) => [v.id, await isCached(modelUrl(v))] as const));
    this.set({ downloaded: Object.fromEntries(entries) });
  }

  setRate(rate: number) {
    this.audio.defaultPlaybackRate = rate;
    this.audio.playbackRate = rate;
    this.set({ rate });
  }

  setVoice(voiceId: string) {
    if (voiceId === this.state.voiceId) return;
    const wasActive = this.active;
    this.stopRun();
    this.resetBuffer();
    void this.engine?.dispose();
    this.engine = null;
    this.set({ voiceId, rtf: null, error: null, status: wasActive ? 'idle' : this.state.status === 'error' ? 'idle' : this.state.status });
    if (wasActive) void this.play();
  }

  setBook(book: Book, chapter = 0, para = 0) {
    this.stopRun();
    this.resetBuffer();
    const safeChapter = Math.min(Math.max(chapter, 0), book.chapters.length - 1);
    this.units = buildUnits(book, safeChapter);
    const safePara = Math.min(Math.max(para, 0), book.chapters[safeChapter].paragraphs.length - 1);
    this.cur = Math.max(0, this.units.findIndex((u) => u.p === safePara));
    this.set({ book, chapter: safeChapter, para: safePara, sent: 0, status: 'idle', error: null });
  }

  /* ---------- modello ---------- */

  /** Scarica (se serve) e carica la voce in memoria, senza avviare la lettura. */
  async prepareVoice(): Promise<void> {
    try {
      await this.ensureEngine();
      this.set({ status: this.state.status === 'loading' ? 'idle' : this.state.status });
    } catch (error) {
      this.fail(error);
    }
  }

  private ensureEngine(): Promise<Engine> {
    const voiceId = this.state.voiceId;
    if (this.engine && this.engine.voice.id === voiceId) return Promise.resolve(this.engine);
    if (this.engineLoading?.voiceId === voiceId) return this.engineLoading.promise;

    const voice = VOICES.find((v): v is VoiceDef => v.id === voiceId) ?? VOICES[0];
    this.set({ status: 'loading', load: { phase: 'download', loaded: 0, total: voice.onnxBytes }, error: null });
    const promise = loadEngine(voice, (load) => this.set({ load }))
      .then((engine) => {
        if (this.state.voiceId !== voice.id) {
          void engine.dispose();
          throw new Error('Voce cambiata durante il caricamento');
        }
        this.engine = engine;
        this.set({ load: null });
        void this.refreshDownloaded();
        return engine;
      })
      .finally(() => {
        if (this.engineLoading?.voiceId === voice.id) this.engineLoading = null;
      });
    this.engineLoading = { voiceId, promise };
    return promise;
  }

  /* ---------- riproduzione ---------- */

  toggle() {
    if (this.active) this.pause();
    else void this.play();
  }

  async play() {
    const token = ++this.runToken;
    this.active = true;
    this.set({ error: null });
    let engine: Engine;
    try {
      engine = await this.ensureEngine();
    } catch (error) {
      if (token === this.runToken) this.fail(error);
      return;
    }
    if (token !== this.runToken) return;
    void engine;
    this.set({ status: 'buffering', load: null });
    void this.pump();
    void this.loop(token);
  }

  pause() {
    this.stopRun();
    this.set({ status: 'paused' });
  }

  seek(para: number, sent = 0) {
    const index = this.units.findIndex((u) => u.p === para && u.s === sent);
    if (index < 0) return;
    this.moveTo(index);
    void this.play();
  }

  nextPara() {
    const target = this.state.para + 1;
    if (target < this.state.book.chapters[this.state.chapter].paragraphs.length) this.jump(target);
    else if (this.state.chapter + 1 < this.state.book.chapters.length) this.goChapter(this.state.chapter + 1);
  }

  prevPara() {
    if (this.state.para > 0) this.jump(this.state.para - 1);
    else if (this.state.chapter > 0) {
      this.goChapter(this.state.chapter - 1, Number.MAX_SAFE_INTEGER);
    }
  }

  private jump(para: number) {
    const index = this.units.findIndex((u) => u.p === para);
    if (index < 0) return;
    const wasActive = this.active;
    this.moveTo(index);
    if (wasActive) void this.play();
  }

  goChapter(chapter: number, para = 0) {
    const wasActive = this.active;
    this.stopRun();
    this.resetBuffer();
    const safeChapter = Math.min(Math.max(chapter, 0), this.state.book.chapters.length - 1);
    this.units = buildUnits(this.state.book, safeChapter);
    const lastPara = this.state.book.chapters[safeChapter].paragraphs.length - 1;
    const safePara = Math.min(Math.max(para, 0), lastPara);
    this.cur = Math.max(0, this.units.findIndex((u) => u.p === safePara));
    this.set({ chapter: safeChapter, para: safePara, sent: 0, status: wasActive ? this.state.status : 'idle' });
    if (wasActive) void this.play();
  }

  private moveTo(index: number) {
    this.cur = index;
    const unit = this.units[index];
    this.set({ para: unit.p, sent: unit.s });
    this.evict();
  }

  private stopRun() {
    this.runToken++;
    this.active = false;
    this.audio.pause();
    this.stopPlayback?.();
    this.wake();
  }

  private fail(error: unknown) {
    this.stopRun();
    const message = error instanceof Error ? error.message : String(error);
    this.set({ status: 'error', error: message, load: null });
  }

  private async loop(token: number) {
    while (token === this.runToken) {
      if (this.cur >= this.units.length) {
        if (!this.nextChapter()) {
          this.stopRun();
          this.set({ status: 'idle' });
          return;
        }
        void this.pump();
        continue;
      }
      const index = this.cur;
      const unit = this.units[index];
      if (!hasSpeakableText(unit.text)) {
        this.cur++;
        continue;
      }
      void this.pump();

      let item = this.ready.get(index);
      if (!item) {
        this.set({ status: 'buffering', para: unit.p, sent: unit.s });
        item = (await this.waitFor(index, token)) ?? undefined;
        if (!item || token !== this.runToken) return;
      }
      this.set({ status: 'playing', para: unit.p, sent: unit.s });
      await this.playUrl(item.url, token);
      if (token !== this.runToken) return;
      this.cur++;
      this.evict();
    }
  }

  private nextChapter(): boolean {
    const next = this.state.chapter + 1;
    if (next >= this.state.book.chapters.length) return false;
    this.resetBuffer();
    this.units = buildUnits(this.state.book, next);
    this.cur = 0;
    this.set({ chapter: next, para: 0, sent: 0 });
    return true;
  }

  private playUrl(url: string, token: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const audio = this.audio;
      const finish = () => {
        audio.onended = null;
        audio.onerror = null;
        this.stopPlayback = null;
        resolve();
      };
      this.stopPlayback = finish;
      audio.onended = finish;
      audio.onerror = finish;
      audio.src = url;
      audio.defaultPlaybackRate = this.state.rate;
      audio.playbackRate = this.state.rate;
      audio.play().catch((error) => {
        finish();
        if (token === this.runToken) this.fail(error);
      });
    });
  }

  /* ---------- sintesi in anticipo ---------- */

  private nextNeeded(): number {
    const last = Math.min(this.cur + LOOKAHEAD, this.units.length - 1);
    for (let i = this.cur; i <= last; i++) {
      if (!this.ready.has(i) && hasSpeakableText(this.units[i].text)) return i;
    }
    return -1;
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.active && this.engine) {
        const index = this.nextNeeded();
        if (index < 0) break;
        const generation = this.generation;
        const unit = this.units[index];
        const result = await this.engine.synth(unit.text, unit.pauseAfter);
        const url = URL.createObjectURL(result.blob);
        if (generation !== this.generation) {
          URL.revokeObjectURL(url);
          continue;
        }
        this.ready.set(index, { url, seconds: result.seconds });
        const speech = Math.max(0.05, result.seconds - unit.pauseAfter);
        const instant = speech / (result.elapsedMs / 1000);
        this.set({ rtf: this.state.rtf === null ? instant : this.state.rtf * 0.7 + instant * 0.3 });
        this.wake();
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.pumping = false;
    }
    // Il giro è finito con la finestra piena: se nel frattempo è cambiata, riparte.
    if (this.active && this.engine && this.nextNeeded() >= 0) void this.pump();
  }

  private async waitFor(index: number, token: number): Promise<Ready | null> {
    while (token === this.runToken) {
      const item = this.ready.get(index);
      if (item) return item;
      await new Promise<void>((resolve) => this.waiters.add(resolve));
    }
    return null;
  }

  private wake() {
    const pending = [...this.waiters];
    this.waiters.clear();
    pending.forEach((resolve) => resolve());
  }

  private evict() {
    for (const [index, item] of this.ready) {
      if (index < this.cur - 1 || index > this.cur + LOOKAHEAD) {
        URL.revokeObjectURL(item.url);
        this.ready.delete(index);
      }
    }
  }

  private resetBuffer() {
    this.generation++;
    this.ready.forEach((item) => URL.revokeObjectURL(item.url));
    this.ready.clear();
  }
}

export const player = new Player();
