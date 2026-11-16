// JARVIS – Oberfläche (läuft im Browser, spricht nur mit dem eigenen Server).
import { renderMarkdown } from './markdown.js';
import { createVoice, germanBrowserVoices, pickBrowserVoice } from './voice.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
};

const state = {
  overview: null,
  conversations: [],
  currentId: localStorageGet('jarvis.currentConversation'),
  controller: null,
  voiceLoop: false, // Gesprächsmodus aktiv (Zuhören → Antwort → Zuhören …)
};

const voice = createVoice({ onNotice: (text) => showNotice(text) });
const pref = {
  get autoSpeak() { return localStorageGet('jarvis.autoSpeak') === '1'; },
  set autoSpeak(v) { localStorageSet('jarvis.autoSpeak', v ? '1' : null); },
  get conversationMode() { return localStorageGet('jarvis.conversationMode') !== '0'; },
  set conversationMode(v) { localStorageSet('jarvis.conversationMode', v ? null : '0'); },
  get browserVoice() { return localStorageGet('jarvis.browserVoice'); },
  set browserVoice(v) { localStorageSet('jarvis.browserVoice', v || null); },
};

function localStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function localStorageSet(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* egal */ }
}

// ---------------- API ----------------
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Keine Verbindung zum JARVIS-Server. Läuft er noch?');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') {
    showLogin();
    throw new ApiError(401, 'Bitte erneut anmelden.');
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `Fehler ${res.status}`);
  return data;
}

// ---------------- Status ----------------
const STATUS = {
  idle: 'Bereit',
  thinking: 'Denkt nach …',
  listening: 'Hört zu … (Mikrofon aktiv)',
  talking: 'Spricht …',
  speaking: 'Antwortet …',
  memory: 'Aktualisiert Gedächtnis …',
  error: 'Fehler',
};
function setStatus(kind, text) {
  // Während JARVIS spricht, bleibt „Spricht …“ sichtbar.
  if (voice.isSpeaking() && (kind === 'idle' || kind === 'memory')) return;
  const orbState = kind === 'memory' ? 'thinking' : kind === 'talking' ? 'speaking' : kind;
  document.querySelectorAll('.orb').forEach((o) => { o.dataset.state = orbState; });
  $('#status-text').textContent = text || STATUS[kind] || '';
}

function showNotice(text) {
  const n = $('#notice');
  n.textContent = text || '';
  n.hidden = !text;
}

// ---------------- Anmeldung ----------------
function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-password').focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('/auth/login', {
      method: 'POST',
      body: { password: $('#login-password').value, deviceName: $('#login-device').value },
    });
    $('#login-password').value = '';
    await start();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  closePanels();
  showLogin();
});

// ---------------- Start ----------------
async function start() {
  const status = await fetch('/api/status').then((r) => r.json()).catch(() => null);
  if (!status) {
    document.body.textContent = 'Der JARVIS-Server ist nicht erreichbar.';
    return;
  }
  if (!status.authenticated) return showLogin();

  $('#login').hidden = true;
  $('#app').hidden = false;
  state.overview = await api('/overview');
  updateProviderNotice();
  await loadConversations();
  // Zuletzt auf diesem Gerät geöffnetes Gespräch – sonst das zuletzt aktive
  // Gespräch (z. B. auf dem anderen Gerät begonnen).
  const target = state.conversations.find((c) => c.id === state.currentId) || state.conversations[0];
  if (target) await openConversation(target.id);
  else newConversation();
  setStatus('idle');
  $('#input').focus();

  // Schnellstart „Mit JARVIS sprechen“ (App-Verknüpfung auf dem Handy)
  if (new URLSearchParams(location.search).get('voice') === '1') {
    history.replaceState(null, '', '/');
    startListening();
  }
}

function updateProviderNotice() {
  const { providers, activeProvider } = state.overview;
  const active = providers.find((p) => p.id === activeProvider);
  if (!providers.some((p) => p.configured)) {
    showNotice('Es ist noch kein API-Schlüssel eingetragen. Tragen Sie einen Schlüssel in die Datei „.env“ ein und starten Sie JARVIS neu (Anleitung: README.md).');
  } else if (!active?.configured) {
    showNotice(`Für den gewählten Anbieter „${active?.label || activeProvider}“ fehlt der API-Schlüssel. Wählen Sie unter Einstellungen einen anderen Anbieter.`);
  } else {
    showNotice('');
  }
}

