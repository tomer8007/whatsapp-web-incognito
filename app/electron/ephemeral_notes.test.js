'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeJid,
  redactPii,
  createEphemeralNotesStore,
  exportSanitizedChat,
  setNote,
  getNote,
  deleteNote,
  listNotes,
  clearAll,
} = require('./ephemeral_notes');

test('normalizeJid normalizes whatsapp JIDs', () => {
  assert.equal(normalizeJid('15551234567@s.whatsapp.net'), '15551234567@c.us');
  assert.equal(normalizeJid('15551234567:2@c.us'), '15551234567@c.us');
  assert.equal(normalizeJid('  12345@c.us  '), '12345@c.us');
  assert.equal(normalizeJid(''), '');
  assert.equal(normalizeJid(null), '');
});

test('store set/get/delete/list/clear work with JID normalization', () => {
  const store = createEphemeralNotesStore();
  const note = store.setNote('15551234567:1@s.whatsapp.net', 'Private note');
  assert.equal(note, 'Private note');
  assert.equal(store.getNote('15551234567@c.us'), 'Private note');
  assert.equal(store.getNote('missing@c.us'), '');

  const listed = store.listNotes();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].jid, '15551234567@c.us');
  assert.equal(listed[0].note, 'Private note');

  assert.equal(store.deleteNote('15551234567@s.whatsapp.net'), true);
  assert.equal(store.getNote('15551234567@c.us'), '');
  assert.equal(store.deleteNote('15551234567@c.us'), false);

  store.setNote('a@c.us', 'one');
  store.setNote('b@c.us', 'two');
  assert.equal(store.clearAll(), 2);
  assert.equal(store.listNotes().length, 0);
});

test('empty note deletes the entry', () => {
  const store = createEphemeralNotesStore();
  store.setNote('a@c.us', 'note');
  assert.equal(store.setNote('a@c.us', ''), '');
  assert.equal(store.getNote('a@c.us'), '');
  assert.equal(store.listNotes().length, 0);
});

test('store initializes from provided notes', () => {
  const store = createEphemeralNotesStore({ '15551234567:1@s.whatsapp.net': 'init' });
  assert.equal(store.getNote('15551234567@c.us'), 'init');
});

test('module-level helpers support store and plain note maps', () => {
  const store = createEphemeralNotesStore();
  assert.equal(setNote(store, 'a@c.us', 'hello'), 'hello');
  assert.equal(getNote(store, 'a@c.us'), 'hello');
  assert.deepEqual(listNotes(store), [{ jid: 'a@c.us', note: 'hello' }]);
  assert.equal(deleteNote(store, 'a@c.us'), true);
  assert.equal(clearAll(store), 0);

  const plain = {};
  setNote(plain, 'b@c.us', 'plain note');
  assert.equal(getNote(plain, 'b@c.us'), 'plain note');
  assert.equal(deleteNote(plain, 'b@c.us'), true);
});

test('redactPii masks emails and phone numbers', () => {
  const text = 'Email me at test@example.com or call +1 (555) 123-4567 / 555-987-6543.';
  const redacted = redactPii(text);
  assert.doesNotMatch(redacted, /test@example\.com/);
  assert.doesNotMatch(redacted, /555\) 123-4567/);
  assert.match(redacted, /\[REDACTED EMAIL\]/);
  assert.match(redacted, /\[REDACTED PHONE\]/);
});

test('exportSanitizedChat produces sanitized markdown', () => {
  const markdown = exportSanitizedChat({
    contactJid: '15551234567:1@s.whatsapp.net',
    contactName: 'Alice (test@example.com)',
    messages: [
      { sender: 'Alice', timestamp: '2026-01-01', text: 'Hi, call 555-123-4567' },
      { sender: 'Bob', text: 'Email bob@example.com please' },
    ],
    notes: 'Secret note with 555-000-1111',
  });

  assert.match(markdown, /^# Chat Export:/);
  assert.match(markdown, /## Private Notes/);
  assert.match(markdown, /## Messages/);
  assert.doesNotMatch(markdown, /test@example\.com/);
  assert.doesNotMatch(markdown, /bob@example\.com/);
  assert.doesNotMatch(markdown, /555-123-4567/);
  assert.doesNotMatch(markdown, /555-000-1111/);
  assert.match(markdown, /\[REDACTED EMAIL\]/);
  assert.match(markdown, /\[REDACTED PHONE\]/);
});

test('exportSanitizedChat handles notes store and missing messages', () => {
  const store = createEphemeralNotesStore();
  store.setNote('a@c.us', 'stored note');
  const markdown = exportSanitizedChat({
    contactJid: 'a@c.us',
    contactName: 'A',
    messages: [],
    notes: store,
  });
  assert.match(markdown, /stored note/);
  assert.match(markdown, /_No messages\._/);
});
