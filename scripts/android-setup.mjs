// Prepara il progetto Android per la lettura a schermo spento. Si può rieseguire senza danni.
//   - permessi per il servizio in primo piano (tipo "mediaPlayback") e per le notifiche
//   - receiver e service del plugin Capawesome nel manifest
//   - icona della notifica (res/drawable/ic_stat_lettore.xml)
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

if (!existsSync(manifestPath)) {
  console.error('Manca la cartella android/. Esegui prima: npm run build && npm run cap:add');
  process.exit(1);
}

let xml = readFileSync(manifestPath, 'utf8');
let changed = false;

const permissions = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
];
const missingPermissions = permissions.filter((p) => !xml.includes(`android:name="${p}"`));
if (missingPermissions.length) {
  const lines = missingPermissions.map((p) => `    <uses-permission android:name="${p}" />`).join('\n');
  xml = xml.replace(/<\/manifest>/, `\n${lines}\n</manifest>`);
  changed = true;
}

const plugin = 'io.capawesome.capacitorjs.plugins.foregroundservice';
if (!xml.includes(`${plugin}.AndroidForegroundService`)) {
  const block = [
    `        <receiver android:name="${plugin}.NotificationActionBroadcastReceiver" />`,
    `        <service android:name="${plugin}.AndroidForegroundService" android:foregroundServiceType="mediaPlayback" />`,
  ].join('\n');
  xml = xml.replace(/<\/application>/, `${block}\n    </application>`);
  changed = true;
}

if (changed) writeFileSync(manifestPath, xml);

const drawableDir = join(root, 'android', 'app', 'src', 'main', 'res', 'drawable');
mkdirSync(drawableDir, { recursive: true });
copyFileSync(join(root, 'android-overrides', 'ic_stat_lettore.xml'), join(drawableDir, 'ic_stat_lettore.xml'));

console.log(changed ? '[android] manifest aggiornato' : '[android] manifest già a posto');
console.log('[android] icona della notifica copiata');
