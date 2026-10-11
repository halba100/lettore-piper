export interface VoiceDef {
  id: string;
  name: string;
  description: string;
  /** Percorso nel repository rhasspy/piper-voices, senza estensione. */
  path: string;
  onnxBytes: number;
}

/** Repository ufficiale delle voci Piper. Controlla la MODEL_CARD di ogni voce prima di pubblicare l'app. */
export const REMOTE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

export const VOICES: VoiceDef[] = [
  {
    id: 'it_IT-paola-medium',
    name: 'Paola',
    description: 'Voce femminile, qualità media',
    path: 'it/it_IT/paola/medium/it_IT-paola-medium',
    onnxBytes: 63_511_038,
  },
  {
    id: 'it_IT-riccardo-x_low',
    name: 'Riccardo',
    description: 'Voce maschile, qualità bassa ma più leggera e veloce',
    path: 'it/it_IT/riccardo/x_low/it_IT-riccardo-x_low',
    onnxBytes: 28_130_791,
  },
];

export const DEFAULT_VOICE_ID = VOICES[0].id;

export const remoteOnnx = (v: VoiceDef) => `${REMOTE_BASE}${v.path}.onnx`;
export const remoteConfig = (v: VoiceDef) => `${REMOTE_BASE}${v.path}.onnx.json`;

/** Se copi i file in public/models/ l'app li trova nell'APK e non scarica nulla. */
export const bundledOnnx = (v: VoiceDef) => `${import.meta.env.BASE_URL}models/${v.id}.onnx`;
export const bundledConfig = (v: VoiceDef) => `${import.meta.env.BASE_URL}models/${v.id}.onnx.json`;

export function formatMB(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}
