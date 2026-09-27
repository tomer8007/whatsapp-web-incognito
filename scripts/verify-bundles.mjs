#!/usr/bin/env node
// Build-time assertions (docs/ELECTRON_APP_PLAN.md §7).
//
// Every assertion here converts a SILENT failure into a build failure. The ones that
// matter most are A1/A11 (a dead interception hook that looks perfectly healthy) and
// A2 (a lexical redeclaration that kills an entire bundle with a SyntaxError).
//
//   node scripts/verify-bundles.mjs

import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const EBUILD = join(ROOT, 'app', '.build');

let failures = 0;
let passes = 0;
const results = [];

function check(id, desc, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { passes++; results.push(['PASS', id, desc]); }
    else { failures++; results.push(['FAIL', id, `${desc} — ${r}`]); }
  } catch (e) {
    failures++;
    results.push(['FAIL', id, `${desc} — threw: ${e.message}`]);
  }
}

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readSrc = (p) => {
  let s = readFileSync(p, 'utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
};

// ---------------------------------------------------------------- source-level

const MAIN_GROUP = [
  'core/ws_hook.js',
  'lib/pbf.3.0.5.min.js', 'lib/libsignal-protocol-ee5b8ba.min.js', 'lib/pako.js',
  'core/parsing/binary_reader.js', 'core/parsing/binary_writer.js',
  'core/parsing/node_reader_writer.js',
  'core/parsing/protobuf/WhisperTextProtocol.js', 'core/parsing/protobuf/WAProto.js',
  'core/utils.js', 'core/ui_class_names.js', 'core/injected_ui.js',
  'core/multi_device.js', 'core/node_handler.js', 'core/interception.js',
];
const UI_GROUP = [
  'core/ui_class_names.js', 'core/ui.js', 'core/status_download.js',
  'lib/drop.js', 'lib/sweetalert.min.js',
];

/** Top-level (column-0) declarations, which is what actually shares a scope. */
function topLevelDecls(files) {
  const map = new Map();
  for (const f of files) {
    readSrc(join(ROOT, f)).split('\n').forEach((line, i) => {
      const m = line.match(/^(var|let|const|function|class)\s+([A-Za-z_$][\w$]*)/);
      if (m) {
        const [, kind, name] = m;
        if (!map.has(name)) map.set(name, []);
        map.get(name).push({ kind, file: f, line: i + 1 });
      }
    });
  }
  return map;
}

// A11 — the collision that used to kill interception silently. Patch P1 renamed
// ui.js's `initialize` to `initializeUI`. A regression here means a single concatenated
// script would once again call the wrong initialize() and never arm the WebSocket hook.
check('A11', 'no `initialize` shared between the main and ui groups', () => {
  const main = topLevelDecls(MAIN_GROUP);
  const ui = topLevelDecls(UI_GROUP);
  const shared = [...main.keys()].filter((n) => ui.has(n));
  if (shared.includes('initialize')) {
    return '`initialize` is declared in BOTH groups again — concatenating them would ' +
      'silently disable interception. Re-apply patch P1.';
  }
  // Anything else shared must be a benign `var` from a file present in both groups,
  // which is idempotent by construction.
  const bad = shared.filter((n) =>
    main.get(n).some((d) => d.kind !== 'var') || ui.get(n).some((d) => d.kind !== 'var'));
  if (bad.length) return `shared non-var names would clobber on concatenation: ${bad.join(', ')}`;
  return true;
});

// A2 — `let`/`const`/`class` redeclared in one scope is a fatal SyntaxError that kills
// the whole bundle. `var` is benign (last-wins, same as separate <script> tags).
for (const [label, group] of [['main', MAIN_GROUP], ['ui', UI_GROUP]]) {
  check('A2', `no lexical (let/const/class) redeclaration inside the ${label} bundle`, () => {
    const seen = new Map();
    const dups = [];
    for (const f of group) {
      readSrc(join(ROOT, f)).split('\n').forEach((line, i) => {
        const m = line.match(/^(let|const|class)\s+([A-Za-z_$][\w$]*)/);
        if (!m) return;
        const name = m[2];
        if (seen.has(name)) dups.push(`${name} (${seen.get(name)} & ${f}:${i + 1})`);
        else seen.set(name, `${f}:${i + 1}`);
      });
    }
    return dups.length ? `SyntaxError waiting to happen: ${dups.join(', ')}` : true;
  });
}

// A8 — every live `debugger;` suspends execution when DevTools is open. Electron users
// will open DevTools, so these must be gone. `//debugger;` comments are fine.
check('A8', 'no live `debugger;` statements in core/', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        readSrc(p).split('\n').forEach((line, i) => {
          if (/^[ \t]*debugger;[ \t]*$/.test(line) || /if\s*\(.*\)\s*debugger;/.test(line)) {
            hits.push(`${relative(ROOT, p)}:${i + 1}`);
          }
        });
      }
    }
  };
  walk(join(ROOT, 'core'));
  return hits.length ? `${hits.length} live debugger statement(s): ${hits.join(', ')}` : true;
});

