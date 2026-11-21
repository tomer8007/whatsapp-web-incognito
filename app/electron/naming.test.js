'use strict';
// Naming convention, enforced.
//
// The rule, in one place so it is reviewable and cannot drift:
//   1. Anything a USER READS gets spaces: "Whatsapp Incognito" (window titles, tray menu
//      labels, the tooltip, dialog text, the notification fallback title, the .desktop
//      Name). Spaces are the whole point of a display name.
//   2. Anything used as an IDENTIFIER gets no spaces, and is left exactly as it already
//      was wherever it already existed. Renaming an identifier is not free: the deb
//      package name, the executable path and the installed .desktop filename all derive
//      from these, and changing one silently orphans files on upgrade.
//   3. "WhatsApp" with a capital A always means the SERVICE, never this app. Rewriting
//      those to "Whatsapp" would be a correctness bug, not a style one, so the check
//      below is deliberately two-sided.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const SOURCES = ['main.js', 'tray.js', 'preload.js', 'desktop-integration.js', 'deep-link.js'];

/** Strip // and block comments so prose about the app is not mistaken for a string. */
function codeOf(name) {
  const src = fs.readFileSync(path.join(__dirname, name), 'utf8');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('package.json keeps every existing identifier exactly as it was', () => {
  // These four are load-bearing. Changing any of them is a breaking change for an
  // installed copy, not a rename.
  assert.strictEqual(pkg.name, 'waincognito', 'deb package + executable name');
  assert.strictEqual(pkg.desktopName, 'waincognito', 'installed .desktop filename');
  assert.strictEqual(pkg.build.appId, 'com.wa-incognito.app', 'app id');
  assert.strictEqual(pkg.build.productName, 'Whatsapp Incognito', 'display name, with its space');
});

test('the user-visible name is spaced, and the identifier is not', () => {
  assert.match(pkg.build.productName, / /, 'the display name has a space');
  assert.doesNotMatch(pkg.desktopName, / /, 'the .desktop name cannot have a space');
  assert.strictEqual(pkg.desktopName, 'WhatsappIncognito'.replace('WhatsappIncognito', 'waincognito'));
});

test('no user-visible string uses the unspaced app name', () => {
  // The regression this guards: a tray label or dialog that says "WAIncognito" next to
  // one that says "Whatsapp Incognito" reads as two different applications.
  const offenders = [];
  for (const name of SOURCES) {
    const code = codeOf(name);
    code.split('\n').forEach((line, i) => {
      // app.setName is the one deliberate exception — see main.js.
      if (/app\.setName\(/.test(line)) return;
      if (/WAIncognito|Waincognito/.test(line)) offenders.push(`${name}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepStrictEqual(offenders, [], 'unspaced app name leaked into a user-visible string');
});

test('the setName userData key is left alone so prefs are not orphaned', () => {
  // ~/.config/WAIncognito/prefs.json is where every existing user's interception
  // settings live. Renaming this directory would silently reset them all.
  const code = codeOf('main.js');
  assert.match(code, /app\.setName\('WAIncognito'\)/,
    'app.setName must stay WAIncognito — it is a directory key, not branding');
});

test('references to WhatsApp the service were not rewritten', () => {
  // Two-sided on purpose: a blanket "WhatsApp -> Whatsapp" pass would corrupt these.
  const service = codeOf('main.js') + codeOf('preload.js') + codeOf('watchdog.js');
  assert.match(service, /WhatsApp/, 'the service is still spelled with a capital A');
  assert.doesNotMatch(service, /Whatsapp (Web|Incognito) (refuses|loaded|serves)/,
    'service sentences were not mangled');
});

test('every user-visible app name in the sources is the spaced form', () => {
  // A positive check, so a rename that deletes the name entirely also fails.
  const found = new Set();
  for (const name of SOURCES) {
    for (const m of codeOf(name).matchAll(/['"`]([^'"`]*Whatsapp Incognito[^'"`]*)['"`]/g)) {
      found.add(m[1]);
    }
  }
  assert.ok(found.size >= 4, 'the spaced name is actually used, found: ' + [...found].join(' / '));
  for (const s of found) {
    assert.doesNotMatch(s, /WhatsappIncognito/, 'the unspaced form leaked into: ' + s);
  }
});
