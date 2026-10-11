Voci incluse nell'app (facoltativo)
==================================

Se copi qui i file di una voce, l'app li usa direttamente e non scarica nulla: l'APK funziona subito, anche senza rete.
Servono sempre due file per voce, con questi nomi esatti.

Paola (63 MB)
  https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/paola/medium/it_IT-paola-medium.onnx
      -> salva come  it_IT-paola-medium.onnx
  https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/paola/medium/it_IT-paola-medium.onnx.json
      -> salva come  it_IT-paola-medium.onnx.json

Riccardo (28 MB)
  https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx
      -> salva come  it_IT-riccardo-x_low.onnx
  https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx.json
      -> salva come  it_IT-riccardo-x_low.onnx.json

Poi: npm run cap:sync

Le licenze delle voci sono nei file MODEL_CARD, nella stessa cartella del repository Hugging Face.
I file .onnx e .json di questa cartella sono esclusi da git (vedi .gitignore).
