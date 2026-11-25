'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  Rule,
  normalizeJid,
  isValidRule,
  getRule,
  setRule,
  cycleRule,
  shouldBlockReceipt,
  getChipDescriptor,
  createWhitelistStore,
} = require('./whitelist_manager');

// =============================================================================
// JID Normalization & Lookup Tests
// =============================================================================

test('normalizeJid handles empty or non-string inputs', () => {
  assert.equal(normalizeJid(''), '');
  assert.equal(normalizeJid(null), '');
  assert.equal(normalizeJid(undefined), '');
});

test('normalizeJid standardizes s.whatsapp.net to c.us', () => {
  assert.equal(normalizeJid('15551234567@s.whatsapp.net'), '15551234567@c.us');
  assert.equal(normalizeJid('15551234567@S.WHATSAPP.NET'), '15551234567@c.us');
  assert.equal(normalizeJid('15551234567@c.us'), '15551234567@c.us');
});

test('normalizeJid strips device colon index', () => {
  assert.equal(normalizeJid('15551234567:2@s.whatsapp.net'), '15551234567@c.us');
  assert.equal(normalizeJid('15551234567:99@c.us'), '15551234567@c.us');
});

test('normalizeJid trims extraneous whitespace', () => {
  assert.equal(normalizeJid('  12345@c.us  '), '12345@c.us');
});

// =============================================================================
// Rule Validation and Cycling
// =============================================================================

test('isValidRule validates acceptable rule types', () => {
  assert.ok(isValidRule('always'));
  assert.ok(isValidRule('never'));
  assert.ok(isValidRule('default'));
  assert.ok(!isValidRule('unknown'));
  assert.ok(!isValidRule(''));
});

test('cycleRule transitions through default -> always -> never -> default', () => {
  assert.equal(cycleRule(Rule.DEFAULT), Rule.ALWAYS);
  assert.equal(cycleRule(Rule.ALWAYS), Rule.NEVER);
  assert.equal(cycleRule(Rule.NEVER), Rule.DEFAULT);
  assert.equal(cycleRule('invalid'), Rule.DEFAULT);
});

// =============================================================================
// Whitelist Evaluation & Lookup
// =============================================================================

test('getRule returns default for unlisted or normalized JID', () => {
  const whitelist = {
    '15551234567@c.us': Rule.ALWAYS,
    '15559876543@c.us': Rule.NEVER,
  };

  assert.equal(getRule(whitelist, '15551234567@c.us'), Rule.ALWAYS);
  // Matches via normalization
  assert.equal(getRule(whitelist, '15551234567:1@s.whatsapp.net'), Rule.ALWAYS);
  assert.equal(getRule(whitelist, '15559876543@c.us'), Rule.NEVER);
  assert.equal(getRule(whitelist, '10000000000@c.us'), Rule.DEFAULT);
  assert.equal(getRule(null, '15551234567@c.us'), Rule.DEFAULT);
});

test('setRule sets, updates, and deletes default rules', () => {
  let list = {};
  list = setRule(list, '111@s.whatsapp.net', Rule.ALWAYS);
  assert.deepEqual(list, { '111@c.us': 'always' });

  list = setRule(list, '222@c.us', Rule.NEVER);
  assert.deepEqual(list, { '111@c.us': 'always', '222@c.us': 'never' });

  // Update rule
  list = setRule(list, '111@c.us', Rule.NEVER);
  assert.equal(list['111@c.us'], 'never');

  // Setting to default removes the key to keep storage compact
  list = setRule(list, '111@c.us', Rule.DEFAULT);
  assert.ok(!('111@c.us' in list));
  assert.equal(Object.keys(list).length, 1);
});

test('setRule rejects invalid rule or empty JID', () => {
  assert.throws(() => setRule({}, '123@c.us', 'garbage'), /Invalid whitelist rule/);
  assert.throws(() => setRule({}, '', Rule.ALWAYS), /JID cannot be empty/);
});

// =============================================================================
// Interception Evaluation: shouldBlockReceipt
// =============================================================================

test('shouldBlockReceipt: always rule never suppresses receipts', () => {
  const list = { '123@c.us': Rule.ALWAYS };
  // Even if global incognito is ON (blocking receipts), whitelist allows it
  assert.equal(shouldBlockReceipt(list, '123@c.us', true), false);
  assert.equal(shouldBlockReceipt(list, '123@c.us', false), false);
});

test('shouldBlockReceipt: never rule always suppresses receipts', () => {
  const list = { '456@c.us': Rule.NEVER };
  // Even if global incognito is OFF (not blocking), contact rule blocks it
  assert.equal(shouldBlockReceipt(list, '456@c.us', false), true);
  assert.equal(shouldBlockReceipt(list, '456@c.us', true), true);
});

test('shouldBlockReceipt: default rule respects global hook setting', () => {
  const list = { '789@c.us': Rule.DEFAULT };
  assert.equal(shouldBlockReceipt(list, '789@c.us', true), true);
  assert.equal(shouldBlockReceipt(list, '789@c.us', false), false);

  // Unlisted contacts also follow global setting
  assert.equal(shouldBlockReceipt(list, 'unlisted@c.us', true), true);
  assert.equal(shouldBlockReceipt(list, 'unlisted@c.us', false), false);
});

// =============================================================================
// UI Chip Descriptors
// =============================================================================

test('getChipDescriptor provides distinct states for UI toggle chip', () => {
  const always = getChipDescriptor(Rule.ALWAYS);
  assert.match(always.text, /Always Send/);
  assert.match(always.className, /incognito-chip-always/);

  const never = getChipDescriptor(Rule.NEVER);
  assert.match(never.text, /Never Send/);
  assert.match(never.className, /incognito-chip-never/);

  const def = getChipDescriptor(Rule.DEFAULT);
  assert.match(def.text, /Default/);
  assert.match(def.className, /incognito-chip-default/);
});

// =============================================================================
// Whitelist Store & Storage Sync
// =============================================================================

test('createWhitelistStore handles state updates, cycle, and subscribers', () => {
  let notifications = 0;
  const store = createWhitelistStore({ '100@c.us': 'always' });
  const unsubscribe = store.subscribe(() => {
    notifications++;
  });

  assert.equal(store.get('100@c.us'), 'always');
  assert.equal(store.shouldBlock('100@c.us', true), false);

  // Cycle 100@c.us from always -> never
  const next = store.cycle('100@c.us');
  assert.equal(next, 'never');
  assert.equal(store.get('100@c.us'), 'never');
  assert.equal(store.shouldBlock('100@c.us', false), true);
  assert.equal(notifications, 1);

  // Load new state (e.g. from chrome.storage sync)
  store.load({ '200@c.us': 'never' });
  assert.equal(store.get('100@c.us'), 'default');
  assert.equal(store.get('200@c.us'), 'never');
  assert.equal(notifications, 2);

  unsubscribe();
  store.set('300@c.us', 'always');
  assert.equal(notifications, 2, 'Unsubscribed listener must not be called');
});
