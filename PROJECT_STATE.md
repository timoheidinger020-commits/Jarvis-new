# PROJECT_STATE – JARVIS

> Diese Datei wird zu Beginn jeder Arbeitssitzung gelesen und nach jedem
> abgeschlossenen Schritt aktualisiert. Regeln: siehe Master-Prompt, Abschnitt 19.

**Letzte Aktualisierung:** 16.11.2026
**Stand:** Meilensteine 1–3 umgesetzt (Text-Chat + Gedächtnis, Stimme, Handy-Nutzung als App) und mit echtem Gemini getestet. **Test am eigenen PC/Handy durch Timo steht aus.**

| Meilenstein | Status |
|---|---|
| 1 – Text-Chat mit Gedächtnis (PC-Browser) | ✅ fertig, echt getestet (Gemini) |
| 2 – Stimme (sprechen, vorlesen, unterbrechen, Gesprächsmodus) | ✅ fertig, echt getestet (Gemini-Stimme) |
| 3 – Handy (installierbare App, sicherer Zugriff per Tailscale, Schnellstart) | ✅ fertig, Anleitung im README; Test auf echtem Handy steht aus |
| 4 – Notizen & Erinnerungen | ⏳ offen |
| 5 – PC-Steuerung (Programme/Webseiten öffnen, Dateien suchen) | ⏳ offen |
| 6 – „Hey JARVIS“ im Hintergrund (eigene Android-App / Windows-Dienst) | ⏳ offen |

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
  voice/tts.js        Sprachausgabe über Gemini TTS (austauschbar)
public/               index.html, app.js, voice.js (Mikrofon/Vorlesen), markdown.js, styles.css, manifest, Icons
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

**Phase 3 – Stimme**
- Spracheingabe per 🎤 (Browser-Spracherkennung, Deutsch; Chrome/Edge, auch Android), am PC zusätzlich Strg+Leertaste
- Sprachausgabe: natürliche Gemini-Stimme (8 männliche Stimmen wählbar, Probehören) oder Gerätestimme (bevorzugt natürliche männliche deutsche Stimme)
- Unterbrechen jederzeit (Stopp oder 🎤), Gesprächsmodus (nach der Antwort automatisch weiter zuhören), „▶ Vorlesen“ unter jeder Antwort, Vorlese-Schalter 🔈/🔊
- JARVIS spricht sofort nach der Antwort (Gedächtnis-Auswertung läuft parallel); lange Antworten in zwei Teilen (schneller Start)
- Automatischer Rückfall auf die Gerätestimme, wenn die Gemini-Stimme nicht verfügbar ist (Kontingent, Fehler) – mit Hinweis
- Gesprochene Nachrichten werden markiert → JARVIS antwortet dann kurz und gut vorlesbar
- Sichtbare Mikrofon-Anzeige (roter Balken, roter Kreis); Mikrofon nie im Hintergrund aktiv

**Phase 6 (Teil) – Android**
- Installierbare Web-App (Manifest, PNG-Icons inkl. „maskable“), Schnellstart-Verknüpfung „Mit JARVIS sprechen“ (hört sofort zu)
- Sicherer Zugriff vom Handy über Tailscale (HTTPS, kostenlos, auch unterwegs) – Anleitung im README
- Mikrofon am Handy braucht HTTPS → deshalb Tailscale statt IP-Adresse

**Tests (41, alle grün):** Anbieter-Streaming & Parameter (gegen simulierte APIs), Fehler/Wiederholungen/Abbruch, Gedächtnis-Logik, Kontextbudget, komplette API (Login, Chat, Gedächtnis, Zusammenfassung, Geräte). Zusätzlich manuell im echten Browser (Desktop + Handy-Größe) durchgespielt.

## 5. Offen / Nächste Schritte

1. **Timo testet** am Windows-PC und am Handy (Anleitung: README.md).
2. **Notizen & Erinnerungen** mit Benachrichtigung zur gewünschten Zeit
3. **PC-Steuerung** (siehe Punkt 6 unten)
4. **Wake Word „Hey JARVIS“:** realistisch nur mit nativer Android-App (Vordergrund-Dienst mit sichtbarer Benachrichtigung) bzw. Hintergrundprogramm unter Windows (z. B. openWakeWord/Porcupine). Im Browser technisch nicht möglich → Alternative: Schnellstart-Verknüpfung.
5. **Notizen & Erinnerungen/Termine (Phase 8)**, Wissensspeicher (Dokumente)
6. **Windows-Aktionen (Phase 5):** Programme/Webseiten öffnen, Dateien suchen – mit Stufen lesend / ungefährlich / verändernd / kritisch und Bestätigung
7. Später: Embeddings für semantische Gedächtnissuche, Tool-Use für Aktionen, Datenexport/Backup

## 6. Bekannte Einschränkungen / Probleme

- Standardmodell für OpenAI (`gpt-5`) ggf. an aktuelle Modellnamen anpassen.
- **Echter Test mit Gemini (16.11.2026) erfolgreich:** JARVIS antwortet auf Deutsch im richtigen Ton, merkt sich automatisch Name und Interessen und erinnert sich in einem neuen Gespräch daran.
- **Gratis-Kontingent von Gemini ist knapp:** Chat und Stimme haben eigene Tageslimits. Bei intensiven Tests waren beide erschöpft (JARVIS meldet das verständlich und spricht dann mit der Gerätestimme). Für den Alltag: Claude oder bezahlter Gemini-Tarif.
- Gemini-TTS liest Regieanweisungen („Sprich ruhig: …“) mit vor → JARVIS schickt nur den reinen Text; der Charakter kommt von der gewählten Stimme.
- Spracherkennung nur in Chrome/Edge (nicht Firefox); sie läuft über Google bzw. Microsoft.
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
