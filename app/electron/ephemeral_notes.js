'use strict';

/**
 * Ephemeral local chat notes engine (HAG-85).
 *
 * Notes are stored locally, keyed by a normalized JID, and never sent to
 * WhatsApp. The module also provides a sanitized Markdown exporter that redacts
 * phone numbers and email addresses before a chat transcript leaves the device.
 */

function normalizeJid(jid) {
  if (!jid || typeof jid !== 'string') return '';
  const trimmed = jid.trim();
  const atIndex = trimmed.indexOf('@');
  let prefix = atIndex !== -1 ? trimmed.substring(0, atIndex) : trimmed;
  let suffix = atIndex !== -1 ? trimmed.substring(atIndex + 1).toLowerCase() : 'c.us';

  if (suffix === 's.whatsapp.net') suffix = 'c.us';

  const colonIndex = prefix.indexOf(':');
  if (colonIndex !== -1) {
    prefix = prefix.substring(0, colonIndex);
  }

  return prefix ? `${prefix}@${suffix}` : '';
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?:\+?\d{1,4}[\s.-]?)?\(?\d{1,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b|\b\d{7,15}\b/g;

function redactPii(text) {
  if (text === null || text === undefined) return '';
  let value = String(text);
  value = value.replace(EMAIL_RE, '[REDACTED EMAIL]');
  value = value.replace(PHONE_RE, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 7) return match;
    return '[REDACTED PHONE]';
  });
  return value;
}

const sanitizeText = redactPii;
const sanitizeMarkdown = redactPii;

function normalizeNotesInput(notes, jid) {
  if (notes === null || notes === undefined) return '';
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) {
    return notes.map((item) => normalizeNotesInput(item, jid)).filter(Boolean).join('\n');
  }
  if (typeof notes === 'object') {
    if (typeof notes.getNote === 'function' && jid) {
      try { return String(notes.getNote(jid) || ''); } catch (e) { /* fall through */ }
    }
    if (jid && Object.prototype.hasOwnProperty.call(notes, jid)) {
      return String(notes[jid] || '');
    }
    const normalized = normalizeJid(jid);
    if (normalized && Object.prototype.hasOwnProperty.call(notes, normalized)) {
      return String(notes[normalized] || '');
    }
    return Object.values(notes).map((value) => String(value || '')).join('\n');
  }
  return String(notes);
}

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
  if (args.length === 0) return { target: defaultStore, jid: undefined, note: undefined, hasTarget: false };
  if (isNotesStore(args[0]) || (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && args.length >= 2)) {
    // Treat a plain object as a notes map when followed by a JID argument.
    if (isNotesStore(args[0])) {
      return { target: args[0], jid: args[1], note: args[2], hasTarget: true };
    }
    if (args.length >= 2 && typeof args[1] === 'string') {
      return { target: args[0], jid: args[1], note: args[2], hasTarget: true };
    }
  }
  return { target: defaultStore, jid: args[0], note: args[1], hasTarget: false };
}

const defaultStore = createEphemeralNotesStore();

function setNote(...args) {
  const { target, jid, note, hasTarget } = resolveNotesTarget(args);
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
  const { target, jid, hasTarget } = resolveNotesTarget(args);
  if (isNotesStore(target)) return target.getNote(jid);
  const normalized = normalizeJid(jid);
  if (!normalized) return '';
  return Object.prototype.hasOwnProperty.call(target, normalized) ? target[normalized] : '';
}

function deleteNote(...args) {
  const { target, jid, hasTarget } = resolveNotesTarget(args);
  if (isNotesStore(target)) return target.deleteNote(jid);
  const normalized = normalizeJid(jid);
  if (!normalized || !Object.prototype.hasOwnProperty.call(target, normalized)) return false;
  delete target[normalized];
  return true;
}

function listNotes(...args) {
  const { target, hasTarget } = resolveNotesTarget(args);
  if (isNotesStore(target)) return target.listNotes();
  return Object.keys(target || {})
    .sort()
    .map((jid) => ({ jid, note: target[jid] }));
}

function clearAll(...args) {
  const { target, hasTarget } = resolveNotesTarget(args);
  if (isNotesStore(target)) return target.clearAll();
  const count = Object.keys(target || {}).length;
  for (const key of Object.keys(target || {})) delete target[key];
  return count;
}

function exportSanitizedChat(input) {
  const data = input && typeof input === 'object' ? input : {};
  const contactJid = normalizeJid(data.contactJid || data.jid || data.contact_jid || '');
  const contactName = redactPii(data.contactName || data.name || data.contact_name || contactJid || 'Unknown Contact');
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const notesText = normalizeNotesInput(data.notes, contactJid);

  const lines = [];
  lines.push(`# Chat Export: ${contactName}`);
  lines.push('');
  lines.push(`Contact: ${contactName} (${contactJid})`);
  lines.push('');

  lines.push('## Private Notes');
  lines.push('');
  lines.push(notesText.trim() ? redactPii(notesText) : '_No private notes._');
  lines.push('');

  lines.push('## Messages');
  lines.push('');
  if (messages.length === 0) {
    lines.push('_No messages._');
  } else {
    for (const message of messages) {
      const msg = message && typeof message === 'object' ? message : {};
      const sender = redactPii(msg.sender || msg.from || msg.author || 'Unknown');
      const timestamp = msg.timestamp || msg.time || msg.date;
      const timeSuffix = timestamp ? ` (${redactPii(String(timestamp))})` : '';
      const text = redactPii(msg.text || msg.body || msg.message || msg.content || '');
      lines.push(`- **${sender}**${timeSuffix}: ${text}`);
    }
  }
  lines.push('');

  return lines.join('\n');
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
