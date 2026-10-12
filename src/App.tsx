import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { countWords, parseEpub } from './lib/epub';
import { player } from './lib/player';
import { splitSentences } from './lib/text';
import { VOICES, formatMB } from './lib/voices';
import { syncBackground } from './lib/background';
import { SAMPLE_BOOK } from './lib/sample';

const WORDS_PER_MINUTE = 160;

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
);
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
  </svg>
);
const PrevIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 5h2v14H6zM20 5v14L9 12z" />
  </svg>
);
const NextIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M16 5h2v14h-2zM4 5l11 7L4 19z" />
  </svg>
);

const rateLabel = (r: number) => `${r.toFixed(2).replace(/0$/, '').replace('.', ',')}×`;
const minutes = (words: number, rate: number) => Math.max(1, Math.round(words / (WORDS_PER_MINUTE * rate)));
const duration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

function loadPosition(id: string): { chapter: number; para: number } {
  try {
    const raw = localStorage.getItem(`lettore:pos:${id}`);
    if (raw) return JSON.parse(raw) as { chapter: number; para: number };
  } catch {
    /* ignora */
  }
  return { chapter: 0, para: 0 };
}

function savePosition(id: string, chapter: number, para: number) {
  try {
    localStorage.setItem(`lettore:pos:${id}`, JSON.stringify({ chapter, para }));
  } catch {
    /* ignora */
  }
}