// ---------------- Gespräche ----------------
async function loadConversations() {
  const { conversations } = await api('/conversations');
  state.conversations = conversations;
  renderConversationList();
}

function renderConversationList() {
  const list = $('#conversation-list');
  list.replaceChildren();
  if (!state.conversations.length) {
    list.append(el('div', { class: 'empty' }, 'Noch keine Gespräche.'));
    return;
  }
  for (const c of state.conversations) {
    list.append(
      el('div', { class: `conv${c.id === state.currentId ? ' active' : ''}` },
        el('button', { class: 'conv-title', title: c.title, onclick: () => { openConversation(c.id); closeSidebar(); } }, c.title),
        el('div', { class: 'conv-actions' },
          el('button', { title: 'Umbenennen', 'aria-label': 'Umbenennen', onclick: () => renameConversation(c) }, '✎'),
          el('button', { title: 'Löschen', 'aria-label': 'Löschen', onclick: () => deleteConversation(c) }, '🗑'),
        ),
      ),
    );
  }
}

function newConversation() {
  if (state.controller) return;
  state.currentId = null;
  localStorageSet('jarvis.currentConversation', null);
  $('#messages').replaceChildren(welcomeNode());
  renderConversationList();
  $('#input').focus();
}

function welcomeNode() {
  const node = document.createElement('div');
  node.className = 'welcome';
  node.append(
    el('div', { class: 'orb orb-large', 'data-state': 'idle', 'aria-hidden': 'true' }, el('span')),
    el('h2', {}, greeting()),
    el('p', { class: 'muted' }, 'Schreiben Sie einfach los. Wichtiges über Sie merke ich mir – Sie behalten unter „Gedächtnis“ jederzeit die Kontrolle.'),
  );
  return node;
}

function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
  return `${part}. Wie kann ich Ihnen helfen?`;
}

async function openConversation(id) {
  if (state.controller) return;
  try {
    const { conversation, messages } = await api(`/conversations/${encodeURIComponent(id)}`);
    state.currentId = conversation.id;
    localStorageSet('jarvis.currentConversation', conversation.id);
    const box = $('#messages');
    box.replaceChildren();
    if (!messages.length) box.append(welcomeNode());
    for (const m of messages) {
      box.append(messageNode(m.role, m.content));
      if (m.role === 'assistant') box.append(speakActions(m.content));
    }
    renderConversationList();
    scrollToBottom(true);
  } catch (err) {
    if (err.status === 404) {
      await loadConversations();
      newConversation();
    } else {
      showNotice(err.message);
    }
  }
}

async function renameConversation(c) {
  const title = prompt('Neuer Name für das Gespräch:', c.title);
  if (!title || !title.trim()) return;
  await api(`/conversations/${encodeURIComponent(c.id)}`, { method: 'PATCH', body: { title } });
  await loadConversations();
}

