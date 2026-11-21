;(function (root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof exports === 'object' && typeof module === 'object') { module.exports = factory(); }
  else { root.WAIJidUtils = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeJid(jid) {
    if (!jid || typeof jid !== 'string') return '';
    var trimmed = jid.trim();
    if (!trimmed) return '';
    var atIndex = trimmed.indexOf('@');
    var prefix = atIndex !== -1 ? trimmed.substring(0, atIndex) : trimmed;
    var suffix = atIndex !== -1 ? trimmed.substring(atIndex + 1).toLowerCase() : 'c.us';

    if (suffix === 's.whatsapp.net') suffix = 'c.us';

    var colonIndex = prefix.indexOf(':');
    if (colonIndex !== -1) {
      prefix = prefix.substring(0, colonIndex);
    }

    return prefix ? (prefix + '@' + suffix) : '';
  }

  function prefixOfJid(jid) {
    if (!jid || typeof jid !== 'string') return '';
    var trimmed = jid.trim();
    if (!trimmed) return '';
    var atIndex = trimmed.indexOf('@');
    var prefix = atIndex !== -1 ? trimmed.substring(0, atIndex) : trimmed;
    var colonIndex = prefix.indexOf(':');
    return colonIndex !== -1 ? prefix.substring(0, colonIndex) : prefix;
  }

  function fromChat(chat) {
    if (!chat || typeof chat !== 'object') return '';
    var raw = '';
    if (chat.accountLid) {
      raw = typeof chat.accountLid === 'string'
        ? chat.accountLid
        : (chat.accountLid._serialized || String(chat.accountLid));
    } else if (chat.id) {
      raw = typeof chat.id === 'string'
        ? chat.id
        : (chat.id._serialized || (typeof chat.id.toString === 'function' ? chat.id.toString() : ''));
    }
    return normalizeJid(raw);
  }

  return {
    normalizeJid: normalizeJid,
    prefixOfJid: prefixOfJid,
    fromChat: fromChat,
  };
});
