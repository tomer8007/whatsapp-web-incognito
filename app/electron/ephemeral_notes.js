'use strict';

/**
 * Ephemeral local chat notes engine (HAG-85).
 *
 * Notes are stored locally, keyed by a normalized JID, and never sent to
 * WhatsApp. The module also provides a sanitized Markdown exporter that redacts
 * phone numbers and email addresses before a chat transcript leaves the device.
 */

const {
  normalizeJid,
  redactPii,
  sanitizeText,
  sanitizeMarkdown,
  exportSanitizedChat,
} = require('../../shared/ephemeral_utils.js');

function createEphemeralNotesStore(initial) {
  const notes = Object.create(null);

  if (initial && typeof initial === 'object') {
    for (const [key, value] of Object.entries(initial)) {
      const normalized = normalizeJid(key);
      if (normalized) notes[normalized] = String(value === undefined || value === null ? '' : value);
    }
  }

  function setNote(jid, note) {
    const normalized = normalizeJid(jid);
    if (!normalized) {
      throw new Error('Cannot set ephemeral note: JID cannot be empty');
    }
    const value = note === undefined || note === null ? '' : String(note);
    if (value === '') {
      delete notes[normalized];
    } else {
      notes[normalized] = value;
    }
    return notes[normalized] === undefined ? '' : notes[normalized];
  }

  function getNote(jid) {
    const normalized = normalizeJid(jid);
    if (!normalized) return '';
    return Object.prototype.hasOwnProperty.call(notes, normalized) ? notes[normalized] : '';
  }

  function deleteNote(jid) {
    const normalized = normalizeJid(jid);
    if (!normalized) return false;
    if (!Object.prototype.hasOwnProperty.call(notes, normalized)) return false;
    delete notes[normalized];
    return true;
  }

  function listNotes() {
    return Object.keys(notes)
      .sort()
      .map((jid) => ({ jid, note: notes[jid] }));
  }

  function clearAll() {
    const count = Object.keys(notes).length;
    for (const key of Object.keys(notes)) delete notes[key];
    return count;
  }

  function getAll() {
    return { ...notes };
  }

  return {
    setNote,
    getNote,
    deleteNote,
    listNotes,
    clearAll,
    getAll,
    get notes() {
      return { ...notes };
    },
  };
}

function isNotesStore(value) {
  return !!value && typeof value === 'object' && typeof value.setNote === 'function' &&
    typeof value.getNote === 'function' && typeof value.listNotes === 'function';
}

function resolveNotesTarget(args) {
  if (args.length === 0) return { target: defaultStore, jid: undefined, note: undefined };
  if (isNotesStore(args[0]) || (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && args.length >= 2)) {
    // Treat a plain object as a notes map when followed by a JID argument.
    if (isNotesStore(args[0])) {
      return { target: args[0], jid: args[1], note: args[2] };
    }
    if (args.length >= 2 && typeof args[1] === 'string') {
      return { target: args[0], jid: args[1], note: args[2] };
    }
  }
  return { target: defaultStore, jid: args[0], note: args[1] };
}

const defaultStore = createEphemeralNotesStore();

function setNote(...args) {
  const { target, jid, note } = resolveNotesTarget(args);
  if (isNotesStore(target)) {
    return target.setNote(jid, note);
  }
  const normalized = normalizeJid(jid);
  if (!normalized) throw new Error('Cannot set ephemeral note: JID cannot be empty');
  const value = note === undefined || note === null ? '' : String(note);
  if (value === '') delete target[normalized];
  else target[normalized] = value;
  return value;
}

function getNote(...args) {
  const { target, jid } = resolveNotesTarget(args);
  if (isNotesStore(target)) return target.getNote(jid);
  const normalized = normalizeJid(jid);
  if (!normalized) return '';
  return Object.prototype.hasOwnProperty.call(target, normalized) ? target[normalized] : '';
}

function deleteNote(...args) {
  const { target, jid } = resolveNotesTarget(args);
  if (isNotesStore(target)) return target.deleteNote(jid);
  const normalized = normalizeJid(jid);
  if (!normalized || !Object.prototype.hasOwnProperty.call(target, normalized)) return false;
  delete target[normalized];
  return true;
}

function listNotes(...args) {
  const { target } = resolveNotesTarget(args);
  if (isNotesStore(target)) return target.listNotes();
  return Object.keys(target || {})
    .sort()
    .map((jid) => ({ jid, note: target[jid] }));
}

function clearAll(...args) {
  const { target } = resolveNotesTarget(args);
  if (isNotesStore(target)) return target.clearAll();
  const count = Object.keys(target || {}).length;
  for (const key of Object.keys(target || {})) delete target[key];
  return count;
}

const createEphemeralNotes = createEphemeralNotesStore;
const createEphemeralNotesEngine = createEphemeralNotesStore;
const createNotesStore = createEphemeralNotesStore;
const sanitize = redactPii;
const maskPii = redactPii;
const sanitizePii = redactPii;

module.exports = {
  normalizeJid,
  redactPii,
  sanitizeText,
  sanitizeMarkdown,
  createEphemeralNotesStore,
  createEphemeralNotes,
  createEphemeralNotesEngine,
  createNotesStore,
  sanitize,
  maskPii,
  sanitizePii,
  exportSanitizedChat,
  setNote,
  getNote,
  deleteNote,
  listNotes,
  clearAll,
  defaultStore,
};