async function deleteConversation(c) {
  if (!(await confirmDialog(`Gespräch „${c.title}“ endgültig löschen? Das kann nicht rückgängig gemacht werden. Gespeicherte Erinnerungen bleiben erhalten.`))) return;
  await api(`/conversations/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
  if (c.id === state.currentId) newConversation();
  await loadConversations();
}

$('#new-chat').addEventListener('click', () => { newConversation(); closeSidebar(); });

// ---------------- Nachrichten ----------------
function messageNode(role, content, { streaming = false, error = false } = {}) {
  const bubble = el('div', { class: `bubble${streaming ? ' streaming' : ''}` });
  if (role === 'user') bubble.textContent = content;
  else bubble.innerHTML = renderMarkdown(content);
  return el('div', { class: `msg ${error ? 'error' : role}` }, bubble);
}

function scrollToBottom(force = false) {
  const box = $('#messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  if (force || nearBottom) box.scrollTop = box.scrollHeight;
}

function send(text, opts) {
  const promise = sendInner(text, opts);
  state.sendPromise = promise;
  promise.finally(() => { if (state.sendPromise === promise) state.sendPromise = null; });
  return promise;
}

async function sendInner(text, { viaVoice = false, onAnswer } = {}) {
  const box = $('#messages');
  box.querySelector('.welcome')?.remove();
  box.append(messageNode('user', text));
  const assistantNode = messageNode('assistant', '', { streaming: true });
  const bubble = assistantNode.querySelector('.bubble');
  box.append(assistantNode);
  scrollToBottom(true);

  const controller = new AbortController();
  state.controller = controller;
  setComposerBusy(true);
  setStatus('thinking');

  let answer = '';
  let completed = false;
  let renderQueued = false;
  const render = () => {
    renderQueued = false;
    bubble.innerHTML = renderMarkdown(answer);
    scrollToBottom();
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: state.currentId, text, viaVoice }),
      signal: controller.signal,
    });
    if (res.status === 401) { showLogin(); return null; }
    if (!res.ok || !res.body) throw new Error(`Serverfehler ${res.status}`);

    for await (const { event, data } of readEvents(res.body)) {
      if (event === 'start') {
        if (state.currentId !== data.conversation.id) {
          state.currentId = data.conversation.id;
          localStorageSet('jarvis.currentConversation', data.conversation.id);
        }
        loadConversations().catch(() => {});
      } else if (event === 'token') {
        if (!answer) setStatus('speaking');
        answer += data.text;
        if (!renderQueued) { renderQueued = true; requestAnimationFrame(render); }
      } else if (event === 'retry') {
        setStatus('thinking', `Verbindungsproblem – neuer Versuch (${data.attempt}) …`);
      } else if (event === 'done') {
        answer = data.assistantMessage.content;
        render();
        bubble.classList.remove('streaming');
        assistantNode.after(speakActions(answer));
        completed = true;
        onAnswer?.(answer); // z. B. sofort vorlesen – Gedächtnis läuft parallel weiter
        if (state.overview?.settings?.['memory.autoExtract']) setStatus('memory');
      } else if (event === 'memory') {
        showMemoryChanges(data.changes);
      } else if (event === 'memory_error') {
        box.append(el('div', { class: 'memory-note muted' }, `⚠ ${data.message}`));
      } else if (event === 'error') {
        throw Object.assign(new Error(data.message), { code: data.code });
      }
    }
    setStatus('idle');
    return completed ? answer : null;
  } catch (err) {
    bubble.classList.remove('streaming');
    if (controller.signal.aborted) {
      if (answer) bubble.innerHTML = renderMarkdown(`${answer}\n\n_(abgebrochen)_`);
      else assistantNode.remove();
      setStatus('idle', 'Abgebrochen');
    } else {
      if (!answer) assistantNode.remove();
      box.append(messageNode('assistant', `**Es ist ein Problem aufgetreten:** ${err.message}`, { error: true }));
      setStatus('error', 'Fehler – Details im Chat');
    }
    scrollToBottom(true);
    return null;
  } finally {
    state.controller = null;
    setComposerBusy(false);
    loadConversations().catch(() => {});
  }
}

async function* readEvents(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (event === 'end') return;
      yield { event, data: data ? JSON.parse(data) : {} };
    }
  }
}

function showMemoryChanges(changes) {
  const labels = { added: 'Gemerkt', updated: 'Aktualisiert', deactivated: 'Deaktiviert' };
  for (const change of changes) {
    const note = el('div', { class: 'memory-note' },
      `🧠 ${labels[change.type] || change.type}: ${change.memory.content}`,
      change.type === 'added'
        ? el('button', { class: 'ghost', onclick: async (e) => {
            e.target.disabled = true;
            await api(`/memories/${change.memory.id}`, { method: 'DELETE' });
            note.textContent = `🗑 Nicht gemerkt: ${change.memory.content}`;
            if (!$('#memory-panel').hidden) loadMemories();
          } }, 'Rückgängig')
        : null,
    );
    $('#messages').append(note);
  }
  scrollToBottom();
  if (!$('#memory-panel').hidden) loadMemories();
}

function setComposerBusy(busy) {
  const active = busy || voice.isSpeaking();
  $('#send').hidden = active;
  $('#stop').hidden = !active;
}

const input = $('#input');
function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, window.innerHeight * 0.4)}px`;
}
input.addEventListener('input', autosize);
input.addEventListener('keydown', (e) => {
  // Enter = senden, Umschalt+Enter = neue Zeile (auf dem Handy: Senden-Knopf)
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || state.controller) return;
  input.value = '';
  autosize();
  state.voiceLoop = false;
  voice.stopSpeaking();
  send(text, { onAnswer: (answer) => { if (pref.autoSpeak) speakAnswer(answer); } });
});
$('#stop').addEventListener('click', () => {
  state.voiceLoop = false;
  state.controller?.abort();
  voice.stopListening();
  stopSpeech();
});

