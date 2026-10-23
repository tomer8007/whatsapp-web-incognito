'use strict';
// Unit tests for the settings table and the menu it renders. Run: node --test app/electron/
//
// settings-menu.js touches no Electron API — it takes `Menu` as a parameter and returns a
// plain template array — so the real menu is asserted here under bare `node --test` with no
// Electron at all. That is the point: the menu is the only place a user can change the
// setting that decides whether their read receipts are blocked, and "the click handler was
// attached" is not something a smoke test can see.
//
// What is deliberately NOT tested here: that Electron renders a checkbox correctly, that the
// popup positions itself, or that PrefsStore persists a value. Those belong to Electron and
// to prefs-store.test.js. Duplicating them here would only re-assert the same contract at a
// weaker boundary.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { SETTINGS, settingsFor, quickToggles, numericRanges, buildSettingsTemplate, choiceLabel } =
  require('./settings-menu.js');
const meta = require('../.build/meta.json');

// ---------------------------------------------------------------- fixtures

/**
 * The real persisted shape: the nine interception keys derived from background.js at build
 * time, plus the shell-only autostart from main.js's SHELL_DEFAULTS. Mirrors the object
 * PrefsStore hands the shell, which is the only thing these functions are ever given.
 */
function realPrefs(overrides) {
  return { ...meta.prefs, autostart: false, ...(overrides || {}) };
}

const HEADER = ['Status: Protected', '1 in / 1 out · last frame 1s ago'];

/** Flatten a template into `label` → row, for asserting on one specific setting. */
function rows(items) {
  const out = {};
  for (const item of items) if (item.label) out[item.label] = item;
  return out;
}

// ---------------------------------------------------------------- the table

test('every persisted key has a row, so no setting is unreachable', () => {
  // The coverage assertion this file exists for. A key added to background.js (or to
  // SHELL_DEFAULTS) with no descriptor would be persisted perfectly and changeable from
  // nowhere — which is how the four message settings ended up reachable only from a panel
  // injected into WhatsApp's DOM, and how safetyDelay ended up implemented but unreachable.
  const known = new Set([...Object.keys(meta.prefs), 'autostart']);
  const described = new Set(SETTINGS.map((s) => s.key));
  const missing = [...known].filter((k) => !described.has(k));
  assert.deepStrictEqual(missing, [], `settings with no row: ${missing.join(', ')}`);

  // And no row for a key nothing persists: an unknown key is rejected by PrefsStore, so its
  // checkbox would flip and revert.
  const extra = [...described].filter((k) => !known.has(k));
  assert.deepStrictEqual(extra, [], `rows for unknown keys: ${extra.join(', ')}`);
});

test('the table states no defaults, so background.js stays the only source', () => {
  // A `default:` here would be a second source of truth nothing keeps in sync, which is
  // exactly the failure docs/ARCHITECTURE.md §1 rules out for the app and the extension
  // disagreeing about what a default is. Cheap to check, expensive to discover later.
  for (const spec of SETTINGS) {
    assert.ok(!('default' in spec), `${spec.key} restates a default`);
    assert.ok(typeof spec.label === 'string' && spec.label.length > 0, `${spec.key} has no label`);
    assert.ok(typeof spec.group === 'string' && spec.group.length > 0, `${spec.key} has no group`);
  }
});

test('every group referenced by a spec is a declared group', () => {
  const declared = new Set(['privacy', 'messages', 'timing', 'app']);
  for (const spec of SETTINGS) {
    assert.ok(declared.has(spec.group), `${spec.key} is in undeclared group "${spec.group}"`);
  }
});

test('the three quick toggles are the three privacy hooks, in leak-first order', () => {
  // These are the rows the tray shows without opening anything, so the order is the order a
  // user cares about: the one that leaks identity first.
  assert.deepStrictEqual(quickToggles().map((s) => s.key), [
    'readConfirmationsHook', 'onlineUpdatesHook', 'typingUpdatesHook',
  ]);
});

test('settingsFor hides a key the store does not know, rather than showing a dead row', () => {
  // Hiding is the safe direction: a checkbox that flips and reverts is worse than an absent
  // one. settingsFor is the only filter, so the coverage test above is what keeps it honest.
  const keys = settingsFor({ readConfirmationsHook: true }).map((s) => s.key);
  assert.deepStrictEqual(keys, ['readConfirmationsHook']);
  assert.deepStrictEqual(settingsFor(null), []);
  assert.deepStrictEqual(settingsFor('nonsense'), []);
});

test('numericRanges derives the validation bound from the values the menu offers', () => {
  // One declaration: if the radio submenu ever offers 60, the store starts accepting 60.
  assert.deepStrictEqual(numericRanges(), { safetyDelay: { min: 0, max: 30 } });
});

// ---------------------------------------------------------------- rendering

test('a boolean setting renders as a checkbox reflecting the stored value', () => {
  const on = buildSettingsTemplate({ prefs: realPrefs({ readConfirmationsHook: true }) });
  const off = buildSettingsTemplate({ prefs: realPrefs({ readConfirmationsHook: false }) });
  assert.strictEqual(rows(on)['Block read receipts'].type, 'checkbox');
  assert.strictEqual(rows(on)['Block read receipts'].checked, true);
  assert.strictEqual(rows(off)['Block read receipts'].checked, false);
});

