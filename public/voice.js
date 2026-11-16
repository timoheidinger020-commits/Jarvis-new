// Sprachsystem im Browser:
//  - Spracheingabe über die Spracherkennung des Browsers (Chrome/Edge, auch Android)
//  - Sprachausgabe über die natürliche Gemini-Stimme (Server) oder die Gerätestimme
//  - jederzeit unterbrechbar

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/** Macht aus Markdown gut vorlesbaren Text. */
export function plainForSpeech(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?(```|$)/g, ' (Den Code sehen Sie auf dem Bildschirm.) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\W)[*_]([^*_\n]+)[*_](?=\W|$)/g, '$1$2')
    .replace(/_\((abgebrochen|[^)]*)\)_/g, '')
    .replace(/https?:\/\/\S+/g, 'ein Link')
    .replace(/[\p{Extended_Pictographic}️]/gu, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Teilt Text in Sätze. */
function sentences(text) {
  return text.match(/[^.!?\n]+[.!?]*[\s\n]*|[\n]+/g)?.map((s) => s.trim()).filter(Boolean) || [];
}

/**
 * Für die Gemini-Stimme: ein kurzer erster Teil (startet schnell) und der Rest.
 * So beginnt JARVIS früher zu sprechen, ohne viele Einzelanfragen.
 */
export function splitForSpeech(text, firstMax = 220, restMax = 2800) {
  const parts = sentences(text);
  if (!parts.length) return [];
  let first = '';
  while (parts.length && (first.length + parts[0].length <= firstMax || !first)) first += `${parts.shift()} `;
  const chunks = [first.trim()];
  let rest = '';
  for (const p of parts) {
    if (rest.length + p.length > restMax) { chunks.push(rest.trim()); rest = ''; }
    rest += `${p} `;
  }
  if (rest.trim()) chunks.push(rest.trim());
  return chunks.map((c) => c.slice(0, restMax));
}

/** Wählt eine möglichst natürliche, männliche deutsche Gerätestimme. */
export function pickBrowserVoice(preferredName) {
  const voices = window.speechSynthesis?.getVoices() || [];
  const german = voices.filter((v) => /^de(-|_|$)/i.test(v.lang));
  if (preferredName) {
    const chosen = german.find((v) => v.name === preferredName);
    if (chosen) return chosen;
  }
  const score = (v) =>
    (/natural|online|neural/i.test(v.name) ? 4 : 0) +
    (/conrad|killian|florian|stefan|markus|ralf|jonas|bernd|male|männlich/i.test(v.name) ? 3 : 0) +
    (/de-DE/i.test(v.lang) ? 1 : 0) -
    (/katja|amala|hedda|marlene|vicki|anna|petra|female|weiblich|seraphina/i.test(v.name) ? 3 : 0);
  return german.sort((a, b) => score(b) - score(a))[0] || null;
}

export function germanBrowserVoices() {
  return (window.speechSynthesis?.getVoices() || []).filter((v) => /^de(-|_|$)/i.test(v.lang));
}

export function createVoice({ onNotice = () => {} } = {}) {
  const recognitionSupported = Boolean(SR);
  const secure = window.isSecureContext;
  let recognition = null;
  let speakToken = 0;
  let currentAudio = null;
  let fetchController = null;
  let speaking = false;
  let geminiFailedNotice = false;

  // Stimmen laden asynchron – einmal anstoßen.
  window.speechSynthesis?.getVoices();

  function micProblem() {
    if (!recognitionSupported) return 'Dieser Browser unterstützt keine Spracheingabe. Bitte Chrome oder Edge verwenden.';
    if (!secure) return 'Das Mikrofon funktioniert nur über eine sichere Verbindung (https oder localhost). Anleitung für das Handy: README, Abschnitt „JARVIS auf dem Handy“.';
    return null;
  }

  /** Hört zu und liefert den erkannten Text ('' wenn nichts gesagt wurde). */
  function listen({ onInterim } = {}) {
    const problem = micProblem();
    if (problem) return Promise.reject(new Error(problem));
    stopListening();
    return new Promise((resolve, reject) => {
      const rec = new SR();
      recognition = rec;
      rec.lang = 'de-DE';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let finalText = '';
      let failed = null;
      rec.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        onInterim?.((finalText + interim).trim());
      };
      rec.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          failed = new Error('Der Mikrofonzugriff wurde verweigert. Bitte im Browser erlauben (Schloss-Symbol neben der Adresse → Mikrofon).');
        } else if (event.error === 'network') {
          failed = new Error('Die Spracherkennung braucht eine Internetverbindung.');
        } else if (event.error === 'audio-capture') {
          failed = new Error('Kein Mikrofon gefunden.');
        }
        // 'no-speech' und 'aborted' sind kein Fehler – es wurde einfach nichts gesagt.
      };
      rec.onend = () => {
        if (recognition === rec) recognition = null;
        if (failed) reject(failed);
        else resolve(finalText.trim());
      };
      try {
        rec.start();
      } catch (err) {
        recognition = null;
        reject(new Error(`Spracherkennung konnte nicht starten: ${err.message}`));
      }
    });
  }

  /** Beendet das Zuhören; bereits Gesagtes wird noch ausgewertet. */
  function stopListening() {
    try { recognition?.stop(); } catch { /* bereits beendet */ }
  }

  function isListening() {
    return Boolean(recognition);
  }

  /** Unterbricht jede laufende Sprachausgabe sofort. */
  function stopSpeaking() {
    speakToken++;
    speaking = false;
    fetchController?.abort();
    fetchController = null;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = '';
      currentAudio = null;
    }
    window.speechSynthesis?.cancel();
  }

  function isSpeaking() {
    return speaking;
  }

  /**
   * Liest Text vor. Gibt true zurück, wenn bis zum Ende gesprochen wurde,
   * false bei Unterbrechung.
   */
  async function speak(markdown, { engine = 'browser', voiceName, browserVoiceName } = {}) {
    stopSpeaking();
    const text = plainForSpeech(markdown);
    if (!text) return true;
    const token = ++speakToken;
    speaking = true;
    try {
      if (engine === 'gemini') {
        const done = await speakGemini(text, voiceName, token, browserVoiceName);
        return done;
      }
      return await speakBrowser(text, token, browserVoiceName);
    } finally {
      if (token === speakToken) speaking = false;
    }
  }

  async function fetchAudio(text, voiceName) {
    fetchController = new AbortController();
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice: voiceName }),
      signal: fetchController.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Stimme nicht verfügbar (${res.status})`);
    }
    return URL.createObjectURL(await res.blob());
  }

  async function speakGemini(text, voiceName, token, browserVoiceName) {
    const chunks = splitForSpeech(text);
    let next = fetchAudio(chunks[0], voiceName);
    for (let i = 0; i < chunks.length; i++) {
      let url;
      try {
        url = await next;
      } catch (err) {
        if (token !== speakToken) return false;
        // Rückfall auf die Gerätestimme, damit JARVIS trotzdem antwortet.
        if (!geminiFailedNotice) {
          geminiFailedNotice = true;
          onNotice(`Gemini-Stimme nicht verfügbar (${err.message}) – ich nutze die Gerätestimme.`);
        }
        return speakBrowser(chunks.slice(i).join(' '), token, browserVoiceName);
      }
      if (token !== speakToken) { URL.revokeObjectURL(url); return false; }
      // Nächsten Teil schon laden, während dieser abgespielt wird.
      if (i + 1 < chunks.length) {
        next = fetchAudio(chunks[i + 1], voiceName);
        next.catch(() => {}); // Fehler wird beim await oben behandelt
      }
      const result = await playUrl(url, token);
      URL.revokeObjectURL(url);
      if (result === 'error') {
        if (!geminiFailedNotice) {
          geminiFailedNotice = true;
          onNotice('Die Gemini-Stimme konnte nicht abgespielt werden – ich nutze die Gerätestimme.');
        }
        return speakBrowser(chunks.slice(i).join(' '), token, browserVoiceName);
      }
      if (result !== 'ended') return false;
    }
    return true;
  }

  /** Spielt Audio ab: 'ended' (fertig), 'interrupted' (unterbrochen) oder 'error'. */
  function playUrl(url, token) {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      currentAudio = audio;
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (currentAudio === audio) currentAudio = null;
        resolve(token === speakToken ? result : 'interrupted');
      };
      audio.onended = () => finish('ended');
      audio.onerror = () => finish(token === speakToken ? 'error' : 'interrupted');
      audio.onpause = () => { if (!audio.ended) finish('interrupted'); };
      audio.play().catch((err) => finish(err?.name === 'NotAllowedError' || err?.name === 'NotSupportedError' ? 'error' : 'interrupted'));
    });
  }

  async function speakBrowser(text, token, browserVoiceName) {
    const synth = window.speechSynthesis;
    if (!synth) {
      onNotice('Dieser Browser kann nicht vorlesen.');
      return false;
    }
    const voice = pickBrowserVoice(browserVoiceName);
    // Satzweise sprechen: lange Texte brechen in manchen Browsern sonst ab.
    for (const sentence of sentences(text)) {
      if (token !== speakToken) return false;
      const ok = await new Promise((resolve) => {
        // Sicherung: Manche Browser melden das Ende eines Satzes nie.
        const guard = setTimeout(() => resolve(token === speakToken), 4000 + sentence.length * 110);
        const done = (value) => { clearTimeout(guard); resolve(value); };
        const u = new SpeechSynthesisUtterance(sentence);
        u.lang = voice?.lang || 'de-DE';
        if (voice) u.voice = voice;
        u.rate = 1.0;
        u.pitch = 0.85; // etwas tiefer
        u.onend = () => done(true);
        u.onerror = (e) => done(e.error === 'interrupted' || e.error === 'canceled' ? false : token === speakToken);
        synth.speak(u);
      });
      if (!ok) return false;
    }
    return token === speakToken;
  }

  return { recognitionSupported, micProblem, listen, stopListening, isListening, speak, stopSpeaking, isSpeaking };
}