export default function App() {
  const s = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const textRef = useRef<HTMLElement>(null);

  const chapter = s.book.chapters[s.chapter];
  const sentences = useMemo(() => chapter.paragraphs.map((p) => splitSentences(p.text)), [chapter]);
  const voice = VOICES.find((v) => v.id === s.voiceId) ?? VOICES[0];
  const playing = s.status === 'playing' || s.status === 'buffering' || s.status === 'loading';
  const isSample = s.book.id === SAMPLE_BOOK.id;

  // Il paragrafo letto resta nel terzo alto dello schermo.
  useEffect(() => {
    const container = textRef.current;
    const el = container?.querySelector<HTMLElement>(`[data-p="${s.para}"]`);
    if (!container || !el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({ top: Math.max(0, el.offsetTop - container.clientHeight / 3), behavior: reduce ? 'auto' : 'smooth' });
  }, [s.chapter, s.para]);

  useEffect(() => {
    if (!isSample) savePosition(s.book.id, s.chapter, s.para);
  }, [isSample, s.book.id, s.chapter, s.para]);

  useEffect(() => {
    void syncBackground(
      {
        playing: s.status === 'playing' || s.status === 'buffering',
        title: s.book.title,
        body: chapter.title,
        author: s.book.author,
      },
      () => player.toggle(),
    );
  }, [s.status, s.book, chapter.title]);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    player.pause();
    setMessage({ text: `Lettura di ${file.name}…`, error: false });
    try {
      const book = await parseEpub(file, file.name);
      const saved = loadPosition(book.id);
      player.setBook(book, saved.chapter, saved.para);
      setMessage(null);
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'Impossibile leggere il file.',
        error: true,
      });
    }
  }

  const totalWords = s.book.chapters.reduce((n, c) => n + countWords(c), 0);
  const chapterWords = countWords(chapter);
  const loadPercent = s.load && s.load.phase === 'download' ? Math.min(100, Math.round((s.load.loaded / s.load.total) * 100)) : null;
  const downloaded = s.downloaded[voice.id];
  const progress = chapter.paragraphs.length ? (s.para / chapter.paragraphs.length) * 100 : 0;

  let meta = isSample
    ? 'Testo di esempio. Premi Ascolta, poi apri un tuo EPUB.'
    : `${s.book.title}${s.book.author ? ` · ${s.book.author}` : ''} · ${s.book.chapters.length} capitoli · ${duration(minutes(totalWords, s.rate))}`;
  if (message) meta = message.text;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Lettore Vocale</h1>
          <p className={`meta${message?.error ? ' err' : ''}`} aria-live="polite">
            {meta}
          </p>
        </div>
        <label className="btn">
          Apri EPUB
          <input className="sr" type="file" accept=".epub,application/epub+zip" onChange={onFile} />
        </label>
      </header>

      <section className="voice" aria-label="Voce e velocità">
        <label className="field-label" htmlFor="voice">
          Voce
        </label>
        <select id="voice" value={s.voiceId} onChange={(e) => player.setVoice(e.target.value)}>
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} · {v.description}
            </option>
          ))}
        </select>

        {s.status === 'loading' ? (
          <div className="loading" role="status">
            <div className="bar">
              <i style={{ width: `${loadPercent ?? 100}%` }} />
            </div>
            <span>
              {s.load?.phase === 'init' || loadPercent === 100
                ? 'Preparazione del motore vocale…'
                : `Scarico la voce ${voice.name}: ${loadPercent ?? 0}% di ${formatMB(voice.onnxBytes)}`}
            </span>
          </div>
        ) : downloaded ? (
          <p className="hint">Voce pronta sul dispositivo, funziona anche senza rete.</p>
        ) : (
          <div className="download">
            <p className="hint">La voce ({formatMB(voice.onnxBytes)}) si scarica una volta sola.</p>
            <button type="button" className="ghost" onClick={() => void player.prepareVoice()}>
              Scarica ora
            </button>
          </div>
        )}

        <div className="rate-row">
          <label className="field-label" htmlFor="rate">
            Velocità
          </label>
          <input
            id="rate"
            type="range"
            min="0.8"
            max="1.6"
            step="0.05"
            value={s.rate}
            onChange={(e) => player.setRate(parseFloat(e.target.value))}
          />
          <output htmlFor="rate">{rateLabel(s.rate)}</output>
        </div>

        {s.rtf !== null && (
          <p className={`hint${s.rtf < 1 ? ' warn' : ''}`}>
            Sintesi a {s.rtf.toFixed(1).replace('.', ',')}× il tempo reale
            {s.engineInfo ? ` (${s.engineInfo})` : ''}
            {s.rtf < 1 ? ': più lenta della lettura, ci saranno pause. Prova la voce Paola, che è la più leggera.' : '.'}
          </p>
        )}
        {s.error && <p className="hint warn">{s.error}</p>}
      </section>

      <div className="chap">
        <select
          aria-label="Capitolo"
          value={s.chapter}
          onChange={(e) => player.goChapter(parseInt(e.target.value, 10))}
        >
          {s.book.chapters.map((c, i) => (
            <option key={i} value={i}>
              {i + 1}. {c.title}
            </option>
          ))}
        </select>
        <span>
          {chapter.paragraphs.length} par. · ~{minutes(chapterWords, s.rate)} min
        </span>
      </div>

      <main className="text" ref={textRef} tabIndex={0} aria-label="Testo del libro">
        {chapter.paragraphs.map((p, pi) => (
          <p key={pi} data-p={pi} className={`${p.heading ? 'h ' : ''}${pi === s.para ? 'on' : ''}`}>
            {sentences[pi].map((sentence, si) => (
              <span
                key={si}
                className={pi === s.para && si === s.sent && s.status === 'playing' ? 'now' : undefined}
                onClick={() => player.seek(pi, si)}
              >
                {sentence}{' '}
              </span>
            ))}
          </p>
        ))}
      </main>

      <footer className="player">
        <div className="bar" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </div>
        <div className="pos">
          Paragrafo {s.para + 1} di {chapter.paragraphs.length} · Capitolo {s.chapter + 1} di {s.book.chapters.length}
          {s.status === 'buffering' ? ' · preparo la frase…' : ''}
        </div>
        <div className="ctrls">
          <button type="button" className="skip" aria-label="Paragrafo precedente" onClick={() => player.prevPara()}>
            <PrevIcon />
          </button>
          <button
            type="button"
            className="play"
            aria-label={playing ? 'Pausa' : 'Ascolta'}
            onClick={() => player.toggle()}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" className="skip" aria-label="Paragrafo successivo" onClick={() => player.nextPara()}>
            <NextIcon />
          </button>
        </div>
      </footer>
    </div>
  );
}
