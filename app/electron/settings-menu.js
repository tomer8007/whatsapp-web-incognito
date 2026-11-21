'use strict';
// Electron native menu adapter over the unified schema in shared/settings_schema.js.

const {
  GROUPS,
  SETTINGS,
  settingsFor,
  quickToggles,
  numericRanges,
  choiceLabel,
} = require('../../shared/settings_schema.js');

/**
 * Build one Electron MenuItem template row for a schema spec.
 */
function rowFor(spec, prefs, apply, extra) {
  const change = (patch) => {
    try { apply(patch); } catch (e) { /* caller's guard logs; a menu row must never throw */ }
  };

  if (spec.type === 'secret-hash') {
    const hasPin = typeof prefs[spec.key] === 'string' && prefs[spec.key].length > 0;
    return {
      label: spec.label,
      submenu: [
        {
          label: 'Set / Change Privacy PIN…',
          click: () => {
            try {
              if (extra && typeof extra.openPinPrompt === 'function') extra.openPinPrompt();
            } catch (e) { /* ignore */ }
          },
        },
        {
          label: 'Clear Privacy PIN',
          enabled: hasPin,
          click: () => change({ [spec.key]: '' }),
        },
      ],
    };
  }

  if (spec.choices) {
    return {
      label: spec.label,
      submenu: spec.choices.map((value) => ({
        label: choiceLabel(value, spec),
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
 * Build the template for the Electron native settings menu.
 *
 * @param {object} opts
 * @param {object} opts.prefs
 * @param {(patch: object) => any} [opts.apply]
 * @param {() => any} [opts.reset]
 * @param {() => void} [opts.openPinPrompt]
 * @param {string[]} [opts.header]
 * @returns {object[]}
 */
function buildSettingsTemplate(opts) {
  const { prefs, apply, reset, openPinPrompt, header } = opts || {};
  const items = [];
  const separator = () => { if (items.length) items.push({ type: 'separator' }); };

  for (const line of Array.isArray(header) ? header.filter(Boolean) : []) {
    items.push({ label: line, enabled: false });
  }

  for (const group of GROUPS) {
    const specs = settingsFor(prefs).filter((s) => s.group === group.id);
    if (!specs.length) continue;
    separator();
    items.push({ label: group.label, enabled: false });
    for (const spec of specs) {
      items.push(rowFor(spec, prefs, apply, { openPinPrompt }));
    }
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