test('the safety delay renders as a radio submenu whose checked row is the stored value', () => {
  const items = buildSettingsTemplate({ prefs: realPrefs({ safetyDelay: 15 }) });
  const row = rows(items)['Safety delay'];
  assert.deepStrictEqual(row.submenu.map((c) => c.label),
    ['Off', '5 seconds', '10 seconds', '15 seconds', '20 seconds', '30 seconds']);
  const checked = row.submenu.filter((c) => c.checked);
  assert.deepStrictEqual(checked.map((c) => c.label), ['15 seconds']);
  assert.strictEqual(row.submenu.every((c) => c.type === 'radio'), true);
});

test('a stored delay the menu does not offer still loads, and claims nothing', () => {
  // prefs.json written by a build with different choices can hold 7, and the page accepts any
  // whole second in 1-30. Rewriting it to the nearest offered value would change behaviour
  // the user chose, so it is kept — and the submenu simply has nothing checked rather than
  // quietly showing a value that is not the one stored.
  const row = rows(buildSettingsTemplate({ prefs: realPrefs({ safetyDelay: 7 }) }))['Safety delay'];
  assert.deepStrictEqual(row.submenu.filter((c) => c.checked), []);
});

test('choiceLabel renders zero as off, because that is what it means', () => {
  assert.strictEqual(choiceLabel(0), 'Off');
  assert.strictEqual(choiceLabel(10), '10 seconds');
});

test('the status header comes first and is not clickable', () => {
  // A settings screen that does not say whether protection is currently on is how a dead
  // hook looks like a working one. So the header is present, first, and inert.
  const items = buildSettingsTemplate({ prefs: realPrefs(), header: HEADER });
  assert.deepStrictEqual(items.slice(0, 2).map((i) => i.label), HEADER);
  assert.deepStrictEqual(items.slice(0, 2).map((i) => i.enabled), [false, false]);
  assert.strictEqual(items[2].type, 'separator');
});

test('a missing or empty header does not leave a leading separator', () => {
  for (const header of [undefined, [], null, ['', null]]) {
    const items = buildSettingsTemplate({ prefs: realPrefs(), header });
    assert.notStrictEqual(items[0].type, 'separator', `leading separator for ${JSON.stringify(header)}`);
  }
});

test('all ten settings render for a real prefs object', () => {
  const items = buildSettingsTemplate({ prefs: realPrefs(), header: HEADER });
  const labels = new Set(items.map((i) => i.label));
  for (const spec of SETTINGS) {
    assert.ok(labels.has(spec.label), `${spec.key} did not render as "${spec.label}"`);
  }
});

// ---------------------------------------------------------------- the clicks

test('clicking a checkbox persists the flipped value', () => {
  const applied = [];
  const items = buildSettingsTemplate({
    prefs: realPrefs({ readConfirmationsHook: true }),
    apply: (patch) => applied.push(patch),
  });
  rows(items)['Block read receipts'].click();
  assert.deepStrictEqual(applied, [{ readConfirmationsHook: false }]);
});

test('clicking a radio persists that value as a number', () => {
  const applied = [];
  const items = buildSettingsTemplate({
    prefs: realPrefs({ safetyDelay: 0 }),
    apply: (patch) => applied.push(patch),
  });
  const sub = rows(items)['Safety delay'].submenu;
  sub.find((c) => c.label === '20 seconds').click();
  sub.find((c) => c.label === 'Off').click();
  assert.deepStrictEqual(applied, [{ safetyDelay: 20 }, { safetyDelay: 0 }]);
  for (const patch of applied) assert.strictEqual(typeof patch.safetyDelay, 'number');
});

test('the reset row calls reset, and is absent when no reset was offered', () => {
  let resets = 0;
  const withReset = buildSettingsTemplate({ prefs: realPrefs(), reset: () => { resets += 1; } });
  rows(withReset)['Reset all options to defaults'].click();
  assert.strictEqual(resets, 1);

  const without = buildSettingsTemplate({ prefs: realPrefs() });
  assert.ok(!('Reset all options to defaults' in rows(without)));
});

test('a throwing apply does not propagate out of a menu click', () => {
  // The row is a one-line arrow inside a template Electron invokes. If it throws, the throw
  // surfaces as an unhandled error in the menu's event loop, where it is easy to lose — and
  // the user gets no feedback that their click did nothing. Contained here on purpose.
  const items = buildSettingsTemplate({
    prefs: realPrefs(),
    apply: () => { throw new Error('prefs.json is read-only'); },
  });
  assert.doesNotThrow(() => rows(items)['Block read receipts'].click());
  assert.doesNotThrow(() => rows(items)['Reset all options to defaults'] === undefined);
});

test('building from a bad prefs object yields no rows instead of throwing', () => {
  // settings-menu.js is required by tray.js at module load, so a throw here would take the
  // tray — and with it the app's only window back from a hidden state — down at startup.
  for (const prefs of [undefined, null, 'nonsense', 42]) {
    assert.deepStrictEqual(buildSettingsTemplate({ prefs }), []);
  }
  assert.deepStrictEqual(buildSettingsTemplate(), []);
});
