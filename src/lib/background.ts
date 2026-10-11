/**
 * Lettura a schermo spento.
 *
 * Su Android un WebView in background viene fermato dal sistema. Per evitarlo l'app avvia un
 * "foreground service" con una notifica fissa mentre la voce parla. Il plugin è Capawesome
 * (MIT); la configurazione del manifest è fatta da `npm run android:setup`.
 *
 * Fuori da Android (browser, anteprima) tutto questo non fa nulla.
 */
import { Capacitor } from '@capacitor/core';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';

const NOTIFICATION_ID = 4242;
const isAndroid = Capacitor.getPlatform() === 'android';

let running = false;
let listenerReady = false;

export interface BackgroundInfo {
  playing: boolean;
  title: string;
  body: string;
  author?: string;
}

export async function syncBackground(info: BackgroundInfo, onToggle: () => void): Promise<void> {
  updateMediaSession(info, onToggle);
  if (!isAndroid) return;

  try {
    if (info.playing) {
      if (!listenerReady) {
        listenerReady = true;
        await ForegroundService.addListener('buttonClicked', () => onToggle());
      }
      if (!running) {
        const permission = await ForegroundService.checkPermissions();
        if (permission.display !== 'granted') await ForegroundService.requestPermissions();
        await ForegroundService.startForegroundService({
          id: NOTIFICATION_ID,
          title: info.title,
          body: info.body,
          smallIcon: 'ic_stat_lettore',
          silent: true,
          buttons: [{ id: 1, title: 'Pausa' }],
        });
        running = true;
      } else {
        await ForegroundService.updateForegroundService({
          id: NOTIFICATION_ID,
          title: info.title,
          body: info.body,
          smallIcon: 'ic_stat_lettore',
        });
      }
    } else if (running) {
      await ForegroundService.stopForegroundService();
      running = false;
    }
  } catch (error) {
    // La lettura continua comunque in primo piano.
    console.warn('Servizio in background non disponibile', error);
  }
}

function updateMediaSession(info: BackgroundInfo, onToggle: () => void) {
  try {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: info.body,
      artist: info.author ?? '',
      album: info.title,
    });
    navigator.mediaSession.playbackState = info.playing ? 'playing' : 'paused';
    navigator.mediaSession.setActionHandler('play', onToggle);
    navigator.mediaSession.setActionHandler('pause', onToggle);
  } catch {
    /* non supportata */
  }
}