// ---------------- Stimme ----------------
function voiceOptions() {
  const settings = state.overview?.settings || {};
  return {
    engine: settings['voice.engine'] === 'gemini' && state.overview?.voice?.geminiAvailable ? 'gemini' : 'browser',
    voiceName: settings['voice.name'],
    browserVoiceName: pref.browserVoice,
  };
}

function showVoiceBar(kind) {
  const bar = $('#voice-bar');
  bar.hidden = !kind;
  bar.classList.toggle('speaking', kind === 'speaking');
  $('#voice-bar-text').textContent =
    kind === 'listening' ? 'Mikrofon aktiv – ich höre zu … (zum Beenden 🎤 antippen)'
      : kind === 'speaking' ? 'JARVIS spricht … (Stopp oder 🎤 unterbricht)' : '';
  $('#mic').classList.toggle('active', kind === 'listening');
  $('#mic').setAttribute('aria-label', kind === 'listening' ? 'Zuhören beenden' : 'Spracheingabe starten');
}

/** Liest eine Antwort vor; danach ggf. automatisch weiter zuhören. */
async function speakAnswer(text, { continueListening = false } = {}) {
  setStatus('talking');
  showVoiceBar('speaking');
  const speaking = voice.speak(text, voiceOptions());
  setComposerBusy(Boolean(state.controller)); // zeigt „Stopp“, solange gesprochen wird
  const finished = await speaking;
  if (!voice.isListening()) showVoiceBar(null);
  setComposerBusy(Boolean(state.controller));
  if (!voice.isListening() && !state.controller) setStatus('idle');
  if (finished && continueListening && state.voiceLoop && pref.conversationMode) {
    if (state.sendPromise) await state.sendPromise; // Gedächtnis-Auswertung abwarten
    if (state.voiceLoop && !voice.isSpeaking() && !voice.isListening()) startListening();
  }
}

function stopSpeech() {
  voice.stopSpeaking();
  showVoiceBar(voice.isListening() ? 'listening' : null);
  setComposerBusy(Boolean(state.controller));
  if (!state.controller && !voice.isListening()) setStatus('idle');
}

async function startListening() {
  if (state.controller) return;
  const problem = voice.micProblem();
  if (problem) { showNotice(problem); return; }
  voice.stopSpeaking(); // JARVIS unterbrechen, wenn er gerade spricht
  showVoiceBar('listening');
  setStatus('listening');
  setComposerBusy(false);
  const before = input.value;
  let text = '';
  try {
    text = await voice.listen({ onInterim: (t) => { input.value = t; autosize(); } });
  } catch (err) {
    state.voiceLoop = false;
    showNotice(err.message);
  }
  showVoiceBar(null);
  if (!text) {
    input.value = before;
    autosize();
    state.voiceLoop = false;
    setStatus('idle');
    return;
  }
  input.value = '';
  autosize();
  state.voiceLoop = true;
  const answer = await send(text, {
    viaVoice: true,
    onAnswer: (a) => speakAnswer(a, { continueListening: true }),
  });
  if (!answer) state.voiceLoop = false;
}

$('#mic').addEventListener('click', () => {
  if (voice.isListening()) { voice.stopListening(); return; }
  startListening();
});
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code === 'Space') {
    e.preventDefault();
    if (voice.isListening()) voice.stopListening();
    else startListening();
  }
});

