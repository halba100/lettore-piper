Voci incluse nell'app (facoltativo)
==================================

Se copi qui i file di una voce, l'app li usa direttamente e non scarica nulla: l'APK funziona subito, anche senza rete.
Servono sempre due file per voce, con questi nomi esatti.

Paola (63 MB)
  https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/paola/medium/it_IT-paola-medium.onnx
      -> salva come  it_IT-paola-medium.onnx
  https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/paola/medium/it_IT-paola-medium.onnx.json
      -> salva come  it_IT-paola-medium.onnx.json

Poi: npm run cap:sync

Le licenze delle voci sono nei file MODEL_CARD, nella stessa cartella del repository Hugging Face.
I file .onnx e .json di questa cartella sono esclusi da git (vedi .gitignore).
Kokoro (Sara e Nicola, 92 MB)
  node scripts/fetch-kokoro.mjs   (oppure: npm run fetch:kokoro)
      -> salva  kokoro-v1.0.int8.onnx  qui, con controllo dell'impronta.
  I vettori di stile delle voci sono già in kokoro/ e restano nel repository.
