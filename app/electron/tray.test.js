'use strict';
// Tray unit tests.
//
// THE TEST THAT MATTERS MOST HERE
// -------------------------------
// "update() installs a context menu". A previous revision of the badge code called
// guard() inside update() without ever defining it. update() wrapped everything in one
// outer try/catch, so the resulting ReferenceError was swallowed: the tray logged
// "tray update failed: guard is not defined" on every single launch and never built a
// menu or a badge. The app still started, the icon still appeared in the tray, and every
// other test in this file passed — because nothing asserted that a menu was ever set.
//
// So this file asserts on OBSERVABLE EFFECTS (was setContextMenu called? what did the
// image look like?), never on the absence of a thrown error.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { createTray, createBadgedIcon, rgbaToPNG } = require('./tray');
const { SETTINGS } = require('./settings-menu.js');

// ---------------------------------------------------------------- fakes

/** A stand-in NativeImage that carries its RGBA buffer around. */
function fakeImage(width = 24, height = 24, fill = [11, 128, 0, 255]) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = fill[0]; rgba[i * 4 + 1] = fill[1];
    rgba[i * 4 + 2] = fill[2]; rgba[i * 4 + 3] = fill[3];
  }
  return {
    rgba,
    resized: null,
    isEmpty: () => false,
    resize(opts) { const n = fakeImage(opts.width, opts.height, fill); n.resized = opts; return n; },
    // Electron returns BGRA on Linux, and createBadgedIcon converts BGRA -> RGBA. This
    // fake has to honour that or the conversion silently round-trips the wrong channel
    // order and every colour assertion in this file is testing a lie.
    toBitmap() {
      const bgra = Buffer.from(rgba);
      for (let i = 0; i < bgra.length; i += 4) {
        const r = bgra[i]; bgra[i] = bgra[i + 2]; bgra[i + 2] = r;
      }
      return bgra;
    },
  };
}

const fakeNativeImage = {
  created: [],
  createFromPath(file) { return fakeImage(128, 128); },
  createFromBuffer(buf) { const i = { buf, isEmpty: () => false }; this.created.push(i); return i; },
  createEmpty() { return { isEmpty: () => true }; },
};

/** Records everything the tray asks of it. */
function makeTrayCtor(overrides = {}) {
  const calls = { contextMenus: [], menus: [], images: [], tooltips: [] };
  class FakeTray {
    constructor(image) { this.image = image; calls.images.push(image); }
    setContextMenu(m) { calls.contextMenus.push(m); }
    setMenu(m) { calls.menus.push(m); }
    setImage(i) { this.image = i; calls.images.push(i); }
    setToolTip(t) { calls.tooltips.push(t); }
    on() {}
    isDestroyed() { return false; }
    destroy() {}
  }
  Object.assign(FakeTray.prototype, overrides);
  return { FakeTray, calls };
}

/** Walks a buildFromTemplate result back to plain labels. */
function labelsOf(menu) {
  return (menu.templates || []).map((t) => (t.type === 'separator' ? '---' : t.label));
}

// ---------------------------------------------------------------- createTray

function baseOpts(extra = {}) {
  return Object.assign({
    app: { isQuitting: false },
    getWindow: () => ({ isDestroyed: () => false, isMinimized: () => false, restore() {}, show() {}, focus() {} }),
    getStatus: () => ({ status: 'PROTECTED', framesIn: 3, framesOut: 9, blocked: 2, heldChats: 0, sinceLastFrame: 1200 }),
    setPref: () => {},
    // Shaped like the real object main.js hands the tray: the interception keys plus the
    // shell-only autostart. A partial fixture would silently stop exercising the autostart
    // row, which is now filtered through the settings table like every other row.
    getPrefs: () => ({ readConfirmationsHook: true, autostart: false }),
    quit: () => {},
    nativeImage: fakeNativeImage,
  }, extra);
}

