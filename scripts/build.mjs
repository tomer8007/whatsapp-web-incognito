#!/usr/bin/env node
// Manifest-driven builder for all three distribution targets.
//
//   chrome    dist/extension/chrome     MV3 with background.service_worker
//   firefox   dist/extension/firefox    upstream manifest verbatim
//   electron  app/.build/               bundles + inlined assets for the shell
//
// The file list is DERIVED FROM manifest.json rather than hardcoded, so an upstream
// release that adds or removes a file propagates to every target automatically and
// nothing can silently drift. manifest.json is never rewritten, which is what keeps
// `git merge upstream/master` clean (docs/ELECTRON_APP_PLAN.md §1).
//
// Usage:
//   node scripts/build.mjs                     all targets
//   node scripts/build.mjs --target=chrome
//   node scripts/build.mjs --target=extension  chrome + firefox
//   node scripts/build.mjs --lazy              enable §8.1 deferred loading (opt-in)
//   node scripts/build.mjs --clean

import {
  readFileSync, writeFileSync, mkdirSync, rmSync, cpSync,
  existsSync, statSync, readdirSync,
} from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const EBUILD = join(ROOT, 'app', '.build');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];

// ---------------------------------------------------------------- bundle definition
// Load order mirrors core_injection.js exactly. If upstream changes the chain, the
// missing-file assertion below fails loudly rather than emitting a broken bundle.
//
// MAIN_CRITICAL is the only file with a hard deadline: it must replace the WebSocket
// constructor before WhatsApp opens its first socket (C1). Everything else in the main
// group is first touched when a message arrives, which is what makes §8.1 possible.
const MAIN_CRITICAL = ['core/ws_hook.js'];

const MAIN_REST = [
  'lib/pbf.3.0.5.min.js',
  'lib/libsignal-protocol-ee5b8ba.min.js',
  'lib/pako.js',
  'core/parsing/binary_reader.js',
  'core/parsing/binary_writer.js',
  'core/parsing/node_reader_writer.js',
  'core/parsing/protobuf/WhisperTextProtocol.js',
  'core/parsing/protobuf/WAProto.js',
  'core/utils.js',
  'core/ui_class_names.js',
  'core/injected_ui.js',
  'core/multi_device.js',
  'core/node_handler.js',
  'core/interception.js',
];

// moduleRaid scans WhatsApp's webpack module registry, which does not exist until the
// page bundle has run. Upstream defers it with setTimeout(10) for the same reason.
const DEFERRED = ['lib/moduleraid.js'];

// Replaces the two document_idle content scripts. ui_class_names is repeated on purpose:
// it is idempotent (var + IIFE) and this keeps the group mirroring the manifest.
const UI = [
  'core/ui_class_names.js',
  'core/ui.js',
  'core/status_download.js',
  'lib/drop.js',
  'lib/sweetalert.min.js',
];

const CSS = ['styles.css', 'lib/css/drop-theme-basic.css'];

// The 4 getURL images, plus incognito_gray.svg which styles.css references.
const IMAGE_ASSETS = [
  'images/download.svg',
  'images/incognito_gray_24_hollow_9.svg',
  'images/computer.svg',
  'images/phone.svg',
  'images/incognito_gray.svg',
];

