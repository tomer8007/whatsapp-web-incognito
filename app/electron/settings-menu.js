'use strict';
// The one list of settings, and the native menu rendered from it.
//
// WHY THIS FILE EXISTS
// --------------------
// Settings used to live in two places that could not see each other: the tray (native, but
// three of them) and the HTML panel injected into WhatsApp Web's DOM (all of them, until
// WhatsApp changed a class name and the panel stopped appearing at all — core/ui.js's
// "WAIncognito is temporarily broken" dialog). Two surfaces, two label sets, two chances to
// disagree. So: one table, and every native surface reads it.
//
// THE INVARIANT THIS FILE MUST NOT BREAK
// ---------------------------------------
// There are deliberately NO defaults here. Defaults are parsed out of background.js at build
// time and reach the shell through meta.json, so the app and the extension cannot disagree
// about what a default is (docs/ARCHITECTURE.md §1). A `default:` field in this file would be
// a second source of truth that nothing keeps in sync, so a descriptor describes only
// presentation: what to call a setting, which group it belongs to, and — for the one integer
// — which values are meaningful. The type is derived from the live defaults object.
//
// `autostart` is the one descriptor whose key is NOT in meta.json: it is a shell-only pref
// declared in main.js's SHELL_DEFAULTS, because there is no autostart concept in a browser
// tab. It is filtered by presence, like every other key, so nothing here needs to know that.

// ---------------------------------------------------------------- the table

/** Menu order is the order here, then GROUPS. Group headers render in GROUPS order. */
const GROUPS = Object.freeze([
  { id: 'privacy', label: 'Privacy' },
  { id: 'messages', label: 'Messages' },
  { id: 'timing', label: 'Timing' },
  { id: 'app', label: 'App' },
]);

/**
 * @typedef {object} SettingSpec
 * @property {string}   key       the pref key, as persisted
 * @property {string}   label     the menu row text
 * @property {string}   group     a GROUPS id
 * @property {boolean} [quick]    also surface it as a one-click tray row
 * @property {number[]} [choices] enumerated values; renders as a radio submenu
 */

/** @type {ReadonlyArray<SettingSpec>} */
const SETTINGS = Object.freeze([
  // Privacy: the three that leak identity, in the order a user cares about them.
  { key: 'readConfirmationsHook', label: 'Block read receipts', group: 'privacy', quick: true },
  { key: 'onlineUpdatesHook', label: 'Block online / last seen', group: 'privacy', quick: true },
  { key: 'typingUpdatesHook', label: 'Block typing indicators', group: 'privacy', quick: true },

  // Messages: what happens to a message once it has arrived. These were reachable ONLY from
  // the injected panel, so on the desktop they were one WhatsApp DOM change away from being
  // unreachable at all.
  { key: 'saveDeletedMsgs', label: 'Restore deleted messages', group: 'messages' },
  { key: 'showDeviceTypes', label: 'Show message device type', group: 'messages' },
  { key: 'autoReceiptOnReplay', label: 'Auto-send receipts on reply', group: 'messages' },
  { key: 'allowStatusDownload', label: 'Allow status downloading', group: 'messages' },
  { key: 'showReadWarning', label: 'Warn before sending a receipt', group: 'messages' },

  // Timing: safetyDelay holds a chat's receipts for N seconds
  // (core/injected_ui.js:129) so a reply can be composed first. Its UI was commented out
  // upstream, leaving a working feature with no way to reach it.
  //
  // A radio submenu, not a number field: the page only ever validated whole seconds 1-30
  // (core/ui.js:1118) and PrefsStore already rejects anything outside 0-30. Radio choices
  // are unrepresentable-wrong by construction. 0 is the off state, not a delay.
  { key: 'safetyDelay', label: 'Safety delay', group: 'timing', choices: [0, 5, 10, 15, 20, 30] },

  // App: shell-only, main.js SHELL_DEFAULTS.
  { key: 'autostart', label: 'Start automatically on login', group: 'app' },
]);

/**
 * The specs that apply to a given prefs object.
 *
 * Filtered by presence, not by a hardcoded allowlist, so the table stays the single place
 * that names a setting. A key the store does not know about renders nothing rather than
 * rendering a row that cannot be persisted — and settings-menu.test.js asserts coverage in
 * the other direction (every key in the defaults IS in the table), so this filter can only
 * ever hide something if that test broke.
 */
function settingsFor(prefs) {
  if (!prefs || typeof prefs !== 'object') return [];
  return SETTINGS.filter((s) => Object.prototype.hasOwnProperty.call(prefs, s.key));
}

