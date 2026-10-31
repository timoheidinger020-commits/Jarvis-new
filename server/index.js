// Startpunkt: "npm start"
import { createApp } from './app.js';
import { config, validateConfig } from './config.js';

const { errors, warnings } = validateConfig(config);
for (const w of warnings) console.warn(`⚠  ${w}`);
if (errors.length) {
  console.error('\nJARVIS kann nicht starten:\n');
  for (const e of errors) console.error(`  ✖ ${e}`);
  console.error('\nÖffne die Datei ".env" im JARVIS-Ordner und korrigiere die Einträge. Vorlage: ".env.example".\n');
  process.exit(1);
}

const { app, settings } = createApp(config);
const server = app.listen(config.port, config.host, () => {
  const shownHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log('\n  ╭───────────────────────────────────────────╮');
  console.log('  │  J.A.R.V.I.S. ist online                  │');
  console.log('  ╰───────────────────────────────────────────╯');
  console.log(`\n  Im Browser öffnen:  http://${shownHost}:${config.port}`);
  console.log(`  KI-Anbieter:        ${settings.get('ai.provider')}`);
  console.log('  Beenden:            Strg + C\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✖ Port ${config.port} ist schon belegt. Läuft JARVIS bereits in einem anderen Fenster? Sonst in der .env einen anderen PORT eintragen.\n`);
  } else {
    console.error('\n✖ Serverfehler:', err.message);
  }
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\nJARVIS wird beendet. Auf Wiedersehen.');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