// ---------------------------------------------------------------- prefs
// The single source of truth for option defaults is background.js's getOptions
// handler — the extension's own background page. Deriving them here rather than
// hardcoding means the Electron app and the extension can never disagree about what
// "default" means, and an upstream change to those defaults fails the build loudly
// (assertion A-prefs) instead of silently changing behaviour in one target only.
function deriveDefaults() {
  const src = readSource(join(ROOT, 'background.js'));
  const getOptions = src.slice(src.indexOf('getOptions'));
  if (getOptions === src) throw new Error('background.js has no getOptions handler');

  // The key list is the argument to chrome.storage.local.get([...]).
  const listMatch = getOptions.match(/storage\.local\.get\(\s*\[([^\]]*)\]/);
  if (!listMatch) throw new Error('could not find the storage.local.get([...]) key list in background.js');
  const keys = listMatch[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

  // Defaults are the `var <key> = <literal>;` lines inside the handler.
  const defaults = {};
  for (const k of keys) {
    const m = getOptions.match(new RegExp(`var\\s+${k}\\s*=\\s*(true|false|-?\\d+)\\s*;`));
    if (!m) throw new Error(`background.js declares no literal default for "${k}"`);
    defaults[k] = m[1] === 'true' ? true : m[1] === 'false' ? false : Number(m[1]);
  }
  if (!keys.length) throw new Error('background.js yielded an empty option key list');
  return defaults;
}

const DEFAULT_PREFS = deriveDefaults();

// ---------------------------------------------------------------- helpers

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Strip a UTF-8 BOM. Harmless mid-script, but not something to rely on at a seam. */
function readSource(p) {
  let s = readFileSync(p, 'utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

function human(b) {
  return b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else total += statSync(p).size;
    }
  };
  if (existsSync(dir)) walk(dir);
  return total;
}

/** Expand a manifest reference that may be glob-ish, e.g. "lib/*". */
function expand(ref) {
  if (!ref.includes('*')) return [ref];
  const dir = ref.slice(0, ref.indexOf('*')).replace(/[/\\][^/\\]*$/, '');
  const abs = join(ROOT, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => `${dir}/${e.name}`);
}

/** Every file the manifest declares, deduped, stable order. */
function collectFiles(manifest) {
  const refs = new Set();

  for (const s of manifest.content_scripts ?? []) {
    (s.js ?? []).forEach((f) => refs.add(f));
    (s.css ?? []).forEach((f) => refs.add(f));
  }
  for (const war of manifest.web_accessible_resources ?? []) {
    (war.resources ?? []).forEach((r) => expand(r).forEach((f) => refs.add(f)));
  }
  Object.values(manifest.icons ?? {}).forEach((f) => refs.add(f));
  if (manifest.action?.default_icon) refs.add(manifest.action.default_icon);

  const bg = manifest.background ?? {};
  for (const f of [...(bg.scripts ?? []), bg.service_worker].filter(Boolean)) refs.add(f);

  // The injection chain lives in web_accessible_resources today; assert it explicitly
  // so a manifest change upstream cannot silently drop part of the bundle.
  for (const f of [...MAIN_CRITICAL, ...MAIN_REST, ...DEFERRED, ...UI, ...CSS]) refs.add(f);

  return [...refs].filter((f) => existsSync(join(ROOT, f))).sort();
}

function assertFilesExist(files, label) {
  const missing = files.filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    throw new Error(
      `${label}: ${missing.length} referenced file(s) missing from the repo:\n  ` +
      missing.join('\n  ') +
      '\n\nThis usually means an upstream release renamed or removed a file that the\n' +
      'injection chain depends on. Update the bundle order in scripts/build.mjs.'
    );
  }
}

function copyInto(files, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const f of files) {
    const dest = join(destDir, f);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(ROOT, f), dest);
  }
}

