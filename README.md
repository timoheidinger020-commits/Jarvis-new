# J.A.R.V.I.S. – persönlicher KI-Assistent

JARVIS ist dein persönlicher KI-Assistent für Windows-PC und Android-Smartphone.
Er führt natürliche Gespräche auf Deutsch, merkt sich Wichtiges über dich und
nutzt auf allen Geräten dasselbe Gedächtnis.

**Aktueller Stand (Meilenstein 1):** Text-Chat mit Langzeitgedächtnis im Browser.
Sprache, Android-App und Geräte-Steuerung folgen schrittweise – siehe
[`PROJECT_STATE.md`](PROJECT_STATE.md).

---

## Anleitung: JARVIS auf deinem Windows-PC starten

Du brauchst etwa 15–20 Minuten. Nach jedem Schritt steht, **woran du erkennst,
dass es geklappt hat**.

### Schritt 1 – Node.js installieren (kostenlos)

Node.js ist das Programm, mit dem JARVIS läuft.

1. Öffne <https://nodejs.org/de> im Browser.
2. Klicke auf den grünen Knopf **„LTS“** (Version 24 oder neuer) und lade den Windows-Installer herunter.
3. Starte die heruntergeladene Datei und klicke dich mit **„Weiter“** durch. Die Voreinstellungen passen.

✅ **Prüfen:** Drücke `Windows-Taste + R`, tippe `cmd` und drücke Enter. Im schwarzen
Fenster tippst du:

```
node -v
```

Es sollte etwas wie `v24.11.0` erscheinen (Hauptsache 22.13 oder höher).
Erscheint „Befehl nicht gefunden“, starte den PC neu und versuche es nochmal.

### Schritt 2 – JARVIS herunterladen

**Einfache Variante (ohne Git):**

1. Öffne dein Repository auf GitHub: `https://github.com/timoheidinger020-commits/Jarvis-new`
2. Wähle oben links den Branch **`claude/jarvis-ai-assistant-q5ksbu`** aus.
3. Klicke auf den grünen Knopf **„Code“** → **„Download ZIP“**.
4. Entpacke die ZIP-Datei, z. B. nach `C:\JARVIS`.

✅ **Prüfen:** Im Ordner `C:\JARVIS` siehst du u. a. die Ordner `server`, `public`
und die Dateien `package.json` und `start-jarvis.bat`.

### Schritt 3 – Einen API-Schlüssel besorgen

JARVIS' Intelligenz kommt von einem großen KI-Modell. Dafür brauchst du einen
„API-Schlüssel“ – eine Art Passwort, mit dem JARVIS das Modell nutzen darf.

**Empfohlen: Anthropic Claude** (beste Antwortqualität)

1. Gehe auf <https://console.anthropic.com> und lege ein Konto an.
2. Unter **„Billing“** Guthaben aufladen (z. B. 5 US-Dollar – siehe Kosten unten).
3. Unter **„API Keys“** → **„Create Key“**, Namen „JARVIS“ eingeben.
4. Den angezeigten Schlüssel (beginnt mit `sk-ant-`) **kopieren**. Er wird nur einmal angezeigt!

> Hinweis: Ein Claude-Abo (Pro/Max) auf claude.ai enthält **keinen** API-Zugang.
> Die API wird separat nach Verbrauch abgerechnet.

**Kostenlose Alternative: Google Gemini** – siehe Abschnitt „Kosten“.

### Schritt 4 – Die Einstellungsdatei `.env` anlegen

1. Öffne den Ordner `C:\JARVIS` im Explorer.
2. Damit du Dateiendungen siehst: Oben im Explorer **„Anzeigen“ → „Einblenden“ → „Dateinamenerweiterungen“** anhaken.
3. Kopiere die Datei `.env.example` (Rechtsklick → Kopieren, dann Einfügen).
4. Benenne die Kopie um in genau: `.env` (ohne `.example`, ohne `.txt`). Windows fragt nach, ob du die Endung ändern willst → **Ja**.
5. Rechtsklick auf `.env` → **„Öffnen mit“ → „Editor“**.
6. Trage ein:
   - hinter `JARVIS_PASSWORD=` ein Passwort deiner Wahl (mind. 8 Zeichen), z. B. `JARVIS_PASSWORD=MeinGeheimesPasswort42`
   - hinter `ANTHROPIC_API_KEY=` deinen kopierten Schlüssel, z. B. `ANTHROPIC_API_KEY=sk-ant-api03-...`
7. Speichern (`Strg + S`) und schließen.

✅ **Prüfen:** Im Ordner gibt es jetzt eine Datei, die nur `.env` heißt (nicht `.env.txt`).