/**
 * The specs that also get a one-click row in the tray.
 *
 * Not filtered by prefs: the tray asks "which settings deserve a shortcut row", which is a
 * property of the setting, not of the current values. What it renders is read from prefs
 * afterwards, so an unknown key is simply reported as off rather than hiding a row.
 */
function quickToggles() {
  return SETTINGS.filter((s) => s.quick === true);
}

/**
 * Validation bounds for every numeric setting, derived from its own `choices`.
 *
 * Deliberately min..max and not the exact set: a prefs.json written by a build with different
 * choices (or hand-edited) may hold 7, and silently rewriting a saved delay to the nearest
 * offered value would change behaviour the user chose. 7 is a perfectly good delay — the page
 * accepts any whole second in 1-30 — so it loads, works, and simply shows no radio checked
 * until the user picks one. Out-of-range is a different matter and stays clamped.
 *
 * Used by app/electron/prefs-store.js so the bound a value is validated against and the set of
 * values the menu offers are one declaration, not two that can drift.
 */
function numericRanges() {
  const out = {};
  for (const s of SETTINGS) {
    if (!s.choices || !s.choices.length) continue;
    out[s.key] = { min: Math.min(...s.choices), max: Math.max(...s.choices) };
  }
  return out;
}

// ---------------------------------------------------------------- the menu

/**
 * A choice row's text. `0` is rendered as "Off" rather than "0 seconds" because that is what
 * it means: the delay is disabled (see the SETTINGS comment on safetyDelay).
 */
function choiceLabel(value) {
  return value === 0 ? 'Off' : `${value} seconds`;
}

/**
 * One row for one spec.
 *
 * `prefs` is captured rather than read at click time, which is deliberate: the menu is built
 * once and Electron closes it on the first click, so a stale capture is only ever read once
 * and the rebuild that follows (applyPatch → tray.update) is what makes the next open correct.
 */
function rowFor(spec, prefs, apply) {
  const change = (patch) => {
    try { apply(patch); } catch (e) { /* the caller's guard logs; a menu row must never throw */ }
  };

  if (spec.choices) {
    return {
      label: spec.label,
      submenu: spec.choices.map((value) => ({
        label: choiceLabel(value),
        type: 'radio',
        checked: prefs[spec.key] === value,
        click: () => change({ [spec.key]: value }),
      })),
    };
  }

  return {
    label: spec.label,
    type: 'checkbox',
    checked: prefs[spec.key] === true,
    click: () => change({ [spec.key]: prefs[spec.key] !== true }),
  };
}

/**
 * Build the template for the settings menu.
 *
 * Pure: it returns an array of Electron menu items and calls nothing itself beyond the
 * `apply` callback it is handed, so app/electron/settings-menu.test.js can assert the real
 * template under bare `node --test` with no Electron — the same trick tray.js uses for its
 * badge renderer.
 *
 * @param {object} opts
 * @param {object} opts.prefs      the full prefs object (a complete one, from PrefsStore.get)
 * @param {(patch: object) => any} [opts.apply]  persist a partial patch
 * @param {() => any} [opts.reset]  restore every default
 * @param {string[]} [opts.header]  pre-formatted disabled rows (the watchdog status line)
 * @returns {object[]} an Electron menu template
 */
function buildSettingsTemplate(opts) {
  const { prefs, apply, reset, header } = opts || {};
  const items = [];
  // A separator goes BETWEEN blocks, never inside one. Putting one between a group heading
  // and its first row, or between the two status lines, splits a unit that has to be read as
  // a unit — so separators are emitted explicitly at block boundaries instead.
  const separator = () => { if (items.length) items.push({ type: 'separator' }); };

  // The status line first, unlabelled and disabled. A settings screen that does not say
  // whether the thing is currently protecting you is how a dead hook looks like a working
  // one — the same argument the tray makes for keeping it in its menu (tray.js header).
  for (const line of Array.isArray(header) ? header.filter(Boolean) : []) {
    items.push({ label: line, enabled: false });
  }

  for (const group of GROUPS) {
    const specs = settingsFor(prefs).filter((s) => s.group === group.id);
    if (!specs.length) continue;
    separator();
    items.push({ label: group.label, enabled: false });
    for (const spec of specs) items.push(rowFor(spec, prefs, apply));
  }

  if (typeof reset === 'function') {
    separator();
    items.push({
      label: 'Reset all options to defaults',
      click: () => { try { reset(); } catch (e) { /* as above */ } },
    });
  }

  return items;
}

module.exports = {
  GROUPS, SETTINGS, settingsFor, quickToggles, numericRanges, buildSettingsTemplate, choiceLabel,
};