test('the tray offers the full settings menu, and only when one was provided', () => {
  // The tray is the discoverable route to the eight settings it does not show as one-click
  // rows. Asserted at the tray's own boundary because the failure is silent in both
  // directions: a missing row leaves the user with only a keyboard shortcut they do not know,
  // and a row wired to nothing looks present but does nothing when clicked.
  const withSettings = (openSettings) => {
    const { FakeTray, calls } = makeTrayCtor();
    createTray(baseOpts({
      openSettings,
      Menu: { buildFromTemplate: (t) => ({ templates: t }) },
      Tray: FakeTray,
    }));
    return calls.contextMenus[0];
  };

  const menu = withSettings(() => {});
  const labels = labelsOf(menu);
  assert.ok(labels.includes('Settings…'), `no Settings row in: ${labels.join(' | ')}`);
  // And it must sit below the quick toggles, which is the order the menu reads in.
  assert.ok(labels.indexOf('Settings…') > labels.indexOf('Block read receipts'),
    'Settings must come after the quick toggles');

  // Clicking it must call through, not swallow.
  let opened = 0;
  const clickable = withSettings(() => { opened += 1; });
  clickable.templates.find((t) => t.label === 'Settings…').click();
  assert.strictEqual(opened, 1, 'the Settings row did not open the menu');

  // A tray built without the capability must not show a dead row.
  assert.ok(!labelsOf(withSettings(undefined)).includes('Settings…'),
    'a Settings row appeared with no openSettings to call');
});

test('the tray autostart row renders, and says what the settings table calls it', () => {
  // Autostart is shell-only, so it is in main.js's SHELL_DEFAULTS rather than the derived
  // defaults — and its label is read from the settings table like every other row. Both
  // facts are silent when broken: no row, or a row whose text disagrees with the menu the
  // same setting also appears in.
  const { FakeTray, calls } = makeTrayCtor();
  createTray(baseOpts({ Menu: { buildFromTemplate: (t) => ({ templates: t }) }, Tray: FakeTray }));
  const labels = labelsOf(calls.contextMenus[0]);
  const row = calls.contextMenus[0].templates.find((t) => t.label === 'Start automatically on login');
  assert.ok(row, `no autostart row in: ${labels.join(' | ')}`);
  assert.strictEqual(row.type, 'checkbox');
  assert.strictEqual(row.checked, false, 'autostart:false must render unchecked');

  // Same string the settings menu uses, from the one table.
  assert.ok(SETTINGS.some((s) => s.key === 'autostart' && s.label === row.label),
    `the tray and the settings table disagree about the autostart label: "${row.label}"`);
});

test('update() installs a context menu on create', () => {
  const { FakeTray, calls } = makeTrayCtor();
  const handle = createTray(baseOpts({ Menu: { buildFromTemplate: (t) => ({ templates: t }) }, Tray: FakeTray }));
  assert.ok(handle, 'createTray returned a handle');
  // The regression this file exists for: a dead tray still constructs and still looks
  // fine, it just never gets a menu.
  assert.strictEqual(calls.contextMenus.length, 1, 'exactly one menu was installed');
  assert.ok(calls.contextMenus[0].templates.length > 0, 'the menu has items');
});

test('the menu leads with the honest status and the counters', () => {
  const { FakeTray, calls } = makeTrayCtor();
  createTray(baseOpts({ Menu: { buildFromTemplate: (t) => ({ templates: t }) }, Tray: FakeTray }));
  const labels = labelsOf(calls.contextMenus[0]);
  assert.match(labels[0], /^Status: Protected$/);
  assert.match(labels[1], /3 in \/ 9 out/);
  assert.match(labels[1], /2 receipts blocked/);
  assert.ok(labels.includes('Open Whatsapp Incognito'), 'the window can be reopened: ' + labels.join(' | '));
});

test('the menu never says PROTECTED unless the status really is', () => {
  for (const [status, expected] of [
    ['NOT_PROTECTED', /NOT PROTECTED/],
    ['RECONNECTING', /NOT blocked right now/],
  ]) {
    const { FakeTray, calls } = makeTrayCtor();
    createTray(baseOpts({
      Menu: { buildFromTemplate: (t) => ({ templates: t }) },
      Tray: FakeTray,
      getStatus: () => ({ status, framesIn: 0, framesOut: 0, sinceLastFrame: null }),
    }));
    assert.match(labelsOf(calls.contextMenus[0])[0], expected, status);
  }
});

test('a status getter that throws degrades to UNKNOWN instead of taking the tray down', () => {
  const { FakeTray, calls } = makeTrayCtor();
  const handle = createTray(baseOpts({
    Menu: { buildFromTemplate: (t) => ({ templates: t }) },
    Tray: FakeTray,
    getStatus: () => { throw new Error('watchdog is on fire'); },
  }));
  assert.ok(handle);
  assert.strictEqual(calls.contextMenus.length, 1, 'a menu was still installed');
  assert.match(labelsOf(calls.contextMenus[0])[0], /Starting up/);
});

test('a failing buildFromTemplate does not stop the tooltip', () => {
  // One broken sub-step must not cost the others. This is the other half of the guard fix.
  const { FakeTray, calls } = makeTrayCtor();
  createTray(baseOpts({
    Menu: { buildFromTemplate: () => { throw new Error('menu exploded'); } },
    Tray: FakeTray,
  }));
  assert.strictEqual(calls.contextMenus.length, 0, 'the menu really did fail');
  assert.strictEqual(calls.tooltips.length, 1, 'but the tooltip was still set');
});

