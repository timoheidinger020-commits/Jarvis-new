import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitByBudget, toModelMessages } from '../server/chat/context.js';

const msg = (id, role, content) => ({ id, role, content, created_at: '2026-10-31T19:30:00.000Z' });

test('Benutzernachrichten bekommen einen Zeitstempel, gleiche Rollen werden zusammengeführt', () => {
  const out = toModelMessages([msg(1, 'assistant', 'alt'), msg(2, 'user', 'a'), msg(3, 'user', 'b'), msg(4, 'assistant', 'c')]);
  assert.equal(out.length, 2);
  assert.equal(out[0].role, 'user');
  assert.match(out[0].content, /^\[Sa\.?, 31\.10\.2026, 20:30\] a\n\n\[.*\] b$/);
  assert.equal(out[1].content, 'c');
});

test('Budget: neueste Nachrichten bleiben, ältere wandern in den Überlauf', () => {
  const rows = [];
  for (let i = 1; i <= 10; i++) rows.push(msg(i, i % 2 ? 'user' : 'assistant', 'x'.repeat(100)));
  const { overflow, recent } = splitByBudget(rows, 450);
  assert.ok(recent.length >= 2 && recent.length <= 4);
  assert.equal(recent[0].role, 'user');
  assert.equal(overflow.length + recent.length, 10);
  assert.equal(recent.at(-1).id, 10);
});

test('Budget: die letzte Nachricht wird immer mitgeschickt, auch wenn sie sehr lang ist', () => {
  const { recent } = splitByBudget([msg(1, 'user', 'kurz'), msg(2, 'assistant', 'ok'), msg(3, 'user', 'y'.repeat(5000))], 100);
  assert.deepEqual(recent.map((r) => r.id), [3]);
});
