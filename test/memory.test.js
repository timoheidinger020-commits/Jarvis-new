import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../server/db.js';
import { applyExtraction, parseExtraction } from '../server/memory/extractor.js';
import { createMemoryStore } from '../server/memory/store.js';

const freshStore = () => createMemoryStore(openDatabase(':memory:'));

test('Erinnerungen anlegen, bearbeiten, deaktivieren, löschen', () => {
  const store = freshStore();
  const m = store.add({ content: 'Der Benutzer heißt Timo.', category: 'person', importance: 3 });
  assert.equal(m.category, 'person');
  assert.equal(m.enabled, true);
  assert.equal(store.update(m.id, { content: 'Der Benutzer heißt Timo Heidinger.' }).content, 'Der Benutzer heißt Timo Heidinger.');
  assert.equal(store.update(m.id, { enabled: false }).enabled, false);
  assert.equal(store.relevant('Timo', 10).length, 0, 'deaktivierte Erinnerungen werden nicht verwendet');
  assert.equal(store.remove(m.id), true);
  assert.equal(store.get(m.id), null);
});

test('ungültige Werte werden bereinigt bzw. abgelehnt', () => {
  const store = freshStore();
  const m = store.add({ content: '  Test  ', category: 'quatsch', importance: 9 });
  assert.equal(m.content, 'Test');
  assert.equal(m.category, 'sonstiges');
  assert.equal(m.importance, 2);
  assert.throws(() => store.add({ content: '   ' }));
});

test('Volltextsuche findet Wortanfänge und Umlaute', () => {
  const store = freshStore();
  store.add({ content: 'Der Benutzer programmiert gerne in Python.' });
  store.add({ content: 'Der Benutzer wohnt in München.' });
  assert.equal(store.list({ query: 'python' }).length, 1);
  assert.equal(store.list({ query: 'Munchen' }).length, 1);
  assert.equal(store.list({ query: 'program' }).length, 1);
  assert.equal(store.list({ query: '"; DROP TABLE memories; --' }).length, 0);
});

test('bei vielen Erinnerungen werden passende ausgewählt', () => {
  const store = freshStore();
  for (let i = 0; i < 30; i++) store.add({ content: `Unwichtige Notiz Nummer ${i}`, importance: 1 });
  store.add({ content: 'Der Benutzer fährt einen Tesla.', importance: 1 });
  const chosen = store.relevant('Welches Auto fahre ich? Tesla?', 10);
  assert.equal(chosen.length, 10);
  assert.ok(chosen.some((m) => m.content.includes('Tesla')));
});

test('Extraktion: JSON wird auch mit Text drumherum erkannt', () => {
  const parsed = parseExtraction('Hier:\n```json\n{"add":[{"content":"X","category":"wissen"}],"update":[],"deactivate":[]}\n```');
  assert.equal(parsed.add.length, 1);
  assert.equal(parseExtraction('kein json'), null);
});

test('Extraktion: hinzufügen, aktualisieren, deaktivieren, Duplikate und Geheimnisse filtern', () => {
  const store = freshStore();
  const old = store.add({ content: 'Der Benutzer wohnt in Berlin.', category: 'person' });
  const other = store.add({ content: 'Der Benutzer mag Jazz.', category: 'vorliebe' });
  const changes = applyExtraction(
    store,
    {
      add: [
        { content: 'Der Benutzer trinkt Kaffee schwarz.', category: 'vorliebe', importance: 2 },
        { content: 'der benutzer mag jazz', category: 'vorliebe' }, // Duplikat
        { content: 'Das Passwort des Benutzers ist: geheim123', category: 'person' }, // Geheimnis
      ],
      update: [{ id: old.id, content: 'Der Benutzer wohnt in Hamburg.' }, { id: 9999, content: 'fremd' }],
      deactivate: [other.id],
    },
    { conversationId: null, knownIds: new Set([old.id, other.id]) },
  );
  assert.deepEqual(changes.map((c) => c.type), ['added', 'updated', 'deactivated']);
  assert.equal(store.get(old.id).content, 'Der Benutzer wohnt in Hamburg.');
  assert.equal(store.get(other.id).enabled, false);
  assert.equal(store.list().length, 3);
  assert.ok(!store.list().some((m) => /geheim123/.test(m.content)));
  assert.equal(changes[0].memory.source, 'auto');
});
