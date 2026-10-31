// "npm run check": Prüft Konfiguration und testet die Verbindung zum KI-Anbieter.
import { createAI } from './ai/index.js';
import { config, validateConfig } from './config.js';

const { errors, warnings } = validateConfig(config);
console.log('\nJARVIS – Selbsttest\n');
for (const e of errors) console.log(`  ✖ ${e}`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
if (!errors.length) console.log('  ✔ Konfiguration in Ordnung');

const ai = createAI(config.ai);
let failed = errors.length > 0;
for (const p of ai.list()) {
  if (!p.configured) {
    console.log(`  – ${p.label}: kein Schlüssel eingetragen (übersprungen)`);
    continue;
  }
  process.stdout.write(`  … ${p.label} (${p.model}) wird getestet … `);
  try {
    const text = await ai.complete(p.id, {
      system: 'Antworte nur mit dem Wort: Bereit',
      prompt: 'Statusprüfung',
      maxTokens: 2000,
    });
    console.log(`✔ antwortet ("${text.trim().slice(0, 40)}")`);
  } catch (err) {
    failed = true;
    console.log(`✖\n      ${err.userMessage || err.message}`);
  }
}
console.log(failed ? '\nEs gibt Probleme – siehe oben.\n' : '\nAlles bereit. Starte JARVIS mit: npm start\n');
process.exit(failed ? 1 : 0);