function setSpeakToggle(on) {
  const btn = $('#speak-toggle');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.textContent = on ? '🔊' : '🔈';
  btn.title = on ? 'Antworten werden vorgelesen (antippen zum Ausschalten)' : 'Antworten immer vorlesen';
}
setSpeakToggle(pref.autoSpeak);
$('#speak-toggle').addEventListener('click', () => {
  pref.autoSpeak = !pref.autoSpeak;
  setSpeakToggle(pref.autoSpeak);
  if (!pref.autoSpeak) stopSpeech();
  const box = $('#setting-auto-speak');
  if (box) box.checked = pref.autoSpeak;
});
if (voice.micProblem()) {
  $('#mic').title = voice.micProblem();
}

function speakActions(content) {
  return el('div', { class: 'msg-actions' },
    el('button', { type: 'button', onclick: () => { state.voiceLoop = false; speakAnswer(content); } }, '▶ Vorlesen'),
  );
}

// ---------------- Panels ----------------
function openPanel(id) {
  closePanels();
  $(id).hidden = false;
  $('#panel-backdrop').hidden = false;
}
function closePanels() {
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = true; });
  $('#panel-backdrop').hidden = true;
}
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closePanels));
$('#panel-backdrop').addEventListener('click', closePanels);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePanels(); closeSidebar(); } });

function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebar-backdrop').hidden = true;
}
$('#toggle-sidebar').addEventListener('click', () => {
  $('#sidebar').classList.add('open');
  $('#sidebar-backdrop').hidden = false;
});
$('#sidebar-backdrop').addEventListener('click', closeSidebar);

// ---------------- Gedächtnis ----------------
const CATEGORY_LABELS = {
  person: 'Person', vorliebe: 'Vorliebe', projekt: 'Projekt', aufgabe: 'Aufgabe',
  entscheidung: 'Entscheidung', wissen: 'Wissen', sonstiges: 'Sonstiges',
};
const IMPORTANCE_LABELS = { 1: 'nebensächlich', 2: 'normal', 3: 'sehr wichtig' };

$('#open-memory').addEventListener('click', async () => {
  openPanel('#memory-panel');
  const select = $('#memory-new-category');
  if (!select.options.length) {
    for (const c of state.overview.memoryCategories) select.append(el('option', { value: c }, CATEGORY_LABELS[c] || c));
    select.value = 'sonstiges';
  }
  await loadMemories();
});

let searchTimer;
$('#memory-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadMemories, 250);
});

