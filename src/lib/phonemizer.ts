/**
 * Fonemizzatore condiviso dai motori vocali: espeak-ng compilato in WASM (il pacchetto di Piper),
 * caricato come script classico nel WebView. Restituisce, per ogni frase riconosciuta da espeak,
 * sia gli id fonetici di Piper sia la stringa IPA (usata da Kokoro).
 */
export interface PhonemeLine {
  ids: number[];
  phonemes: string;
}

type PhonemizerModule = { callMain: (args: string[]) => void };
type PhonemizerFactory = (options: {
  print: (line: string) => void;
  printErr: (line: string) => void;
  locateFile: (file: string) => string;
}) => Promise<PhonemizerModule>;

declare global {
  interface Window {
    createPiperPhonemize?: PhonemizerFactory;
  }
}

const assetUrl = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href;

let override: { factory: PhonemizerFactory; locate: (file: string) => string } | null = null;

/** Solo per i test in Node: usa un'istanza già caricata invece dello script nel browser. */
export function configurePhonemizer(options: typeof override) {
  override = options;
}

let loading: Promise<PhonemizerFactory> | null = null;

function loadFactory(): Promise<PhonemizerFactory> {
  if (override) return Promise.resolve(override.factory);
  if (window.createPiperPhonemize) return Promise.resolve(window.createPiperPhonemize);
  loading ??= new Promise<PhonemizerFactory>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = assetUrl('vendor/piper/piper_phonemize.js');
    script.onload = () =>
      window.createPiperPhonemize
        ? resolve(window.createPiperPhonemize)
        : reject(new Error('Fonemizzatore non disponibile'));
    script.onerror = () => {
      loading = null;
      reject(new Error('Impossibile caricare il fonemizzatore (public/vendor/piper). Esegui "npm run assets".'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Scalda il fonemizzatore: il primo caricamento è il più lento. */
export async function preloadPhonemizer(): Promise<void> {
  await loadFactory();
}

export async function phonemize(text: string, espeakVoice: string): Promise<PhonemeLine[]> {
  const create = await loadFactory();
  const lines: string[] = [];
  const errors: string[] = [];
  const module = await create({
    print: (line) => lines.push(line),
    printErr: (line) => errors.push(line),
    locateFile: (file) => {
      if (override) return override.locate(file);
      if (file.endsWith('.wasm')) return assetUrl('vendor/piper/piper_phonemize.wasm');
      if (file.endsWith('.data')) return assetUrl('vendor/piper/piper_phonemize.data');
      return file;
    },
  });
  try {
    module.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  } catch (error) {
    // Emscripten lancia ExitStatus a fine esecuzione: va bene se abbiamo già l'output.
    if (!lines.length) throw error;
  }
  const result: PhonemeLine[] = [];
  for (const line of lines) {
    try {
      const j = JSON.parse(line) as { phoneme_ids?: number[]; phonemes?: unknown };
      const ids = j.phoneme_ids ?? [];
      if (!ids.length) continue;
      const phonemes = Array.isArray(j.phonemes) ? (j.phonemes as unknown[]).flat(Infinity).join('') : String(j.phonemes ?? '');
      result.push({ ids, phonemes });
    } catch {
      /* riga di log, non JSON */
    }
  }
  if (!result.length) throw new Error(`Fonemizzazione fallita: ${errors.join(' ').slice(0, 160)}`);
  return result;
}
