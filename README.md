# Lettore Vocale

App Android (Capacitor + React + Vite) che legge ad alta voce un EPUB con una voce neurale (**Piper** o **Kokoro**) che gira
interamente sul telefono. Nessun server, nessun costo per libro, funziona offline dopo il primo download.

```
EPUB ─▶ capitoli e paragrafi ─▶ frasi ─▶ fonemi (espeak-ng, WASM) ─▶ modello Piper (ONNX Runtime, WASM) ─▶ audio ─▶ <audio>
```

La sintesi lavora in anticipo di 3 frasi mentre ne ascolti una, quindi la lettura è continua se il telefono
produce audio più in fretta di quanto lo riproduce. L'app mostra questo rapporto ("Sintesi a 2,4× il tempo reale"):
è il numero da guardare per capire se la voce regge sul tuo telefono.

## Avvio

Serve Node 22 o più recente.

```bash
npm install          # installa e copia il fonemizzatore in public/vendor
npm test             # 41 test: parser EPUB, divisione in frasi, logica del player
npm run dev          # prova sul computer: http://localhost:5173
```

Sul computer la prova completa funziona da `localhost` (origine sicura). Aprendo il server di sviluppo dal telefono
via IP di rete locale (`http://192.168...`) il browser non è in un contesto sicuro: la voce non viene salvata e va
riscaricata a ogni caricamento. Per provare sul telefono usa l'app Android.

## App Android

```bash
npm run build
npm run cap:sync     # build + copia nel progetto Android + configura il manifest
npm run cap:open     # apre Android Studio: collega il telefono e premi Run
```

La cartella `android/` è già nel progetto. `npm run android:setup` (lanciato da `cap:sync`) aggiunge al manifest i
permessi e il servizio in primo piano che servono per continuare a leggere a schermo spento, e copia l'icona
della notifica. Si può rieseguire senza danni.

Prima di pubblicare cambia `appId` in `capacitor.config.ts` (ora `com.fortysidedstudio.lettorevocale`).

## Le voci

| Voce | Peso | Note |
| --- | --- | --- |
| Paola (Piper `it_IT-paola-medium`) | 63 MB | femminile, veloce (circa 6× il tempo reale sul telefono di prova) |
| Sara (Kokoro-82M `if_sara`) | 92 MB | femminile, più naturale ma molto più pesante |
| Nicola (Kokoro-82M `im_nicola`) | 92 MB | maschile, più naturale ma molto più pesante; condivide il modello con Sara |

Kokoro (Apache-2.0, versione int8) richiede più calcolo di Piper: su telefoni lenti può non stare al passo con la
lettura. Guarda il numero "Sintesi a N× il tempo reale": sotto 1× ci sono pause. La voce maschile Riccardo di Piper è
stata tolta perché la qualità era troppo bassa (si può riaggiungere con una riga in `src/lib/voices.ts`).

Paola viene scaricata al primo uso da Hugging Face (`rhasspy/piper-voices`). Il modello Kokoro (92 MB) non è nel
repository: la build web lo scarica dalla release di `kokoro-onnx` (`npm run fetch:kokoro`, con controllo SHA-256)
e lo pubblica con l'app su GitHub Pages; l'APK lo scarica da lì al primo uso. I vettori di stile delle due voci
(`public/models/kokoro/*.bin`, 522 KB ciascuno) sono invece nel repository e nell'APK.
Per avere un APK che funziona subito senza rete, copia i file del modello in `public/models/` (istruzioni in
`public/models/README.txt`): l'app li cerca lì prima di scaricare.

Memoria: i modelli occupano circa 3 volte il loro peso mentre vengono caricati. Su telefoni con poca RAM usa Paola.

## Cosa è stato verificato e cosa no

Verificato qui:
- controllo dei tipi e build di produzione;
- 41 test automatici (parser EPUB su un file generato, divisione in frasi, numeri e abbreviazioni, macchina a stati del
  player con un motore simulato: ordine di lettura, anticipo, pausa, salto, cambio capitolo, errori);
- il fonemizzatore italiano eseguito con il vero WASM di espeak-ng (`npm run check:phonemizer`);
- generazione del progetto Android e modifica del manifest (XML valido, idempotente).

**Non verificato**, perché l'ambiente in cui è stato scritto non può scaricare i modelli né eseguire un telefono:
- la sintesi vera con ONNX Runtime e il modello Piper (l'inferenza segue la logica di `@mintplex-labs/piper-tts-web`);
- il download da Hugging Face dentro il WebView (se fallisce per CORS, includi i modelli in `public/models/`);
- la velocità su un telefono reale;
- il servizio in primo piano: il tipo `mediaPlayback` non è tra quelli previsti dal plugin, quindi l'app lo dichiara nel
  manifest e non lo passa al plugin. Va provato su un dispositivo Android 14 o più recente.

Se qualcosa si rompe al primo avvio sul telefono, in Chrome apri `chrome://inspect` per leggere la console del WebView.

## Limiti noti e passi successivi

- Il pulsante "Pausa" nella notifica ferma anche il servizio: per riprendere si torna nell'app.
- Cambiando capitolo c'è una breve attesa mentre si prepara la prima frase.
- Si riapre il libro scegliendo di nuovo il file; la posizione viene ricordata per nome e dimensione del file.
- Idee: libreria di libri salvati, audio generato in anticipo per capitolo (utile se la sintesi è sotto 1×),
  controlli multimediali nativi sulla schermata di blocco, dizionario per nomi propri e sigle.

## Licenze

Il fonemizzatore di Piper usa **espeak-ng, licenza GPL-3.0**. Piper, ONNX Runtime e gli altri pacchetti usati sono MIT o
simili. Ogni voce ha una propria licenza nella `MODEL_CARD` del repository delle voci. Prima di distribuire l'app a
terzi controlla le condizioni di tutte queste parti, in particolare quelle di espeak-ng e della voce scelta.
