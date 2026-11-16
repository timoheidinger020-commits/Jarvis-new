// Sprachausgabe (Text → Stimme) über Google Gemini TTS.
// Austauschbar: Weitere Anbieter (z. B. ElevenLabs, Azure) können hier
// mit derselben Funktion synthesize() ergänzt werden.
import { AIError, errorFromStatus, networkError } from '../ai/errors.js';

// Männliche, ruhige Stimmen von Gemini (Name → Charakter).
export const GEMINI_VOICES = {
  Charon: 'ruhig, informativ',
  Algenib: 'tief, leicht rau',
  Orus: 'fest, bestimmt',
  Iapetus: 'klar, deutlich',
  Alnilam: 'souverän',
  Sadaltager: 'kundig, warm',
  Rasalgethi: 'sachlich',
  Enceladus: 'sanft, gehaucht',
};

// Hinweis: Keine Regieanweisung ("Sprich ruhig: …") voranstellen – getestet:
// das Modell liest sie sonst mit vor. Den Charakter bestimmt die Stimme.

export const MAX_TTS_CHARS = 3000;

export function createTTS(geminiCfg, { timeoutMs = 60000, model }) {
  const configured = Boolean(geminiCfg.apiKey);

  async function synthesize(text, { voice = 'Charon', signal } = {}) {
    if (!configured) throw new AIError('not_configured', 'Für die Gemini-Stimme ist kein GEMINI_API_KEY eingetragen.', { provider: 'gemini' });
    const clean = String(text || '').trim().slice(0, MAX_TTS_CHARS);
    if (!clean) throw Object.assign(new Error('Kein Text zum Vorlesen.'), { status: 400 });
    const voiceName = GEMINI_VOICES[voice] ? voice : 'Charon';

    const url = `${geminiCfg.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiCfg.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: clean }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        }),
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
      });
    } catch (err) {
      throw networkError('gemini', err);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw errorFromStatus('gemini', res.status, json?.error?.message);

    const part = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part) throw new AIError('bad_response', 'Die Gemini-Stimme hat kein Audio geliefert.', { provider: 'gemini' });
    const audio = Buffer.from(part.inlineData.data, 'base64');
    return toWav(audio, part.inlineData.mimeType || '');
  }

  return { configured, model, synthesize, voices: GEMINI_VOICES };
}

/** Liefert WAV. Rohes PCM (audio/L16, audio/pcm) wird mit einem WAV-Kopf versehen. */
export function toWav(buffer, mimeType) {
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF') return buffer;
  const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1]) || 24000;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + buffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(buffer.length, 40);
  return Buffer.concat([header, buffer]);
}
