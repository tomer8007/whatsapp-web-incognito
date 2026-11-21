'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const WAISettingsSchema = require('../../shared/settings_schema.js');
const WAIJidUtils = require('../../shared/jid_utils.js');
const WAIEphemeralUtils = require('../../shared/ephemeral_utils.js');

test('defaults, allKeys, and specsFor stay consistent across scopes', () => {
  const sharedKeys = WAISettingsSchema.allKeys('shared');
  const shellKeys = WAISettingsSchema.allKeys('shell');
  const allKeys = WAISettingsSchema.allKeys('all');

  assert.strictEqual(sharedKeys.length, 14);
  assert.strictEqual(shellKeys.length, 1);
  assert.strictEqual(shellKeys[0], 'autostart');
  assert.strictEqual(allKeys.length, 15);

  const sharedDefaults = WAISettingsSchema.defaults('shared');
  const allDefaults = WAISettingsSchema.defaults('all');
  assert.deepStrictEqual(Object.keys(sharedDefaults), sharedKeys);
  assert.deepStrictEqual(Object.keys(allDefaults), allKeys);
  assert.strictEqual(allDefaults.autostart, false);

  const sharedSpecs = WAISettingsSchema.specsFor('shared');
  assert.strictEqual(sharedSpecs.length, 14);
  assert.ok(sharedSpecs.every((s) => s.scope === 'shared'));

  const groupIds = new Set(WAISettingsSchema.GROUPS.map((g) => g.id));
  for (const spec of WAISettingsSchema.SETTINGS) {
    assert.ok(groupIds.has(spec.group), `${spec.key} uses unknown group "${spec.group}"`);
  }
});

test('numericRanges and choiceLabel match integer specs', () => {
  const ranges = WAISettingsSchema.numericRanges('shared');
  assert.deepStrictEqual(ranges, {
    privacyScreenLockIdleMinutes: { min: 1, max: 60 },
    safetyDelay: { min: 0, max: 30 },
  });

  const sdSpec = WAISettingsSchema.getSpec('safetyDelay');
  const idleSpec = WAISettingsSchema.getSpec('privacyScreenLockIdleMinutes');
  assert.strictEqual(WAISettingsSchema.choiceLabel(0, sdSpec), 'Off');
  assert.strictEqual(WAISettingsSchema.choiceLabel(1, sdSpec), '1 second');
  assert.strictEqual(WAISettingsSchema.choiceLabel(7, sdSpec), '7 seconds');
  assert.strictEqual(WAISettingsSchema.choiceLabel(1, idleSpec), '1 minute');
  assert.strictEqual(WAISettingsSchema.choiceLabel(15, idleSpec), '15 minutes');
});

test('coerceSetting handles booleans, integer ranges, and SHA-256 PIN hashes', () => {
  assert.strictEqual(WAISettingsSchema.coerceSetting('readConfirmationsHook', false), false);
  assert.strictEqual(WAISettingsSchema.coerceSetting('readConfirmationsHook', 'true'), true);
  assert.strictEqual(WAISettingsSchema.coerceSetting('readConfirmationsHook', 'false'), false);
  assert.strictEqual(WAISettingsSchema.coerceSetting('readConfirmationsHook', 'yes'), undefined);

  assert.strictEqual(WAISettingsSchema.coerceSetting('safetyDelay', 7, 0), 7);
  assert.strictEqual(WAISettingsSchema.coerceSetting('safetyDelay', '15', 0), 15);
  assert.strictEqual(WAISettingsSchema.coerceSetting('safetyDelay', 99, 5), 5);
  assert.strictEqual(WAISettingsSchema.coerceSetting('safetyDelay', -1, 5), 5);
  assert.strictEqual(WAISettingsSchema.coerceSetting('safetyDelay', 'abc', 5), undefined);

  assert.strictEqual(WAISettingsSchema.coerceSetting('privacyScreenLockIdleMinutes', 7, 5), 7);
  assert.strictEqual(WAISettingsSchema.coerceSetting('privacyScreenLockIdleMinutes', 0, 5), 5);
  assert.strictEqual(WAISettingsSchema.coerceSetting('privacyScreenLockIdleMinutes', 61, 5), 5);

  const hashUpper = crypto.createHash('sha256').update('1234').digest('hex').toUpperCase();
  assert.strictEqual(WAISettingsSchema.coerceSetting('privacyScreenLockPIN', hashUpper, ''), hashUpper.toLowerCase());
  assert.strictEqual(WAISettingsSchema.coerceSetting('privacyScreenLockPIN', '', hashUpper.toLowerCase()), '');
  assert.strictEqual(WAISettingsSchema.coerceSetting('privacyScreenLockPIN', '1234', ''), undefined);
});