/**
 * Does this file ship a UMD/CommonJS/AMD wrapper?
 *
 * This matters far more in the Electron app than in the extension, and the reason is a
 * direct consequence of having only ONE JS world instead of two (§2.2).
 *
 * `lib/drop.js`, `lib/pako.js`, `lib/pbf.3.0.5.min.js` and `lib/sweetalert.min.js` all
 * pick their export style at load time:
 *
 *     if (typeof define === 'function' && define.amd)  define(factory);        // AMD
 *     else if (typeof exports === 'object')            module.exports = ...;    // CommonJS
 *     else                                              root.Tether = factory();// browser global
 *
 * In the extension, the manifest's second content script (which includes drop.js) runs
 * in the ISOLATED content-script world, where WhatsApp's globals do not exist — so
 * `define` is undefined and the browser-global branch is taken, publishing `Tether` and
 * `Drop` where core/ui.js can see them.
 *
 * In the app there is one world: the page's. WhatsApp's webpack bundle installs a global
 * AMD `define`, so the very same files take the AMD branch and publish NOTHING. Observed
 * directly: `Uncaught ReferenceError: Tether is not defined`.
 *
 * That is not cosmetic. core/ calls `pako.inflate(...)` as a bare global in three places
 * (utils.js:442, multi_device.js:118, interception.js:751) and `new Drop(...)` in
 * ui.js:156. With `pako` undefined, every compressed frame throws inside
 * wsHook.before, the catch passes the frame straight through UNBLOCKED, and the watchdog
 * still reports PROTECTED because the hook did arm. Silent receipt leak — the exact
 * failure mode this project exists to prevent.
 *
 * `pako` is also the worst possible victim because nothing throws at load time: the
 * global is simply absent until the first message arrives.
 */
function isUmdBundle(rel) {
  const head = readSource(join(ROOT, rel)).slice(0, 600);
  return /define\s*\.\s*amd|typeof\s+exports\s*===?\s*['"]object['"]|typeof\s+module\s*===?\s*['"]object['"]/.test(head);
}

/**
 * Force the browser-global branch.
 *
 * The three identifiers are declared as function-scoped vars, which shadows the page's
 * globals for the whole file without mutating them. That is deliberate: assigning
 * `window.define = undefined` would be undone by any non-writable or accessor property,
 * and would also be visible to code running concurrently. A local shadow cannot fail.
 *
 * The IIFE is intentionally NOT strict and is invoked with no receiver, so top-level
 * `this` inside the wrapped file is still the global object — which is what the UMD
 * wrapper passes to the factory as `root`.
 */
function wrapUmd(src) {
  return (
    ';(function(){' +
    'var define=void 0, exports=void 0, module=void 0;' +
    src +
    '\n})();'
  );
}

const banner = (list) =>
  list.map((f) => {
    const src = readSource(join(ROOT, f));
    const body = isUmdBundle(f) ? wrapUmd(src) : src;
    return `/* ---- ${f} ---- */\n${body}`;
  }).join('\n;\n');

/**
 * Inline CSS as one <style>. C4: the page CSP refuses shell-owned schemes but allows
 * 'unsafe-inline' for style-src.
 *
 * This is injected at document_start, where `document.head` AND `document.documentElement`
 * are both still null — the parser has not created the root element yet. The naive
 * `(document.head||document.documentElement).appendChild(...)` used by
 * core_injection.js is safe there only because the extension's stylesheets are declared
 * in the manifest and applied by the browser rather than by script. Injecting them by
 * hand at document_start throws "Cannot read properties of null (reading 'appendChild')"
 * and the UI silently renders unstyled.
 *
 * So: append immediately if there is a root to append to, otherwise poll briefly until
 * one exists. Either way the <style> lands; a late arrival only costs a repaint.
 */
function cssInjector(cssFiles) {
  const combined = cssFiles
    .map((f) => `/* ${f} */\n${readSource(join(ROOT, f))}`)
    .join('\n');
  return (
    "(function(){" +
    "var css=" + JSON.stringify(combined) + ";" +
    "function inject(){" +
      "var root=document.head||document.documentElement;" +
      "if(!root) return false;" +
      "var s=document.createElement('style');" +
      "s.setAttribute('data-wai','1');" +
      "s.textContent=css;" +
      "root.appendChild(s);" +
      "return true;" +
    "}" +
    "if(inject()) return;" +
    "var tries=0;" +
    "(function wait(){" +
      "if(inject()) return;" +
      "if(++tries>600) return;" +
      "setTimeout(wait,100);" +
    "})();" +
    "})();"
  );
}

// ---------------------------------------------------------------- extension targets

/** Firefox: the upstream manifest, byte-for-byte semantics. */
function buildFirefox(manifest, files) {
  const out = join(DIST, 'extension', 'firefox');
  rmSync(out, { recursive: true, force: true });
  copyInto(files, out);
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`  firefox    ${relative(ROOT, out)}  (${human(dirSize(out))}, ${files.length} files)`);
}