// A9 — checkNodeEncoderSanity re-encodes every frame. It must be debug-gated (P3),
// otherwise the hot path pays a full decode+encode per message for nothing.
check('A9', 'checkNodeEncoderSanity calls are WAdebugMode-gated', () => {
  const src = readSrc(join(ROOT, 'core/interception.js'));
  const lines = src.split('\n');
  const bad = [];
  lines.forEach((line, i) => {
    if (!/await\s+checkNodeEncoderSanity\(/.test(line)) return;
    // Walk back a few lines for a WAdebugMode guard.
    const window = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
    if (!/if\s*\(\s*WAdebugMode\s*\)/.test(window)) bad.push(`core/interception.js:${i + 1}`);
  });
  return bad.length ? `unguarded call(s) at ${bad.join(', ')}` : true;
});

// P5 regression guard — `isIncoming` was never declared upstream, so `isIncoming=X`
// at a call site was an implicit global write on the per-frame path.
check('P5', 'isIncoming is never assigned in expression position', () => {
  const src = readSrc(join(ROOT, 'core/interception.js'));
  if (!/var\s+isIncoming\s*=/.test(src)) return 'no `var isIncoming` declaration found';
  const bad = [];
  src.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');           // drop line comments
    if (!/isIncoming\s*=[^=]/.test(code)) return;
    if (/\b(var|let|const)\s+isIncoming\b/.test(code)) return;          // declaration
    if (/^\s*(async\s+)?function\b/.test(code)) return;                 // parameter default
    bad.push(`core/interception.js:${i + 1}`);
  });
  return bad.length ? `implicit global write(s) at ${bad.join(', ')}` : true;
});

// A10 — a BOM at a concatenation seam is not something to rely on.
check('A10', 'no UTF-8 BOM in any bundled source file', () => {
  const bad = [];
  for (const f of [...new Set([...MAIN_GROUP, ...UI_GROUP, 'styles.css', 'lib/css/drop-theme-basic.css'])]) {
    const fd = readFileSync(join(ROOT, f));
    if (fd[0] === 0xef && fd[1] === 0xbb && fd[2] === 0xbf) bad.push(f);
  }
  return bad.length ? `BOM in: ${bad.join(', ')}` : true;
});

// A3 — an upstream release must not be able to silently drop part of the chain.
check('A3', 'every file in the injection chain exists', () => {
  const all = [...new Set([...MAIN_GROUP, ...UI_GROUP, 'lib/moduleraid.js',
    'styles.css', 'lib/css/drop-theme-basic.css', 'background.js'])];
  const missing = all.filter((f) => !existsSync(join(ROOT, f)));
  return missing.length ? `missing: ${missing.join(', ')}` : true;
});