test('setContextMenu is preferred, with setMenu only as a fallback', () => {
  // Measured on Electron 44: tray.setMenu does not exist and throws if called.
  const withBoth = makeTrayCtor({ setMenu() { throw new Error('setMenu must not be called'); } });
  createTray(baseOpts({ Menu: { buildFromTemplate: (t) => ({ templates: t }) }, Tray: withBoth.FakeTray }));
  assert.strictEqual(withBoth.calls.contextMenus.length, 1);
  assert.strictEqual(withBoth.calls.menus.length, 0);

  const setMenuOnly = makeTrayCtor();
  delete setMenuOnly.FakeTray.prototype.setContextMenu;
  createTray(baseOpts({ Menu: { buildFromTemplate: (t) => ({ templates: t }) }, Tray: setMenuOnly.FakeTray }));
  assert.strictEqual(setMenuOnly.calls.menus.length, 1, 'fell back to setMenu');
});

test('the tooltip names the state and never softens a failure', () => {
  const { FakeTray, calls } = makeTrayCtor();
  createTray(baseOpts({
    Menu: { buildFromTemplate: (t) => ({ templates: t }) },
    Tray: FakeTray,
    getStatus: () => ({ status: 'NOT_PROTECTED', framesIn: 0, framesOut: 0, reason: 'socket closed' }),
  }));
  assert.match(calls.tooltips[0], /NOT PROTECTED/);
  assert.match(calls.tooltips[0], /Receipts are not being protected/);
});

test('a dead tray is a clean degrade, not a crash', () => {
  class ExplodingTray { constructor() { throw new Error('no StatusNotifier host'); } }
  const handle = createTray(baseOpts({
    Menu: { buildFromTemplate: (t) => ({ templates: t }) },
    Tray: ExplodingTray,
  }));
  assert.strictEqual(handle, null, 'main falls back to normal close semantics');
});

// ---------------------------------------------------------------- the badge

/** Decode the little PNG we generate, so the assertions are on real pixels. */
function decodePNG(buf) {
  assert.deepStrictEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  let off = 8;
  const chunks = {};
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9] };
    } else if (type === 'IDAT') idat.push(data);
    chunks[type] = data;
    off += 12 + len;
  }
  assert.ok(ihdr, 'IHDR present');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(ihdr.width * ihdr.height * 4);
  for (let y = 0; y < ihdr.height; y++) {
    assert.strictEqual(raw[y * (1 + ihdr.width * 4)], 0, 'filter byte 0 on every row');
    raw.copy(px, y * ihdr.width * 4, y * (1 + ihdr.width * 4) + 1, (y + 1) * (1 + ihdr.width * 4));
  }
  return { ihdr, px };
}

test('rgbaToPNG emits a decodable 8-bit RGBA image', () => {
  const { ihdr, px } = decodePNG(rgbaToPNG(Buffer.alloc(4 * 4 * 4, 0x7f), 4, 4));
  assert.strictEqual(ihdr.width, 4);
  assert.strictEqual(ihdr.height, 4);
  assert.strictEqual(ihdr.depth, 8);
  assert.strictEqual(ihdr.colorType, 6, '6 = truecolour with alpha');
  assert.strictEqual(px.length, 4 * 4 * 4);
  assert.strictEqual(px[0], 0x7f, 'pixel data survived the round trip');
});

test('a count of zero or less, or a non-number, is a no-op and returns the icon untouched', () => {
  const icon = fakeImage();
  for (const n of [0, -1, undefined, null, NaN, 'lots', {}, []]) {
    assert.strictEqual(createBadgedIcon(icon, n, fakeNativeImage), icon, `count=${String(n)}`);
  }
  assert.strictEqual(createBadgedIcon(null, 5, fakeNativeImage), null, 'a missing icon stays missing');
});

test('a missing nativeImage degrades to the plain icon rather than throwing', () => {
  const icon = fakeImage();
  assert.strictEqual(createBadgedIcon(icon, 3, undefined), icon);
  assert.strictEqual(createBadgedIcon(icon, 3, {}), icon);
});