/** Chrome MV3 rejects background.scripts (C6) and rejects browser_specific_settings. */
function buildChrome(manifest, files) {
  const out = join(DIST, 'extension', 'chrome');
  rmSync(out, { recursive: true, force: true });
  copyInto(files, out);

  const m = structuredClone(manifest);
  const bg = m.background ?? {};
  m.background = { service_worker: bg.service_worker ?? bg.scripts?.[0] ?? 'background.js' };
  delete m.browser_specific_settings;

  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
  console.log(`  chrome     ${relative(ROOT, out)}  (${human(dirSize(out))}, ${files.length} files)`);
}

// ---------------------------------------------------------------- electron target

function buildElectron(manifest, files) {
  assertFilesExist([...MAIN_CRITICAL, ...MAIN_REST, ...DEFERRED, ...UI, ...CSS], 'electron');

  rmSync(EBUILD, { recursive: true, force: true });
  mkdirSync(EBUILD, { recursive: true });

  // The three (or four, with --lazy) bundles are SEPARATE FILES and are injected as
  // separate webFrame.executeJavaScript calls. C3/A1: collapsing main and ui into one
  // script would be survivable only because patch P1 removed the `initialize`
  // collision, but separate files also preserve the ordering guarantee that the single
  // shared UIClassNames exists before ui.js reads it. Do not "simplify" this.
  const critical = banner(MAIN_CRITICAL);
  const rest = banner(MAIN_REST);
  const ui = banner(UI);
  const deferred = banner(DEFERRED);

  writeFileSync(join(EBUILD, 'critical.js'), critical);
  writeFileSync(join(EBUILD, 'main-rest.js'), rest);
  writeFileSync(join(EBUILD, 'ui.js'), ui);
  writeFileSync(join(EBUILD, 'deferred.js'), deferred);
  writeFileSync(join(EBUILD, 'styles.js'), cssInjector(CSS));

  // C4: images inline as data: URIs. A missing one is a silently broken menu icon, so
  // this throws rather than degrading.
  const assets = {};
  const missingAssets = [];
  for (const rel of IMAGE_ASSETS) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) { missingAssets.push(rel); continue; }
    const ext = extname(rel);
    const mime = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
    assets[rel] = `data:${mime};base64,${readFileSync(abs).toString('base64')}`;
  }
  if (missingAssets.length) {
    throw new Error(
      `electron: image assets missing, the options menu would render broken icons:\n  ` +
      missingAssets.join('\n  ')
    );
  }
  writeFileSync(join(EBUILD, 'assets.json'), JSON.stringify(assets, null, 2));

  // Page-world shim. The build-time literals are substituted here so the page can
  // answer getOptions synchronously (C4 — a round-trip to the main process would race
  // ui.js:23) and resolve getURL to data: URIs with no network access at all.
  // This is the only file carrying placeholders; assertion A-shim fails the build if
  // any survive.
  const shimSrc = readSource(join(ROOT, 'app', 'electron', 'shim.js'));
  const shimOut = shimSrc
    .replace('__WAI_ASSETS__', JSON.stringify(assets, null, 2))
    .replace('__WAI_PREFS__', JSON.stringify(DEFAULT_PREFS, null, 2))
    .replace('__WAI_VERSION__', JSON.stringify(manifest.version))
    .replace('__WAI_ORDER__', JSON.stringify({
      critical: MAIN_CRITICAL, rest: MAIN_REST, ui: UI, deferred: DEFERRED, css: CSS,
    }, null, 2));
  // Only these four tokens are build placeholders. `__WAI_IPC__` and
  // `__WAI_NATIVE_WS__` are legitimate runtime globals supplied by the preload, so a
  // blanket /__WAI_[A-Z_]+__/ test would wrongly flag them as unsubstituted.
  const BUILD_TOKENS = ['__WAI_ASSETS__', '__WAI_PREFS__', '__WAI_VERSION__', '__WAI_ORDER__'];
  const left = BUILD_TOKENS.filter((t) => shimOut.includes(t));
  if (left.length) {
    throw new Error(`electron: unsubstituted build placeholder(s) in shim.js: ${left.join(', ')}`);
  }
  writeFileSync(join(EBUILD, 'shim.js'), shimOut);

  // Ship the manifest-derived file list so CI can build an explicit allowlist instead
  // of `mv !(release|.github)`, which would leak app/ and scripts/ into the zip.
  writeFileSync(join(EBUILD, 'ext-files.json'), `${JSON.stringify(files, null, 2)}\n`);

  const meta = {
    version: manifest.version,
    generatedFrom: 'scripts/build.mjs',
    lazyInjection: flag('lazy'),
    order: { critical: MAIN_CRITICAL, rest: MAIN_REST, ui: UI, deferred: DEFERRED, css: CSS },
    images: IMAGE_ASSETS,
    prefs: DEFAULT_PREFS,
    bytes: {
      critical: Buffer.byteLength(critical),
      rest: Buffer.byteLength(rest),
      ui: Buffer.byteLength(ui),
      deferred: Buffer.byteLength(deferred),
    },
    whatsapp: 'https://web.whatsapp.com/',
  };
  writeFileSync(join(EBUILD, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

  const b = meta.bytes;
  const total = b.critical + b.rest + b.ui + b.deferred;
  console.log(`  electron   ${relative(ROOT, EBUILD)}  (${human(dirSize(EBUILD))})`);
  console.log(`              critical ${human(b.critical)}  rest ${human(b.rest)}  ui ${human(b.ui)}  deferred ${human(b.deferred)}  = ${human(total)}`);
  if (!flag('lazy')) {
    // With --lazy, only `critical` loads at document_start; rest+ui+deferred are pulled
    // in on first use. That deferred share is what §8.1 is claiming.
    const totalJs = b.critical + b.rest + b.ui + b.deferred;
    const deferredShare = totalJs ? ((totalJs - b.critical) / totalJs) * 100 : 0;
    console.log(
      `              note: --lazy would defer ${human(b.rest + b.ui + b.deferred)} ` +
      `(${deferredShare.toFixed(1)}% of the JS payload) past document_start`
    );
  }
}

function extname(p) {
  const i = p.lastIndexOf('.');
  return i === -1 ? '' : p.slice(i);
}

// ---------------------------------------------------------------- cli

const manifest = readJSON(join(ROOT, 'manifest.json'));
const files = collectFiles(manifest);

if (flag('clean')) {
  rmSync(DIST, { recursive: true, force: true });
  rmSync(EBUILD, { recursive: true, force: true });
  console.log('removed dist/ and app/.build/');
  process.exit(0);
}

const target = opt('target');
const targets = target === 'extension' ? ['firefox', 'chrome'] : [target ?? 'firefox', target ? null : 'chrome', target ? null : 'electron'].filter(Boolean);

console.log(`WAIncognito build  version ${manifest.version}  ${files.length} manifest files\n`);
if (flag('lazy')) console.log('  (§8.1 lazy injection ENABLED: only ws_hook.js loads at document_start)\n');

for (const t of targets) {
  if (t === 'firefox') buildFirefox(manifest, files);
  else if (t === 'chrome') buildChrome(manifest, files);
  else if (t === 'electron') buildElectron(manifest, files);
  else throw new Error(`Unknown target "${t}". Use firefox, chrome, electron, or extension.`);
}

console.log('\nLoad unpacked:  Chrome -> dist/extension/chrome    Firefox -> dist/extension/firefox');
console.log('Run the app:    npm start          (needs `npm run build:electron` first)');
console.log('Verify:         npm run verify');