async function loadMemories() {
  const q = $('#memory-search').value.trim();
  const list = $('#memory-list');
  try {
    const { memories } = await api(`/memories${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    list.replaceChildren();
    if (!memories.length) {
      list.append(el('div', { class: 'empty' }, q ? 'Nichts gefunden.' : 'JARVIS hat sich noch nichts gemerkt.'));
      return;
    }
    for (const m of memories) list.append(memoryNode(m));
  } catch (err) {
    list.replaceChildren(el('div', { class: 'error' }, err.message));
  }
}

function memoryNode(m) {
  const node = el('div', { class: `memory${m.enabled ? '' : ' disabled'}` });
  const view = () => {
    node.replaceChildren(
      el('div', { class: 'memory-text' }, m.content),
      el('div', { class: 'memory-meta' },
        el('span', { class: 'tag' }, CATEGORY_LABELS[m.category] || m.category),
        el('span', { class: `tag imp${m.importance}` }, IMPORTANCE_LABELS[m.importance]),
        el('span', { class: `tag${m.source === 'auto' ? ' auto' : ''}` }, m.source === 'auto' ? 'automatisch' : 'manuell'),
        m.enabled ? null : el('span', { class: 'tag' }, 'deaktiviert'),
        el('span', {}, new Date(m.updated_at).toLocaleDateString('de-DE')),
      ),
      el('div', { class: 'memory-actions' },
        el('button', { onclick: edit }, 'Bearbeiten'),
        el('button', { onclick: toggle }, m.enabled ? 'Deaktivieren' : 'Aktivieren'),
        el('button', { class: 'danger', onclick: remove }, 'Löschen'),
      ),
    );
  };
  const edit = () => {
    const text = el('textarea', { rows: 3, maxlength: 2000 });
    text.value = m.content;
    const cat = el('select', {}, state.overview.memoryCategories.map((c) => el('option', { value: c }, CATEGORY_LABELS[c] || c)));
    cat.value = m.category;
    const imp = el('select', {}, [1, 2, 3].map((i) => el('option', { value: i }, IMPORTANCE_LABELS[i])));
    imp.value = String(m.importance);
    node.replaceChildren(
      text,
      el('div', { class: 'row' }, cat, imp),
      el('div', { class: 'memory-actions' },
        el('button', { class: 'primary', onclick: async () => {
          try {
            ({ memory: m } = await api(`/memories/${m.id}`, { method: 'PATCH', body: { content: text.value, category: cat.value, importance: Number(imp.value) } }));
            node.classList.toggle('disabled', !m.enabled);
            view();
          } catch (err) { alert(err.message); }
        } }, 'Speichern'),
        el('button', { onclick: view }, 'Abbrechen'),
      ),
    );
    text.focus();
  };
  const toggle = async () => {
    ({ memory: m } = await api(`/memories/${m.id}`, { method: 'PATCH', body: { enabled: !m.enabled } }));
    node.classList.toggle('disabled', !m.enabled);
    view();
  };
  const remove = async () => {
    if (!(await confirmDialog(`Diese Erinnerung endgültig löschen?\n\n„${m.content}“`))) return;
    await api(`/memories/${m.id}`, { method: 'DELETE' });
    node.remove();
  };
  view();
  return node;
}

$('#memory-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = $('#memory-new').value.trim();
  if (!content) return;
  try {
    await api('/memories', {
      method: 'POST',
      body: { content, category: $('#memory-new-category').value, importance: Number($('#memory-new-importance').value) },
    });
    $('#memory-new').value = '';
    await loadMemories();
  } catch (err) {
    alert(err.message);
  }
});

// ---------------- Einstellungen ----------------
$('#open-settings').addEventListener('click', async () => {
  openPanel('#settings-panel');
  state.overview = await api('/overview');
  renderSettings();
  await loadDevices();
});

function renderSettings() {
  const { providers, activeProvider, settings, features, version } = state.overview;
  const list = $('#provider-list');
  list.replaceChildren();
  for (const p of providers) {
    const radio = el('input', { type: 'radio', name: 'provider', value: p.id, checked: p.id === activeProvider, disabled: !p.configured });
    radio.addEventListener('change', async () => {
      try {
        const res = await api('/settings', { method: 'PATCH', body: { aiProvider: p.id } });
        state.overview.activeProvider = p.id;
        state.overview.settings = res.settings;
        updateProviderNotice();
      } catch (err) { alert(err.message); renderSettings(); }
    });
    list.append(
      el('label', { class: `provider${p.configured ? '' : ' unavailable'}` },
        radio,
        el('div', {}, el('div', {}, p.label), el('div', { class: 'model' }, p.configured ? p.model : 'kein API-Schlüssel eingetragen')),
        el('span', { class: `dot${p.configured ? ' on' : ''}`, title: p.configured ? 'eingerichtet' : 'nicht eingerichtet' }),
      ),
    );
  }

  const auto = $('#setting-auto-memory');
  auto.checked = Boolean(settings['memory.autoExtract']);
  auto.onchange = async () => {
    const res = await api('/settings', { method: 'PATCH', body: { memoryAutoExtract: auto.checked } });
    state.overview.settings = res.settings;
  };

  renderVoiceSettings();

  const featureNames = {
    textChat: 'Text-Chat',
    memory: 'Langzeitgedächtnis',
    voice: 'Sprache (Mikrofon & Vorlesen)',
    deviceActions: 'Geräte-Steuerung (folgt später)',
  };
  $('#feature-list').replaceChildren(
    ...Object.entries(features).map(([k, on]) => el('li', { class: on ? 'on' : '' }, featureNames[k] || k)),
  );
  $('#version').textContent = `JARVIS Version ${version} · angemeldet als „${state.overview.device}“`;
}

function renderVoiceSettings() {
  const { voice: voiceInfo, settings } = state.overview;
  const engine = voiceOptions().engine;
  const list = $('#voice-engine-list');
  list.replaceChildren();
  const engines = [
    { id: 'gemini', label: 'Natürliche Stimme (Google Gemini)', detail: voiceInfo.geminiAvailable ? 'beste Qualität, braucht Internet' : 'GEMINI_API_KEY fehlt in der .env', available: voiceInfo.geminiAvailable },
    { id: 'browser', label: 'Gerätestimme', detail: 'kostenlos, Qualität je nach Gerät', available: Boolean(window.speechSynthesis) },
  ];
  for (const e of engines) {
    const radio = el('input', { type: 'radio', name: 'voice-engine', value: e.id, checked: e.id === engine, disabled: !e.available });
    radio.addEventListener('change', async () => {
      try {
        const res = await api('/settings', { method: 'PATCH', body: { voiceEngine: e.id } });
        state.overview.settings = res.settings;
        renderVoiceSettings();
      } catch (err) { alert(err.message); renderVoiceSettings(); }
    });
    list.append(el('label', { class: `provider${e.available ? '' : ' unavailable'}` },
      radio, el('div', {}, el('div', {}, e.label), el('div', { class: 'model' }, e.detail))));
  }

  const select = $('#voice-name');
  select.replaceChildren(...voiceInfo.voices.map((v) => el('option', { value: v.id }, `${v.id} – ${v.description}`)));
  select.value = settings['voice.name'];
  select.onchange = async () => {
    const res = await api('/settings', { method: 'PATCH', body: { voiceName: select.value } });
    state.overview.settings = res.settings;
  };
  $('#gemini-voice-row').hidden = engine !== 'gemini';

  const bsel = $('#browser-voice');
  const fill = () => {
    const voices = germanBrowserVoices();
    const chosen = pickBrowserVoice(pref.browserVoice);
    bsel.replaceChildren(...(voices.length
      ? voices.map((v) => el('option', { value: v.name }, v.name))
      : [el('option', { value: '' }, 'Keine deutsche Gerätestimme gefunden')]));
    if (chosen) bsel.value = chosen.name;
  };
  fill();
  if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = fill;
  bsel.onchange = () => { pref.browserVoice = bsel.value; };
  $('#browser-voice-row').hidden = engine !== 'browser';

  $('#voice-test').onclick = () => speakAnswer('Guten Tag. Ich bin JARVIS. Alle Systeme sind einsatzbereit.');
  const autoSpeak = $('#setting-auto-speak');
  autoSpeak.checked = pref.autoSpeak;
  autoSpeak.onchange = () => { pref.autoSpeak = autoSpeak.checked; setSpeakToggle(pref.autoSpeak); };
  const conv = $('#setting-conversation-mode');
  conv.checked = pref.conversationMode;
  conv.onchange = () => { pref.conversationMode = conv.checked; };
  $('#mic-hint').textContent = voice.micProblem() || 'Tipp: 🎤 antippen und sprechen. Am PC geht auch Strg + Leertaste. Die Spracherkennung läuft über den Dienst des Browsers (Google bzw. Microsoft).';
}

async function loadDevices() {
  const { devices } = await api('/devices');
  const list = $('#device-list');
  list.replaceChildren(
    ...devices.map((d) =>
      el('div', { class: 'device' },
        el('div', {},
          el('div', {}, d.name, d.current ? el('span', { class: 'muted' }, ' (dieses Gerät)') : null),
          el('div', { class: 'muted small' }, `zuletzt aktiv: ${new Date(d.lastSeenAt).toLocaleString('de-DE')}`),
        ),
        d.current ? null : el('button', { onclick: async () => {
          if (!(await confirmDialog(`Gerät „${d.name}“ abmelden?`))) return;
          await api(`/devices/${d.id}`, { method: 'DELETE' });
          loadDevices();
        } }, 'Abmelden'),
      ),
    ),
  );
}

// ---------------- Bestätigung ----------------
function confirmDialog(text) {
  const dialog = $('#confirm');
  $('#confirm-text').textContent = text;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}

start().catch((err) => {
  console.error(err);
  showNotice(err.message);
});
