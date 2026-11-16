# PROJECT_STATE – JARVIS

> Diese Datei wird zu Beginn jeder Arbeitssitzung gelesen und nach jedem
> abgeschlossenen Schritt aktualisiert. Regeln: siehe Master-Prompt, Abschnitt 19.

**Letzte Aktualisierung:** 16.11.2026
**Aktueller Meilenstein:** 1 – Text-Chat mit Gedächtnis im Browser (Windows) → **umgesetzt und mit echtem KI-Anbieter (Gemini) getestet; Test am Windows-PC durch Timo steht aus**

---

## 1. Architektur (Kurzfassung)

```
 Samsung S26 Ultra (Browser/PWA, später native App)      Windows-PC (Browser)
                 │                                              │
                 └──────────────► JARVIS-Server ◄───────────────┘
                                 (Node.js, läuft auf dem PC)
                                   │            │
                         SQLite-Datenbank    KI-Anbieter (austauschbar)
                     (Gespräche, Gedächtnis,  Claude · OpenAI · Gemini
                      Einstellungen, Geräte)
```

- **Ein zentraler JARVIS:** Ein Server hält Gespräche, Gedächtnis und Einstellungen.
  Alle Geräte sind nur „Fenster“ darauf → automatisch synchron.
- **Server läuft vorerst auf dem Windows-PC.** Später erreichbar vom Handy über
  das Heimnetz bzw. unterwegs per Tailscale (kostenlos, verschlüsselt). Ein
  Umzug auf einen kleinen Cloud-Server (~5 €/Monat) ist ohne Umbau möglich.
- **KI-Schnittstelle austauschbar:** `server/ai/` – jeder Anbieter implementiert
  dieselbe Funktion `stream()`. Anbieterwechsel per `.env` oder in der Oberfläche.

## 2. Technologie-Entscheidungen

| Bereich | Entscheidung | Warum |
|---|---|---|
| Server | Node.js ≥ 22.13 (empfohlen 24 LTS), JavaScript (ES-Module), Express 5 | ein Programm für alles, leicht zu installieren, kein Build-Schritt |
| Datenbank | SQLite über das in Node eingebaute `node:sqlite`, FTS5-Volltextsuche | keine Extra-Installation, eine Datei, später leicht migrierbar |
| KI (Standard) | Anthropic Claude, offizielles SDK `@anthropic-ai/sdk`, Modell `claude-opus-5-5`, adaptives Denken, Effort `medium`, Ausweich-Modell bei Ablehnung (`fallbacks: "default"`), Prompt-Caching | beste Antwortqualität und natürliches Deutsch |
| KI (Alternativen) | OpenAI (Chat Completions), Google Gemini (REST) per `fetch` | Austauschbarkeit, Gemini hat Gratis-Kontingent |
| Oberfläche | Reines HTML/CSS/JS (kein Framework), PWA-Manifest | schnell, keine Build-Tools, auf Handy installierbar |
| Anmeldung | Passwort aus `.env` → Sitzung pro Gerät (HttpOnly-Cookie, SameSite=Strict, nur Hash in DB), Login-Bremse | einfach & sicher, Grundlage der Geräteverwaltung |
| Abhängigkeiten | nur 2: `express`, `@anthropic-ai/sdk` | wenig Wartung, wenig Angriffsfläche |

## 3. Projektstruktur

```
server/
  index.js            Startpunkt (npm start)
  check.js            Selbsttest (npm run check)
  config.js           .env laden + prüfen (.env hat Vorrang vor Systemvariablen)
  app.js              Web-Server, API-Routen, Sicherheits-Header
  db.js               SQLite + Migrationen
  auth.js             Anmeldung, Sitzungen, Geräte
  settings.js         in der Oberfläche änderbare Einstellungen
  ai/                 index.js (Registry, Wiederholungen), anthropic.js, openai.js, gemini.js, sse.js, errors.js
  chat/               service.js (Ablauf), context.js (Kontextstrategie), prompts.js (Persönlichkeit), conversations.js
  memory/             store.js (Gedächtnis-CRUD + Suche), extractor.js (automatisches Merken)
public/               index.html, app.js, markdown.js, styles.css, manifest, icon
test/                 automatische Tests (node --test), simulierte KI-Anbieter
start-jarvis.bat      Doppelklick-Start unter Windows
```

## 4. Erledigt ✅

**Phase 1 – Fundament**
- Projektstruktur, zentrale Konfiguration mit verständlicher Prüfung, `.env.example`, `.gitignore`
- Datenbank mit Migrationen; Server mit Sicherheits-Headern (CSP etc.), JSON-Pflicht gegen fremde Seiten
- Anmeldung mit Passwort, Sitzungen pro Gerät, Login-Bremse (10 Versuche / 15 Min.)

**Phase 2 – KI**
- Austauschbare Anbieter: Claude (SDK), OpenAI, Gemini
- Streaming der Antworten bis in den Browser (Server-Sent Events), „Stopp“-Knopf
- Zeitlimit, automatische Wiederholung bei vorübergehenden Fehlern (nie bei bereits gestreamtem Text), deutsche Fehlermeldungen
- JARVIS-Persönlichkeit (ruhig, höflich, siezt standardmäßig, ehrlich über Fähigkeiten)
- Kontextstrategie: neueste Nachrichten wörtlich (Budget `CONTEXT_MAX_CHARS`), Älteres als laufende Zusammenfassung; Zeitstempel je Benutzernachricht (cache-freundlich)

