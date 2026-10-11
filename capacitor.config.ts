import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Cambialo prima della prima build: dopo la pubblicazione non si può più modificare.
  appId: 'com.fortysidedstudio.lettorevocale',
  appName: 'Lettore Vocale',
  webDir: 'dist',
  server: {
    // Origine https://localhost: serve per OPFS/Cache Storage, WASM e fetch verso Hugging Face.
    androidScheme: 'https',
  },
};

export default config;
