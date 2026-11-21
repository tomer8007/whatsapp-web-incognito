;(function (root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof exports === 'object' && typeof module === 'object') { module.exports = factory(require('./jid_utils.js')); }
  else { root.WAIEphemeralUtils = factory(root.WAIJidUtils); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (JID) {
  'use strict';

  function normalizeJid(jid) {
    if (JID && typeof JID.normalizeJid === 'function') {
      return JID.normalizeJid(jid);
    }
    // JID is always injected: WAIJidUtils in the page world, the required module in the
    // Electron main process. No fallback copy of the normalization lives here.
    return (typeof jid === 'string' && jid) ? jid : '';
  }

  var EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  var PHONE_RE = /(?:\+?\d{1,4}[\s.-]?)?\(?\d{1,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b|\b\d{7,15}\b/g;

  function redactPii(text) {
    if (text === null || text === undefined) return '';
    var value = String(text);
    value = value.replace(EMAIL_RE, '[REDACTED EMAIL]');
    value = value.replace(PHONE_RE, function (match) {
      var digits = match.replace(/\D/g, '');
      if (digits.length < 7) return match;
      return '[REDACTED PHONE]';
    });
    return value;
  }

  var sanitizeText = redactPii;
  var sanitizeMarkdown = redactPii;

  function normalizeNotesInput(notes, jid) {
    if (notes === null || notes === undefined) return '';
    if (typeof notes === 'string') return notes;
    if (Array.isArray(notes)) {
      return notes.map(function (item) { return normalizeNotesInput(item, jid); })
        .filter(Boolean).join('\n');
    }
    if (typeof notes === 'object') {
      if (typeof notes.getNote === 'function' && jid) {
        try { return String(notes.getNote(jid) || ''); } catch (e) { /* fall through */ }
      }
      if (jid && Object.prototype.hasOwnProperty.call(notes, jid)) {
        return String(notes[jid] || '');
      }
      var normalized = normalizeJid(jid);
      if (normalized && Object.prototype.hasOwnProperty.call(notes, normalized)) {
        return String(notes[normalized] || '');
      }
      return Object.keys(notes).map(function (k) { return String(notes[k] || ''); }).join('\n');
    }
    return String(notes);
  }

  function exportSanitizedChat(input) {
    var data = input && typeof input === 'object' ? input : {};
    var contactJid = normalizeJid(data.contactJid || data.jid || data.contact_jid || '');
    var contactName = redactPii(data.contactName || data.name || data.contact_name || contactJid || 'Unknown Contact');
    var messages = Array.isArray(data.messages) ? data.messages : [];
    var notesText = normalizeNotesInput(data.notes, contactJid);

    var lines = [];
    lines.push('# Chat Export: ' + contactName);
    lines.push('');
    lines.push('Contact: ' + contactName + ' (' + contactJid + ')');
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
      for (var i = 0; i < messages.length; i++) {
        var message = messages[i];
        var msg = message && typeof message === 'object' ? message : {};
        var sender = redactPii(msg.sender || msg.from || msg.author || 'Unknown');
        var timestamp = msg.timestamp || msg.time || msg.date;
        var timeSuffix = timestamp ? (' (' + redactPii(String(timestamp)) + ')') : '';
        var text = redactPii(msg.text || msg.body || msg.message || msg.content || '');
        lines.push('- **' + sender + '**' + timeSuffix + ': ' + text);
      }
    }
    lines.push('');

    return lines.join('\n');
  }

  return {
    normalizeJid: normalizeJid,
    redactPii: redactPii,
    sanitizeText: sanitizeText,
    sanitizeMarkdown: sanitizeMarkdown,
    normalizeNotesInput: normalizeNotesInput,
    exportSanitizedChat: exportSanitizedChat,
  };
});