test('validatePatch enforces scope, coerces valid keys, and rejects unknown keys', () => {
  const res = WAISettingsSchema.validatePatch(
    {
      readConfirmationsHook: false,
      safetyDelay: '7',
      autostart: true, // shell-only; must be rejected in shared scope
      unknownKey: 'abc',
      privacyScreenLockPIN: 'not-a-hash',
    },
    undefined,
    'shared'
  );

  assert.strictEqual(res.prefs.readConfirmationsHook, false);
  assert.strictEqual(res.prefs.safetyDelay, 7);
  assert.deepStrictEqual(res.applied.sort(), ['readConfirmationsHook', 'safetyDelay']);
  assert.deepStrictEqual(res.rejected.sort(), ['autostart', 'privacyScreenLockPIN', 'unknownKey']);

  const shellRes = WAISettingsSchema.validatePatch({ autostart: true }, undefined, 'all');
  assert.strictEqual(shellRes.prefs.autostart, true);
  assert.deepStrictEqual(shellRes.applied, ['autostart']);
});

test('WAIJidUtils normalizes domains, strips device suffixes, and handles missing domains', () => {
  assert.strictEqual(WAIJidUtils.normalizeJid('15551234567:4@s.whatsapp.net'), '15551234567@c.us');
  assert.strictEqual(WAIJidUtils.normalizeJid('15551234567'), '15551234567@c.us');
  assert.strictEqual(WAIJidUtils.normalizeJid('99887766:1@LID'), '99887766@lid');
  assert.strictEqual(WAIJidUtils.normalizeJid('12036300112233@g.us'), '12036300112233@g.us');
  assert.strictEqual(WAIJidUtils.normalizeJid(''), '');
  assert.strictEqual(WAIJidUtils.normalizeJid(null), '');
  assert.strictEqual(WAIJidUtils.prefixOfJid('15551234567:4@s.whatsapp.net'), '15551234567');
  assert.strictEqual(WAIJidUtils.fromChat({ accountLid: '554433:0@lid', id: '1555000@c.us' }), '554433@lid');
});

test('WAIEphemeralUtils redacts phone numbers and email addresses in Markdown export', () => {
  const md = WAIEphemeralUtils.exportSanitizedChat({
    contactJid: '15551234567@s.whatsapp.net',
    contactName: 'Alice +1 555-234-5678',
    notes: { '15551234567@c.us': 'Reach out at alice@example.com or 555-867-5309' },
    messages: [
      { sender: 'Alice', timestamp: '10:00', text: 'Email me at bob@corp.org or +44 20 7946 0958' },
    ],
  });

  assert.doesNotMatch(md, /555-234-5678/);
  assert.doesNotMatch(md, /alice@example\.com/);
  assert.doesNotMatch(md, /bob@corp\.org/);
  assert.doesNotMatch(md, /7946 0958/);
  assert.match(md, /\[REDACTED EMAIL\]/);
  assert.match(md, /\[REDACTED PHONE\]/);
  assert.match(md, /## Private Notes/);
  assert.match(md, /## Messages/);
});