// A7 — the recorded patch set is the budget for local divergence from upstream. This is
// NOT "identical to upstream/master": §2.7 documents 3 pre-existing functional patches,
// and naive `git diff --quiet upstream/master -- core lib` fails on day one.
check('A7', 'core/ + lib/ divergence is within the recorded patch set', () => {
  const recPath = join(ROOT, 'patches', 'manifest.json');
  if (!existsSync(recPath)) return 'patches/manifest.json is missing';
  const rec = readJSON(recPath);
  let diffOut = '';
  try {
    diffOut = execFileSync('git', ['diff', '--name-only', rec.upstreamRef, '--', 'core', 'lib'],
      { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    return `could not diff against ${rec.upstreamRef} (${e.message.split('\n')[0]})`;
  }
  const actual = diffOut.split('\n').filter(Boolean).sort();
  const expected = [...rec.patchedFiles].sort();
  const extra = actual.filter((f) => !expected.includes(f));
  const gone = expected.filter((f) => !actual.includes(f));
  const msgs = [];
  if (extra.length) msgs.push(`unrecorded edits: ${extra.join(', ')}`);
  if (gone.length) msgs.push(`recorded but no longer differ: ${gone.join(', ')}`);
  return msgs.length ? msgs.join('; ') : true;
});

// ---------------------------------------------------------------- build-output

const haveBuild = existsSync(EBUILD) && existsSync(join(DIST, 'extension', 'chrome'));

// A1 — main and ui must be separate output files.
check('A1', 'main and ui are emitted as separate files', () => {
  if (!haveBuild) return 'no build output; run `npm run build` first';
  for (const f of ['critical.js', 'main-rest.js', 'ui.js', 'deferred.js', 'styles.js', 'assets.json', 'meta.json']) {
    if (!existsSync(join(EBUILD, f))) return `missing build artifact ${f}`;
  }
  return true;
});

check('A1b', 'the ui bundle is genuinely separate from the main bundle', () => {
  if (!haveBuild) return 'no build output';
  const main = readSrc(join(EBUILD, 'main-rest.js'));
  const ui = readSrc(join(EBUILD, 'ui.js'));
  // core/ui_class_names.js is legitimately the first file of BOTH groups, so compare
  // from the first byte that only the ui group contains (core/ui.js).
  const uiOnly = ui.slice(ui.indexOf('/* ---- core/ui.js ---- */'));
  if (uiOnly.length < 200) return 'could not locate the ui-only region of the bundle';
  if (main.includes(uiOnly.slice(0, 400))) {
    return 'the ui-only region of the bundle also appears inside the main bundle';
  }
  return true;
});

check('A8b', 'shipped bundles contain no `debugger;`', () => {
  if (!haveBuild) return 'no build output';
  const bad = [];
  for (const f of ['critical.js', 'main-rest.js', 'ui.js', 'deferred.js']) {
    if (/^[ \t]*debugger;[ \t]*$/m.test(readSrc(join(EBUILD, f)))) bad.push(f);
  }
  return bad.length ? `found in: ${bad.join(', ')}` : true;
});

check('A10b', 'no BOM at any emitted bundle seam', () => {
  if (!haveBuild) return 'no build output';
  const bad = [];
  for (const f of readdirSync(EBUILD)) {
    const p = join(EBUILD, f);
    if (!statSync(p).isFile()) continue;
    const fd = readFileSync(p);
    if (fd[0] === 0xef && fd[1] === 0xbb && fd[2] === 0xbf) bad.push(f);
  }
  return bad.length ? `BOM in: ${bad.join(', ')}` : true;
});

// A4 — Chrome MV3 vs Firefox MV3, from one source manifest.
check('A4', 'chrome/firefox manifests are correctly derived from the root manifest', () => {
  if (!haveBuild) return 'no build output';
  const root = readJSON(join(ROOT, 'manifest.json'));
  const ff = readJSON(join(DIST, 'extension', 'firefox', 'manifest.json'));
  const ch = readJSON(join(DIST, 'extension', 'chrome', 'manifest.json'));
  const msgs = [];
  if (JSON.stringify(ff) !== JSON.stringify(root)) msgs.push('firefox manifest is not verbatim from root');
  if (!ch.background?.service_worker) msgs.push('chrome manifest has no background.service_worker');
  if (ch.background?.scripts) msgs.push('chrome manifest still has background.scripts');
  if (ch.browser_specific_settings) msgs.push('chrome manifest still has browser_specific_settings');
  return msgs.length ? msgs.join('; ') : true;
});

// A5 — three outputs, one version.
check('A5', 'all outputs report the same version', () => {
  if (!haveBuild) return 'no build output';
  const root = readJSON(join(ROOT, 'manifest.json')).version;
  const ch = readJSON(join(DIST, 'extension', 'chrome', 'manifest.json')).version;
  const ff = readJSON(join(DIST, 'extension', 'firefox', 'manifest.json')).version;
  const el = readJSON(join(EBUILD, 'meta.json')).version;
  const set = new Set([root, ch, ff, el]);
  return set.size === 1 ? true : `versions differ: ${[...set].join(', ')}`;
});

// A6 — the getURL images. A missing one is a silently broken menu icon.
check('A6', 'all getURL image assets are inlined as data: URIs', () => {
  if (!haveBuild) return 'no build output';
  const assets = readJSON(join(EBUILD, 'assets.json'));
  const required = [
    'images/download.svg', 'images/incognito_gray_24_hollow_9.svg',
    'images/computer.svg', 'images/phone.svg', 'images/incognito_gray.svg',
  ];
  const missing = required.filter((r) => !assets[r]);
  if (missing.length) return `missing: ${missing.join(', ')}`;
  const notData = required.filter((r) => !assets[r].startsWith('data:'));
  return notData.length ? `not data: URIs (CSP would refuse them): ${notData.join(', ')}` : true;
});

check('A6b', 'every chrome.runtime.getURL call site resolves to a real asset', () => {
  const src = readSrc(join(ROOT, 'core/ui.js')) + readSrc(join(ROOT, 'core/injected_ui.js'));
  const calls = [...src.matchAll(/getURL\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  const assets = existsSync(join(EBUILD, 'assets.json'))
    ? readJSON(join(EBUILD, 'assets.json')) : null;
  const unknown = calls.filter((c) => !existsSync(join(ROOT, c)) && !(assets && assets[c]));
  if (unknown.length) return `unresolvable getURL targets: ${unknown.join(', ')}`;
  return true;
});

// A-umd — the silent one. A UMD bundle that takes the AMD branch publishes nothing, and
// core/ then calls `pako.inflate(...)` / `new Drop(...)` as bare globals. Nothing throws
// at load time; the global is simply missing until the first message, at which point
// wsHook.before throws, the catch passes the frame through UNBLOCKED, and the watchdog
// still reports PROTECTED because the hook did arm.
//
// Each UMD vendor file is evaluated STANDALONE, wrapped exactly as the build wraps it, in
// a context carrying a global AMD `define` — which is what WhatsApp's webpack bundle
// installs in the app's single world. Deliberately not the whole emitted bundle: that
// pulls in libsignal, which needs WhatsApp's own dcodeIO/protobuf environment and would
// make this assertion fail for reasons that have nothing to do with what it checks.
check('A-umd', 'UMD vendor files publish their globals even when the page has an AMD define', () => {
  // `Pbf` is capital-P: pbf.js publishes `window.Pbf`, and that is what core/ actually
  // constructs (`new Pbf(...)`, 7 sites in multi_device.js). The generated protobuf files
  // also contain ~6800 references to a lowercase `pbf`, but only inside their `_decode`
  // helpers, which multi_device.js never reaches — it calls `Message.read(new Pbf(...))`.
  // So the lowercase name is latent upstream code, not a load-time requirement.
  const CASES = [
    { bundle: 'main-rest.js', file: 'lib/pako.js', expect: ['pako'] },
    { bundle: 'main-rest.js', file: 'lib/pbf.3.0.5.min.js', expect: ['Pbf'] },
    { bundle: 'ui.js', file: 'lib/drop.js', expect: ['Tether', 'Drop'] },
    { bundle: 'ui.js', file: 'lib/sweetalert.min.js', expect: ['swal'] },
  ];
  const GUARD_HEAD = 'var define=void 0, exports=void 0, module=void 0;';

  // Slice the ACTUAL emitted chunk for one source file out of the built bundle, so this
  // tests the artifact rather than re-applying the guard here. Re-wrapping inside the
  // test would pass even if the build stopped wrapping, which is the regression that
  // matters.
  function chunkOf(bundleFile, sourceFile) {
    const src = readSrc(join(EBUILD, bundleFile));
    const marker = `/* ---- ${sourceFile} ---- */`;
    const start = src.indexOf(marker);
    if (start === -1) return null;
    const from = start + marker.length;
    const nextMarker = src.indexOf('/* ---- ', from);
    // Trailing `\n;\n` is the banner's own separator, not part of the file.
    return src.slice(from, nextMarker === -1 ? undefined : nextMarker).replace(/\s*;\s*$/, '');
  }

  const el = () => ({
    style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, removeEventListener() {},
    getElementsByTagName: () => [], getElementsByClassName: () => [],
    querySelector: () => null, querySelectorAll: () => [],
    classList: { add() {}, remove() {}, contains: () => false },
  });

  const results = [];
  for (const { bundle, file, expect } of CASES) {
    const chunk = chunkOf(bundle, file);
    if (chunk === null) { results.push(`${file} not found in ${bundle}`); continue; }
    if (!chunk.includes(GUARD_HEAD)) {
      results.push(`${file} in ${bundle} has no UMD guard`);
      continue;
    }

    const sandbox = {
      console: { log() {}, warn() {}, error() {} },
      setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
      requestAnimationFrame() {}, cancelAnimationFrame() {},
      // Exactly the hazard: a global AMD define, plus CommonJS-flavoured globals.
      define: Object.assign(function () {}, { amd: true }),
      exports: {}, module: { exports: {} },
      document: {
        createElement: el, addEventListener() {}, removeEventListener() {},
        documentElement: el(), head: el(), body: el(),
        getElementsByTagName: () => [el()], createEvent: () => ({ initEvent() {} }),
      },
      navigator: { userAgent: 'test', platform: 'Linux' },
      location: { href: 'https://web.whatsapp.com/', protocol: 'https:' },
      screen: { width: 1920, height: 1080 },
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      TextDecoder, TextEncoder, Uint8Array, Int8Array, ArrayBuffer, DataView,
      Float32Array, Float64Array, Promise, Symbol, Map, Set, WeakMap, WeakSet, Proxy, Reflect,
      Math, JSON, Date, RegExp, Error, TypeError, RangeError, Array, Object, String, Number,
      Boolean, Function, performance, crypto: { subtle: {}, getRandomValues: (a) => a },
      atob: (s) => Buffer.from(s, 'base64').toString('binary'),
      btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
      Element: function () {}, HTMLElement: function () {}, Node: function () {},
      // `window` IS the sandbox object, so the bundles call window.addEventListener
      // directly rather than through `document`.
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    };
    sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;

    try {
      const ctx = vm.createContext(sandbox);
      new vm.Script(chunk, { filename: file });        // parse-only: SyntaxError surfaces here
      vm.runInContext(chunk, ctx, { filename: file, timeout: 5000 });
    } catch (e) {
      results.push(`${file} threw on load: ${String(e.message).slice(0, 90)}`);
      continue;
    }
    for (const name of expect) {
      if (sandbox[name] === undefined) {
        results.push(`${name} not published by ${file} — the UMD took the AMD/CommonJS branch`);
      }
    }
  }
  return results.length ? results.join('; ') : true;
});

// The wrapper is load-bearing, so assert it is actually present in the emitted output
// rather than trusting isUmdBundle() in the build to keep working.
check('A-umd2', 'UMD files in the emitted bundles carry the global-branch guard', () => {
  if (!haveBuild) return 'no build output';
  const GUARD = 'var define=void 0, exports=void 0, module=void 0;';
  const missing = ['main-rest.js', 'ui.js'].filter((f) => !readSrc(join(EBUILD, f)).includes(GUARD));
  return missing.length ? `no UMD guard in: ${missing.join(', ')}` : true;
});

check('A-shim', 'the page shim has no unsubstituted build placeholders', () => {
  const out = join(EBUILD, 'shim.js');
  if (!existsSync(out)) return 'shim.js not emitted (run `npm run build:electron`)';
  const s = readSrc(out);
  // Only these four are build tokens. __WAI_IPC__ and __WAI_NATIVE_WS__ are legitimate
  // runtime globals the preload provides, so a blanket /__WAI_[A-Z_]+__/ is wrong here.
  const tokens = ['__WAI_ASSETS__', '__WAI_PREFS__', '__WAI_VERSION__', '__WAI_ORDER__'];
  const left = tokens.filter((t) => s.includes(t));
  return left.length ? `unsubstituted: ${left.join(', ')}` : true;
});

// A-prefs — the Electron app must agree with the extension about every default. The
// values are derived from background.js at build time; this asserts the derivation
// produced all 9 keys and that the emitted shim/meta actually carry them.
check('A-prefs', 'option defaults are derived from background.js and reach the shim', () => {
  if (!haveBuild) return 'no build output';
  const src = readSrc(join(ROOT, 'background.js'));
  const g = src.slice(src.indexOf('getOptions'));
  const listMatch = g.match(/storage\.local\.get\(\s*\[([^\]]*)\]/);
  if (!listMatch) return 'could not read the key list from background.js';
  const keys = listMatch[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const expected = {};
  for (const k of keys) {
    const m = g.match(new RegExp(`var\\s+${k}\\s*=\\s*(true|false|-?\\d+)\\s*;`));
    if (!m) return `background.js has no literal default for "${k}"`;
    expected[k] = m[1] === 'true' ? true : m[1] === 'false' ? false : Number(m[1]);
  }
  if (keys.length !== 9) return `expected 9 option keys, background.js yields ${keys.length}`;

  const meta = readJSON(join(EBUILD, 'meta.json'));
  if (JSON.stringify(meta.prefs) !== JSON.stringify(expected)) {
    return `meta.json prefs disagree with background.js:\n      meta: ${JSON.stringify(meta.prefs)}\n      bg:   ${JSON.stringify(expected)}`;
  }
  const shim = readSrc(join(EBUILD, 'shim.js'));
  for (const [k, v] of Object.entries(expected)) {
    if (!shim.includes(`"${k}"`)) return `shim.js is missing option key "${k}"`;
    if (typeof v === 'boolean' && !shim.includes(`${k}: ${v}`) && !shim.includes(`"${k}": ${v}`)) {
      return `shim.js is missing the default for "${k}" (${v})`;
    }
  }
  return true;
});

// safetyDelay is clamped to 0-30 because ui.js:1119 only offers that range; a stored
// value outside it would otherwise be unrepresentable in the UI.
check('A-prefs2', 'safetyDelay default is within the 0-30 range ui.js offers', () => {
  if (!haveBuild) return 'no build output';
  const d = readJSON(join(EBUILD, 'meta.json')).prefs;
  if (typeof d.safetyDelay !== 'number') return `safetyDelay is ${typeof d.safetyDelay}, expected a number`;
  return (d.safetyDelay >= 0 && d.safetyDelay <= 30) ? true : `safetyDelay=${d.safetyDelay} is outside 0-30`;
});

// A18/A19/A20 — the packaged extension.
//
// The build only ever wrote UNPACKED directories, so the zip that anyone actually installs
// or submits to AMO used to exist only inside .github/workflows/release.yml. That left the
// artefact with no local coverage at all: nothing checked that the archive contained
// exactly the built files, that it carried the right browser's manifest, or that it was
// still byte-reproducible. All three are silent failures — a zip that is missing a file
// still installs, it just breaks one feature; a wrong-variant manifest fails to load at
// all, but only in the browser nobody tested.
//
// These are OPTIONAL-output assertions: `npm run verify` runs before anything is packaged,
// so a missing zip skips rather than fails. `pnpm check` packages first, and CI does too,
// which is what makes them load-bearing rather than decorative.

const EXT_OUT = join(ROOT, 'release', 'extensions');

/** The packaged zips, or [] when nothing has been packaged yet. */
function packagedZips() {
  if (!existsSync(EXT_OUT)) return [];
  return readdirSync(EXT_OUT)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => join(EXT_OUT, f));
}

const zips = packagedZips();
if (!zips.length) {
  console.log('  \x1b[33mnote\x1b[0m  no packaged extension found — A18/A19/A20 skipped.');
  console.log('        run `npm run package:ext` to produce and check them.');
} else {
  const zipEntries = (zip) =>
    execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
  const zipRead = (zip, entry) =>
    execFileSync('unzip', ['-p', zip, entry], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

  // A18 — the archive must contain exactly the built files. An earlier approach zipped the
  // repo root with `mv !(release|.github)`, which shipped app/, scripts/ and docs/ to every
  // user; this is the assertion that can never let that come back.
  check('A18', 'each packaged zip contains exactly its build directory', () => {
    const msgs = [];
    for (const zip of zips) {
      const browser = /-(chrome|firefox)\.zip$/.exec(zip)?.[1];
      if (!browser) { msgs.push(`${basename(zip)}: filename does not end in -chrome.zip or -firefox.zip`); continue; }
      const dir = join(DIST, 'extension', browser);
      if (!existsSync(dir)) { msgs.push(`${basename(zip)}: no build dir at ${relative(ROOT, dir)}`); continue; }
      const inZip = zipEntries(zip);
      const onDisk = [];
      const walk = (rel) => {
        for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
          const child = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(child);
          else if (e.isFile()) onDisk.push(child);
        }
      };
      walk('');
      onDisk.sort();
      const missing = onDisk.filter((f) => !inZip.includes(f));
      const extra = inZip.filter((f) => !onDisk.includes(f));
      if (missing.length) msgs.push(`${basename(zip)}: missing ${missing.join(', ')}`);
      if (extra.length) msgs.push(`${basename(zip)}: unexpected ${extra.join(', ')}`);
    }
    return msgs.length ? msgs.join('; ') : true;
  });

  // A19 — the manifest INSIDE the archive must be the right variant for that browser. A4
  // already checks the manifests in dist/; this checks the copy that actually ships, which
  // is a different file written by a different step.
  check('A19', 'the manifest inside each zip is the correct browser variant', () => {
    const root = readJSON(join(ROOT, 'manifest.json'));
    const msgs = [];
    for (const zip of zips) {
      const browser = /-(chrome|firefox)\.zip$/.exec(zip)?.[1];
      if (!browser) continue;
      let m;
      try { m = JSON.parse(zipRead(zip, 'manifest.json')); }
      catch (e) { msgs.push(`${basename(zip)}: manifest.json is unreadable (${e.message.split('\n')[0]})`); continue; }
      if (m.version !== root.version) {
        msgs.push(`${basename(zip)}: version ${m.version} != root ${root.version}`);
      }
      if (browser === 'firefox') {
        if (!m.background?.scripts) msgs.push(`${basename(zip)}: firefox zip has no background.scripts`);
        if (!m.browser_specific_settings?.gecko?.id) msgs.push(`${basename(zip)}: firefox zip has no gecko add-on id`);
      } else {
        if (!m.background?.service_worker) msgs.push(`${basename(zip)}: chrome zip has no background.service_worker`);
        if (m.background?.scripts) msgs.push(`${basename(zip)}: chrome zip still has background.scripts`);
        if (m.browser_specific_settings) msgs.push(`${basename(zip)}: chrome zip still has browser_specific_settings`);
      }
    }
    return msgs.length ? msgs.join('; ') : true;
  });

  // A20 — the README promises "the same commit always produces the same bytes, so you can
  // tell a real change from noise by comparing checksums". That claim is only worth
  // anything if it is tested, because every plausible regression here (a forgotten mtime
  // normalisation, a locale-sensitive sort, a dropped -X) makes two builds of the SAME
  // commit differ while looking perfectly healthy.
  //
  // The subtle part: packing the same tree twice in a row is NOT a test of this. Nothing
  // rewrites the files in between, so the mtimes are unchanged and the archives agree even
  // with normalisation removed entirely — an earlier version of this assertion passed
  // against a deliberately broken packer. The property that actually matters is
  // reproducibility ACROSS a rebuild, so each round deliberately stamps the build
  // directory with a different mtime first. That is what a rebuild does, and it is exactly
  // what the normalisation has to paper over.
  check('A20', 'rebuilding and repacking the same commit produces identical bytes', () => {
    const msgs = [];
    const tmp = mkdtempSync(join(tmpdir(), 'wai-a20-'));
    const pack = (browser, out) => {
      execFileSync('node', [join(ROOT, 'scripts', 'package-ext.mjs'),
        `--browser=${browser}`, `--out=${out}`], { cwd: ROOT, stdio: 'pipe' });
      return createHash('sha256').update(readFileSync(out)).digest('hex');
    };
    // Walk the build dir the same way the build writes it.
    const stamp = (dir, when) => {
      const walk = (rel) => {
        for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
          const child = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(child);
          else if (e.isFile()) {
            execFileSync('touch', ['-d', when, join(dir, child)]);
          }
        }
      };
      walk('');
    };
    try {
      for (const browser of ['chrome', 'firefox']) {
        const dir = join(DIST, 'extension', browser);
        if (!existsSync(join(dir, 'manifest.json'))) { msgs.push(`no build output for ${browser}`); continue; }

        stamp(dir, '2021-03-04T05:06:07Z');
        const first = pack(browser, join(tmp, `${browser}-1.zip`));
        // A different mtime for every file, well away from the first round: this is what a
        // rebuild on another machine, or on another day, looks like.
        stamp(dir, '2026-09-27T18:30:00Z');
        const second = pack(browser, join(tmp, `${browser}-2.zip`));

        if (first !== second) {
          msgs.push(`${browser}: ${first.slice(0, 12)} != ${second.slice(0, 12)} ` +
            '(mtimes are not being normalised, so the checksum tracks build time)');
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    return msgs.length ? msgs.join('; ') : true;
  });
}

// ---------------------------------------------------------------- report

const width = Math.max(...results.map((r) => r[2].length));
console.log('');
for (const [status, id, desc] of results) {
  const mark = status === 'PASS' ? '\x1b[32m ok \x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  [${mark}] ${id.padEnd(6)} ${desc}`);
}
console.log(`\n  ${passes} passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
