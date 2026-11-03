'use strict';

/**
 * Whitelist manager for per-contact privacy rules (HAG-59).
 * Manages per-JID rules (always / never / default) for WhatsApp Web Incognito.
 */

const Rule = Object.freeze({
  ALWAYS: 'always',
  NEVER: 'never',
  DEFAULT: 'default',
});

const VALID_RULES = new Set([Rule.ALWAYS, Rule.NEVER, Rule.DEFAULT]);

/**
 * Normalizes WhatsApp JID across device suffixes and domain variants.
 * e.g. "123456789:1@s.whatsapp.net" -> "123456789@c.us"
 *
 * @param {string} [jid]
 * @returns {string}
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

  return `${prefix}@${suffix}`;
}

/**
 * @param {string} rule
 * @returns {boolean}
 */
function isValidRule(rule) {
  return VALID_RULES.has(rule);
}

/**
 * Gets the privacy rule for a given contact JID.
 *
 * @param {Record<string, string>} [whitelist]
 * @param {string} [jid]
 * @returns {'always' | 'never' | 'default'}
 */
function getRule(whitelist, jid) {
  const norm = normalizeJid(jid);
  if (!norm || !whitelist || typeof whitelist !== 'object') return Rule.DEFAULT;
  const val = whitelist[norm];
  return VALID_RULES.has(val) ? val : Rule.DEFAULT;
}

/**
 * Sets a privacy rule for a JID, returning a new immutable copy of the whitelist.
 * If rule is 'default', the entry is deleted to keep stored rules lean.
 *
 * @param {Record<string, string>} whitelist
 * @param {string} jid
 * @param {string} rule
 * @returns {Record<string, string>}
 */
function setRule(whitelist, jid, rule) {
  if (!isValidRule(rule)) {
    throw new Error(`Invalid whitelist rule: "${rule}". Must be one of: always, never, default`);
  }
  const norm = normalizeJid(jid);
  if (!norm) {
    throw new Error('Cannot set whitelist rule: JID cannot be empty');
  }

  const next = { ...(whitelist || {}) };
  if (rule === Rule.DEFAULT) {
    delete next[norm];
  } else {
    next[norm] = rule;
  }
  return next;
}

/**
 * Cycles the rule for quick-toggle UI chip: default -> always -> never -> default
 *
 * @param {string} currentRule
 * @returns {'always' | 'never' | 'default'}
 */
function cycleRule(currentRule) {
  switch (currentRule) {
    case Rule.DEFAULT:
      return Rule.ALWAYS;
    case Rule.ALWAYS:
      return Rule.NEVER;
    case Rule.NEVER:
    default:
      return Rule.DEFAULT;
  }
}

/**
 * Decides whether to suppress / block read receipts for a given contact JID.
 *
 * - 'always': Never suppress (always send read receipts) -> returns false
 * - 'never': Always suppress (never send read receipts) -> returns true
 * - 'default': Fall back to the global readConfirmationsHook setting
 *
 * @param {Record<string, string>} whitelist
 * @param {string} jid
 * @param {boolean} globalReadConfirmationsHookEnabled
 * @returns {boolean} true if receipts should be blocked/suppressed
 */
function shouldBlockReceipt(whitelist, jid, globalReadConfirmationsHookEnabled) {
  const rule = getRule(whitelist, jid);
  if (rule === Rule.ALWAYS) {
    return false; // Whitelisted: always allow receipts through
  }
  if (rule === Rule.NEVER) {
    return true;  // Strict Incognito: always block receipts
  }
  return Boolean(globalReadConfirmationsHookEnabled);
}

/**
 * UI presentation descriptor for the chat header toggle chip.
 *
 * @param {string} rule
 * @returns {{ text: string, icon: string, title: string, className: string }}
 */
function getChipDescriptor(rule) {
  switch (rule) {
    case Rule.ALWAYS:
      return {
        text: 'Always Send',
        icon: '👁️',
        title: 'Incognito Override: Always Send Receipts (Whitelisted for this chat)',
        className: 'incognito-override-chip incognito-chip-always',
      };
    case Rule.NEVER:
      return {
        text: 'Never Send',
        icon: '🛡️',
        title: 'Incognito Override: Never Send Receipts (Strict Incognito for this chat)',
        className: 'incognito-override-chip incognito-chip-never',
      };
    case Rule.DEFAULT:
    default:
      return {
        text: 'Default',
        icon: '🕵️',
        title: 'Incognito Override: Follow Global Incognito Setting',
        className: 'incognito-override-chip incognito-chip-default',
      };
  }
}

/**
 * Creates an in-memory stateful whitelist store with listener support.
 *
 * @param {Record<string, string>} [initial]
 */
function createWhitelistStore(initial = {}) {
  let rules = { ...(initial || {}) };
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) {
      try {
        fn(rules);
      } catch (e) {
        console.error('WhitelistStore listener error:', e);
      }
    }
  }

  return {
    get(jid) {
      return getRule(rules, jid);
    },
    set(jid, rule) {
      rules = setRule(rules, jid, rule);
      notify();
      return rules;
    },
    cycle(jid) {
      const next = cycleRule(getRule(rules, jid));
      rules = setRule(rules, jid, next);
      notify();
      return next;
    },
    getAll() {
      return { ...rules };
    },
    load(newRules) {
      rules = { ...(newRules || {}) };
      notify();
      return rules;
    },
    shouldBlock(jid, globalHook) {
      return shouldBlockReceipt(rules, jid, globalHook);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

module.exports = {
  Rule,
  normalizeJid,
  isValidRule,
  getRule,
  setRule,
  cycleRule,
  shouldBlockReceipt,
  getChipDescriptor,
  createWhitelistStore,
};