**Phase 4 – Gedächtnis (Grundlage)**
- Kurzzeit: Gesprächsverlauf in DB, Gespräche umbenennen/löschen (mit Bestätigung)
- Langzeit: Erinnerungen mit Kategorie, Wichtigkeit, Quelle (manuell/automatisch), aktiv/deaktiviert
- Automatisches Merken nach jeder Antwort (separater KI-Aufruf, Duplikat- und Passwort-Filter), sichtbare Meldung „🧠 Gemerkt“ mit „Rückgängig“
- „Vergiss …“ im Chat → Erinnerung wird deaktiviert (nicht gelöscht)
- Gedächtnis-Bereich: anzeigen, suchen (Volltext, umlaut-tolerant), anlegen, bearbeiten, deaktivieren, löschen (mit Bestätigung)
- Relevanzauswahl bei vielen Erinnerungen (wichtigste + passende)

**Oberfläche**
- Responsive (PC + Handy), Status-Orb (bereit / denkt nach / antwortet / Fehler), Gesprächsliste, Einstellungen (Anbieter wählen, Auto-Merken an/aus, Geräte abmelden, Funktionsübersicht)
- Neues Gerät öffnet automatisch das zuletzt aktive Gespräch (am Handy beginnen, am PC weitermachen)

**Tests (34, alle grün):** Anbieter-Streaming & Parameter (gegen simulierte APIs), Fehler/Wiederholungen/Abbruch, Gedächtnis-Logik, Kontextbudget, komplette API (Login, Chat, Gedächtnis, Zusammenfassung, Geräte). Zusätzlich manuell im echten Browser (Desktop + Handy-Größe) durchgespielt.

## 5. Offen / Nächste Schritte

1. **Timo testet Meilenstein 1** am Windows-PC (Anleitung: README.md) – inkl. `npm run check` mit echtem Schlüssel.
2. **Meilenstein 2 – Stimme (Phase 3):**
   - Spracheingabe: Browser-Spracherkennung (Chrome/Edge, kostenlos) als Start; als Qualitäts-Option ein Speech-to-Text-Dienst
   - Sprachausgabe mit tiefer, ruhiger deutscher Männerstimme – Kandidaten (Kosten vorher vorlegen!):
     Azure Neural TTS (Gratis-Kontingent, z. B. Stimme „Conrad“), OpenAI TTS, ElevenLabs (beste Qualität, kostenpflichtig)
   - Unterbrechen der Sprachausgabe, fortlaufender Gesprächsmodus
3. **Meilenstein 3 – Android:** Zugriff vom Handy (HOST, Tailscale, HTTPS), PWA installieren, Schnellstart (Verknüpfung/Widget)
4. **Wake Word „Hey JARVIS“:** realistisch nur mit nativer Android-App (Vordergrund-Dienst mit sichtbarer Benachrichtigung) bzw. Hintergrundprogramm unter Windows (z. B. openWakeWord/Porcupine). Im Browser technisch nicht möglich → Alternative: Schnellstart-Verknüpfung.
5. **Notizen & Erinnerungen/Termine (Phase 8)**, Wissensspeicher (Dokumente)
6. **Windows-Aktionen (Phase 5):** Programme/Webseiten öffnen, Dateien suchen – mit Stufen lesend / ungefährlich / verändernd / kritisch und Bestätigung
7. Später: Embeddings für semantische Gedächtnissuche, Tool-Use für Aktionen, Datenexport/Backup

## 6. Bekannte Einschränkungen / Probleme

- Standardmodell für OpenAI (`gpt-5`) ggf. an aktuelle Modellnamen anpassen.
- **Echter Test mit Gemini (16.11.2026) erfolgreich:** JARVIS antwortet auf Deutsch im richtigen Ton, merkt sich automatisch Name und Interessen und erinnert sich in einem neuen Gespräch daran.
- Gemini im Gratis-Tarif ist **langsam** (ca. 10–25 s bis zur Antwort, plus Gedächtnis-Auswertung) und zeitweise überlastet (503) oder am Kontingent (429). Für flüssiges Arbeiten Claude empfohlen.
- `gemini-flash-latest` hing beim Streaming zweimal bis zum Zeitlimit, `gemini-2.5-flash` ist für neue Nutzer abgeschaltet → Standard ist jetzt `gemini-3.5-flash`. Hintergrundaufgaben nutzen bei Gemini 3 geringe Denktiefe (halbiert die Wartezeit).
- Claude und OpenAI noch nicht mit echtem Schlüssel getestet (nur gegen nachgebaute API-Antworten).
- Automatisches Merken kostet pro Nachricht einen zusätzlichen (kleinen) KI-Aufruf; abschaltbar in den Einstellungen.
- Server läuft nur, solange das Fenster auf dem PC offen ist (Autostart folgt mit Windows-Phase).
- Keine Sprachfunktion, kein Internetzugriff, keine Geräteaktionen – JARVIS weiß das und behauptet nichts anderes.
- `node:sqlite` ist in Node offiziell noch „experimentell“ (stabil nutzbar; die Warnung wird ausgeblendet).

## 7. Konfiguration (.env) – wichtigste Werte

`JARVIS_PASSWORD`, `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`,
`OPENAI_API_KEY`, `GEMINI_API_KEY`, `HOST`, `PORT`, `MEMORY_AUTO_EXTRACT`, `CONTEXT_MAX_CHARS`.
Vorlage mit Erklärungen: `.env.example`.
