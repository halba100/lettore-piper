interface VoiceBase {
  id: string;
  name: string;
  description: string;
  /** Peso del modello da scaricare, in byte. */
  onnxBytes: number;
}

export interface PiperVoice extends VoiceBase {
  engine: 'piper';
  /** Percorso nel repository rhasspy/piper-voices, senza estensione. */
  path: string;
}

export interface KokoroVoice extends VoiceBase {
  engine: 'kokoro';
  /** Nome del file con il vettore di stile della voce (public/models/kokoro/<nome>.bin). */
  styleFile: string;
}

export type VoiceDef = PiperVoice | KokoroVoice;

/** Repository ufficiale delle voci Piper. Controlla la MODEL_CARD di ogni voce prima di pubblicare l'app. */
export const REMOTE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

/**
 * Kokoro-82M (licenza Apache-2.0), versione int8. Il file viene pubblicato insieme all'app su GitHub Pages
 * (la build lo scarica dalla release del progetto kokoro-onnx), perché Pages permette il download dal WebView.
 */
export const KOKORO_MODEL_FILE = 'kokoro-v1.0.int8.onnx';
export const KOKORO_MODEL_BYTES = 92_361_271;
export const KOKORO_MODEL_URL: string =
  import.meta.env.VITE_KOKORO_MODEL_URL ?? `https://halba100.github.io/lettore-piper/models/${KOKORO_MODEL_FILE}`;

/** Copia originale del modello (la usa solo l'app Android, che non ha limiti di CORS). */
export const KOKORO_ORIGINAL_URL =
  'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx';

export const VOICES: VoiceDef[] = [
  {
    id: 'it_IT-paola-medium',
    engine: 'piper',
    name: 'Paola',
    description: 'Voce femminile, veloce',
    path: 'it/it_IT/paola/medium/it_IT-paola-medium',
    onnxBytes: 63_511_038,
  },
  {
    id: 'kokoro-if_sara',
    engine: 'kokoro',
    name: 'Sara',
    description: 'Voce femminile, più naturale ma più pesante',
    styleFile: 'if_sara',
    onnxBytes: KOKORO_MODEL_BYTES,
  },
  {
    id: 'kokoro-im_nicola',
    engine: 'kokoro',
    name: 'Nicola',
    description: 'Voce maschile, più naturale ma più pesante',
    styleFile: 'im_nicola',
    onnxBytes: KOKORO_MODEL_BYTES,
  },
];

export const DEFAULT_VOICE_ID = VOICES[0].id;

export const remoteOnnx = (v: PiperVoice) => `${REMOTE_BASE}${v.path}.onnx`;
export const remoteConfig = (v: PiperVoice) => `${REMOTE_BASE}${v.path}.onnx.json`;

/** Se copi i file in public/models/ l'app li trova nell'APK e non scarica nulla. */
export const bundledOnnx = (v: PiperVoice) => `${import.meta.env.BASE_URL}models/${v.id}.onnx`;
export const bundledConfig = (v: PiperVoice) => `${import.meta.env.BASE_URL}models/${v.id}.onnx.json`;

export const kokoroBundledModel = () => `${import.meta.env.BASE_URL}models/${KOKORO_MODEL_FILE}`;
export const kokoroStyleUrl = (v: KokoroVoice) => `${import.meta.env.BASE_URL}models/kokoro/${v.styleFile}.bin`;

/** Indirizzo usato come chiave nella cache: serve a sapere se la voce è già scaricata. */
export const modelUrl = (v: VoiceDef) => (v.engine === 'kokoro' ? KOKORO_MODEL_URL : remoteOnnx(v));

export function formatMB(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}
