// Anmeldung: Ein Passwort (aus .env) → pro Gerät eine eigene Sitzung.
// Sitzungen werden in der Datenbank gespeichert (nur als Hash) und können
// in der Oberfläche einzeln abgemeldet werden ("Geräteverwaltung").
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { now } from './db.js';

const COOKIE = 'jarvis_session';
const SESSION_DAYS = 90;
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

const sha256 = (s) => createHash('sha256').update(s).digest();

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createAuth(db, { password }) {
  const attempts = new Map(); // ip -> { count, first }
  const expected = sha256(password || randomBytes(32).toString('hex'));

  function checkRate(ip) {
    const entry = attempts.get(ip);
    if (!entry || Date.now() - entry.first > WINDOW_MS) return true;
    return entry.count < MAX_ATTEMPTS;
  }
  function recordFailure(ip) {
    const entry = attempts.get(ip);
    if (!entry || Date.now() - entry.first > WINDOW_MS) attempts.set(ip, { count: 1, first: Date.now() });
    else entry.count++;
  }

  function tokenFrom(req) {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) return header.slice(7).trim();
    return parseCookies(req.headers.cookie)[COOKIE] || null;
  }

  function sessionFor(token) {
    if (!token) return null;
    const hash = sha256(token).toString('hex');
    const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hash);
    if (!row) return null;
    if (row.expires_at < now()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      return null;
    }
    return row;
  }

  return {
    login(req, res) {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      if (!checkRate(ip)) {
        return res.status(429).json({ error: 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.' });
      }
      const given = String(req.body?.password ?? '');
      if (!password || !timingSafeEqual(sha256(given), expected)) {
        recordFailure(ip);
        return res.status(401).json({ error: 'Falsches Passwort.' });
      }
      attempts.delete(ip);

      const token = randomBytes(32).toString('base64url');
      const ts = now();
      const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
      const deviceName = String(req.body?.deviceName || '').trim().slice(0, 60) || guessDevice(req.headers['user-agent']);
      db.prepare('INSERT INTO sessions (token_hash, device_name, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(sha256(token).toString('hex'), deviceName, String(req.headers['user-agent'] || '').slice(0, 300), ts, ts, expires);

      res.setHeader('Set-Cookie', cookieHeader(token, SESSION_DAYS * 86400, req.secure));
      return res.json({ ok: true, deviceName, token: req.body?.wantToken ? token : undefined });
    },

    logout(req, res) {
      const token = tokenFrom(req);
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token).toString('hex'));
      res.setHeader('Set-Cookie', cookieHeader('', 0, req.secure));
      res.json({ ok: true });
    },

    /** Middleware: lässt nur angemeldete Geräte durch. */
    require(req, res, next) {
      const session = sessionFor(tokenFrom(req));
      if (!session) return res.status(401).json({ error: 'Nicht angemeldet.' });
      // last_seen höchstens einmal pro Minute schreiben
      if (Date.now() - Date.parse(session.last_seen_at) > 60000) {
        db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now(), session.token_hash);
      }
      req.session = session;
      next();
    },

    isAuthenticated(req) {
      return Boolean(sessionFor(tokenFrom(req)));
    },

    listDevices(currentHash) {
      return db.prepare('SELECT token_hash, device_name, created_at, last_seen_at FROM sessions ORDER BY last_seen_at DESC').all()
        .map((r) => ({
          id: r.token_hash.slice(0, 16),
          name: r.device_name,
          createdAt: r.created_at,
          lastSeenAt: r.last_seen_at,
          current: r.token_hash === currentHash,
        }));
    },

    revokeDevice(id) {
      if (!/^[0-9a-f]{16}$/.test(id)) return false;
      return db.prepare('DELETE FROM sessions WHERE substr(token_hash, 1, 16) = ?').run(id).changes > 0;
    },
  };
}

function cookieHeader(value, maxAge, secure) {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function guessDevice(ua = '') {
  if (/android/i.test(ua)) return /SM-|Samsung/i.test(ua) ? 'Samsung-Smartphone' : 'Android-Gerät';
  if (/iphone|ipad/i.test(ua)) return 'iPhone/iPad';
  if (/windows/i.test(ua)) return 'Windows-PC';
  if (/mac os/i.test(ua)) return 'Mac';
  if (/linux/i.test(ua)) return 'Linux-PC';
  return 'Unbekanntes Gerät';
}