test('the badge repaints the bottom-right corner and leaves the rest alone', () => {
  const BASE = [11, 128, 0, 255];   // R is non-zero on purpose, see `countInk`
  const before = fakeImage(24, 24, BASE);
  const out = createBadgedIcon(before, 3, fakeNativeImage);
  assert.ok(out && out.buf, 'a new image was produced');

  const { ihdr, px } = decodePNG(out.buf);
  assert.strictEqual(ihdr.width, 24);
  assert.strictEqual(ihdr.height, 24);

  const at = (x, y) => { const i = (y * 24 + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
  assert.ok(countInk(px) > 0, 'the digit was drawn in black');
  // Top-left corner is untouched: the badge must not cover the whole icon.
  assert.deepStrictEqual(at(0, 0), BASE, 'the top-left pixel is untouched');
  assert.deepStrictEqual(before.rgba, fakeImage(24, 24, BASE).rgba, 'the source image was not mutated');
});

/**
 * Count glyph ink: fully opaque pure black. Matches on all four channels, so it cannot be
 * fooled by a base colour that merely has R === 0 (an earlier version of this file used
 * a green base and counted the entire background as "ink", which inverted the very
 * comparison it was making).
 */
function countInk(px) {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0 && px[i + 3] === 255) n++;
  }
  return n;
}

test('9+ is used for anything past nine', () => {
  const ink = (count) => countInk(decodePNG(createBadgedIcon(fakeImage(), count, fakeNativeImage).buf).px);
  const one = ink(1);
  const nine = ink(9);
  const ten = ink(10);
  // "9+" is two glyphs, so strictly more ink than the single "9" it replaces.
  assert.ok(ten > nine, `"9+" (${ten}) should draw more than "9" (${nine})`);
  assert.ok(one > 0 && one < nine, '1 and 9 are both real glyphs');
  // 250 is capped at "9+" — a counter that kept growing would overflow a 24px icon.
  assert.strictEqual(ink(250), ten, '250 renders identically to 10');
});

test('a fractional count is floored rather than rendered as a junk label', () => {
  const ink = (count) => countInk(decodePNG(createBadgedIcon(fakeImage(), count, fakeNativeImage).buf).px);
  assert.strictEqual(ink(3.7), ink(3), '3.7 renders as "3"');
});

test('updateBadge(0) puts the plain icon back', () => {
  const { FakeTray, calls } = makeTrayCtor();
  const before = fakeNativeImage.created.length;
  const handle = createTray(baseOpts({ Menu: { buildFromTemplate: (t) => ({ templates: t }) }, Tray: FakeTray }));
  const plain = calls.images[calls.images.length - 1];

  handle.updateBadge(7);
  assert.strictEqual(fakeNativeImage.created.length, before + 1, 'a badged icon was built');
  handle.updateBadge(0);
  assert.strictEqual(calls.images[calls.images.length - 1], plain, 'the original icon is restored');
});

test('updateBadge ignores junk and never regresses the count to NaN', () => {
  const { FakeTray, calls } = makeTrayCtor();
  const handle = createTray(baseOpts({ Menu: { buildFromTemplate: (t) => ({ templates: t }) }, Tray: FakeTray }));
  for (const junk of [undefined, null, 'lots', NaN, -4]) {
    handle.updateBadge(junk);
    assert.strictEqual(calls.contextMenus.length >= 2, true, 'still functional after ' + String(junk));
  }
});

test('createTray refuses a caller that forgot getWindow', () => {
  assert.throws(() => createTray({}), /getWindow is required/);
});

// ---------------------------------------------------------------- icon loading

test('the tray icon candidates are real files on disk', () => {
  // A tray icon that silently fails to load is an app with no visible presence at all,
  // so the candidate list is checked against the filesystem rather than trusted.
  const dir = path.join(__dirname, '..', '..', 'images');
  const candidates = ['icon_128_blue.png', 'icon_128_reshaped.png', 'incognito_gray.png', 'incognito.png'];
  for (const name of candidates) {
    const p = path.join(dir, name);
    assert.ok(fs.existsSync(p), `missing tray icon candidate: ${name}`);
    assert.ok(fs.statSync(p).size > 0, `empty tray icon candidate: ${name}`);
  }
  // The PNGs must come first: on Electron 44 nativeImage.createFromPath returns an EMPTY
  // image for every SVG here, which is a silent failure rather than a throw.
  const src = fs.readFileSync(path.join(__dirname, 'tray.js'), 'utf8');
  const block = src.slice(src.indexOf('ICON_CANDIDATES'), src.indexOf('];', src.indexOf('ICON_CANDIDATES')));
  const firstSvg = block.indexOf('.svg');
  const firstPng = block.indexOf('.png');
  assert.ok(firstPng > 0 && firstPng < firstSvg, 'a PNG is tried before any SVG');
});
