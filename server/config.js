// Zentrale Konfiguration. Liest die .env-Datei (falls vorhanden) und
// stellt alle Einstellungen geprüft an einer Stelle bereit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = process.env.JARVIS_ENV_FILE || path.join(ROOT_DIR, '.env');
// Die .env-Datei hat Vorrang vor bereits gesetzten Systemvariablen, damit
// immer genau das gilt, was in der Datei steht.
if (fs.existsSync(envFile)) {
  Object.assign(process.env, parseEnv(fs.readFileSync(envFile, 'utf8')));
}

const env = process.env;

function str(name, fallback = '') {
  const value = env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function int(name, fallback) {
  const raw = str(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Einstellung ${name} muss eine Zahl sein (ist: "${raw}").`);
  return n;
}

function bool(name, fallback) {
  const raw = str(name).toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'ja', 'on'].includes(raw);
}

export const config = {
  host: str('HOST', '127.0.0.1'),
  port: int('PORT', 3000),
  password: str('JARVIS_PASSWORD'),
  dbPath: str('JARVIS_DB_PATH', path.join(ROOT_DIR, 'data', 'jarvis.db')),

  ai: {
    defaultProvider: str('AI_PROVIDER', 'anthropic').toLowerCase(),
    timeoutMs: int('AI_TIMEOUT_MS', 120000),
    maxRetries: int('AI_MAX_RETRIES', 2),
    providers: {
      anthropic: {
        apiKey: str('ANTHROPIC_API_KEY'),
        model: str('ANTHROPIC_MODEL', 'claude-opus-5-5'),
        effort: str('ANTHROPIC_EFFORT', 'medium'),
        baseUrl: str('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
      },
      openai: {
        apiKey: str('OPENAI_API_KEY'),
        model: str('OPENAI_MODEL', 'gpt-5'),
        baseUrl: str('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
      },
      gemini: {
        apiKey: str('GEMINI_API_KEY'),
        model: str('GEMINI_MODEL', 'gemini-2.5-flash'),
        baseUrl: str('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
      },
    },
  },

  memory: {
    autoExtract: bool('MEMORY_AUTO_EXTRACT', true),
    // Bis zu so vielen Erinnerungen werden komplett in den Kontext gegeben;
    // darüber hinaus wird nach Relevanz ausgewählt.
    maxInPrompt: int('MEMORY_MAX_IN_PROMPT', 60),
  },

  context: {
    maxChars: int('CONTEXT_MAX_CHARS', 24000),
  },
};

/** Prüft die Konfiguration und gibt verständliche Probleme zurück. */
export function validateConfig(cfg = config) {
  const errors = [];
  const warnings = [];

  if (!cfg.password) {
    errors.push('JARVIS_PASSWORD fehlt in der .env-Datei. Lege dort ein Passwort fest (mind. 8 Zeichen).');
  } else if (cfg.password.length < 8) {
    errors.push('JARVIS_PASSWORD ist zu kurz. Bitte mindestens 8 Zeichen verwenden.');
  }

  const known = Object.keys(cfg.ai.providers);
  if (!known.includes(cfg.ai.defaultProvider)) {
    errors.push(`AI_PROVIDER="${cfg.ai.defaultProvider}" ist unbekannt. Erlaubt: ${known.join(', ')}.`);
  }

  const configured = known.filter((p) => cfg.ai.providers[p].apiKey);
  if (configured.length === 0) {
    warnings.push('Es ist noch kein API-Schlüssel eingetragen. JARVIS startet, kann aber erst antworten, wenn ein Schlüssel in der .env steht.');
  } else if (!cfg.ai.providers[cfg.ai.defaultProvider]?.apiKey) {
    warnings.push(`Für den Standard-Anbieter "${cfg.ai.defaultProvider}" fehlt der API-Schlüssel. Konfiguriert sind: ${configured.join(', ')}.`);
  }

  if (cfg.host === '0.0.0.0') {
    warnings.push('HOST=0.0.0.0: JARVIS ist für alle Geräte in deinem Netzwerk erreichbar. Nutze ein starkes Passwort.');
  }

  return { errors, warnings };
}