> 🔒 Die `.env` bleibt nur auf deinem PC. Sie wird nie zu GitHub hochgeladen
> (dafür sorgt die Datei `.gitignore`). Gib den Schlüssel niemandem weiter.

### Schritt 5 – Selbsttest

1. Öffne im Ordner `C:\JARVIS` die Adresszeile des Explorers, tippe `cmd` und drücke Enter. Ein schwarzes Fenster öffnet sich – direkt im JARVIS-Ordner.
2. Tippe:

```
npm install
```

   Warte, bis es fertig ist (ca. 30 Sekunden). Am Ende steht etwas wie `added 70 packages`.

3. Dann:

```
npm run check
```

✅ **Prüfen:** Es erscheint `✔ Konfiguration in Ordnung` und
`Anthropic Claude (...) wird getestet … ✔ antwortet`. Zum Schluss: **„Alles bereit.“**
Steht dort ein ✖, lies die Meldung darunter – sie sagt, was fehlt
(meist ein Tippfehler im Schlüssel).

### Schritt 6 – JARVIS starten

**Doppelklick auf `start-jarvis.bat`.**
(Alternativ im schwarzen Fenster: `npm start`.)

✅ **Prüfen:** Im Fenster erscheint **„J.A.R.V.I.S. ist online“** und dein Browser
öffnet `http://localhost:3000`. Melde dich mit deinem Passwort aus Schritt 4 an.

Das schwarze Fenster muss offen bleiben, solange du JARVIS nutzt.
Beenden: Fenster schließen oder `Strg + C`.

### Schritt 7 – Ausprobieren

- Schreibe z. B.: *„Hallo, ich heiße Timo und lerne gerade programmieren.“*
- Unter der Antwort erscheint grün **„🧠 Gemerkt: …“** – JARVIS hat sich das gespeichert.
- Klicke auf **„Neues Gespräch“** und frage: *„Was weißt du über mich?“* – JARVIS erinnert sich.
- Unter **„Gedächtnis“** kannst du alle Erinnerungen ansehen, durchsuchen, bearbeiten, deaktivieren oder löschen.

---

## Kosten (Stand Oktober 2026 – bitte auf den Preisseiten prüfen)

JARVIS selbst ist kostenlos. Kosten entstehen nur beim KI-Anbieter, abgerechnet pro Nutzung:

| Anbieter / Modell | ungefähre Kosten pro Nachricht* | Hinweis |
|---|---|---|
| **Claude Opus 5.5** (Standard) | ca. 2–6 Cent | beste Qualität |
| Claude Sonnet 5.5 | ca. 1–3 Cent | sehr gut, günstiger |
| Claude Haiku 5.5 | unter 0,2 Cent | schnell, einfacher |
| Google Gemini (Flash) | kostenloses Kontingent | Limits pro Tag; im Gratis-Tarif darf Google Eingaben zur Verbesserung nutzen |

\*Grobe Schätzung inkl. Gedächtnis-Auswertung; lange Gespräche kosten mehr.
Bei ~10 Nachrichten pro Tag mit Opus 5.5 sind das grob **6–18 € im Monat**.
In der Anthropic-Konsole kannst du ein **monatliches Ausgabenlimit** setzen –
das ist empfehlenswert.

Modell wechseln: In der `.env` z. B. `ANTHROPIC_MODEL=claude-sonnet-5-5` eintragen
und JARVIS neu starten.

Gemini nutzen: Schlüssel kostenlos unter <https://aistudio.google.com/apikey>
erstellen, in der `.env` bei `GEMINI_API_KEY=` eintragen, `AI_PROVIDER=gemini`
setzen (oder in JARVIS unter „Einstellungen“ umschalten).

---

## Häufige Probleme

| Meldung | Lösung |
|---|---|
| `JARVIS_PASSWORD fehlt` | `.env` fehlt oder heißt `.env.txt` – siehe Schritt 4. |
| `API-Schlüssel … ungültig` | Schlüssel neu kopieren, keine Leerzeichen davor/danach. |
| `kein Guthaben` | In der Anthropic-Konsole unter „Billing“ Guthaben aufladen. |
| `Port 3000 ist schon belegt` | JARVIS läuft schon in einem anderen Fenster – oder `PORT=3001` in der `.env`. |
| `'npm' wird nicht erkannt` | Node.js installieren (Schritt 1) und den PC neu starten. |

---

## Für Entwickler

```
npm install      # Abhängigkeiten
npm test         # automatische Tests (ohne echte API-Aufrufe)
npm run check    # Konfiguration + echte Verbindung zum KI-Anbieter testen
npm run dev      # Server mit automatischem Neustart bei Änderungen
```

Aufbau und Architektur: siehe [`PROJECT_STATE.md`](PROJECT_STATE.md).
