'use strict';
// Diagnostic probe: load web.whatsapp.com and report exactly what comes back.
//
// Exists because "it's not working" is not a diagnosis. This prints the facts that
// distinguish the failure modes we actually hit:
//
//   - a browser-gate page ("works with Chrome 100+", "update your browser")
//   - a version gate, which looks identical to the above but has a different cause
//   - a blank/spinner page, i.e. the bundle loaded but the app rejected the session
//   - a login prompt, i.e. everything is fine and you are simply logged out
//
// It also prints the user agent the PAGE sees, which is the only way to confirm the UA
// rewrite actually took effect — a UA set on the session but not visible to
// navigator.userAgent would explain a gate that should have been passed.
//
//   npx electron scripts/probe-whatsapp.cjs
//
// Read-only: no prefs are touched and nothing is injected.

const { app, BrowserWindow, session } = require('electron');

const URL_TO_TEST = process.env.WAI_PROBE_URL || 'https://web.whatsapp.com/';
const WAIT_MS = Number(process.env.WAI_PROBE_WAIT || 20000);

const out = (k, v) => console.log(`  ${String(k).padEnd(22)} ${v}`);

app.commandLine.appendSwitch('disable-gpu');   // probe only; not a product setting

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  const stock = ses.getUserAgent();

  // Reuse the app's own rewrite so the probe reflects reality.
  let ua = stock;
  try {
    const { buildChromeUserAgent } = require('../app/electron/user-agent.js');
    const { appName, appVersion } = require('../package.json');
    const clean = buildChromeUserAgent(stock, {
      appName, appVersion,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
    });
    if (clean) ua = clean;
  } catch (e) {
    console.log(`  (UA rewrite failed: ${e.message})`);
  }
  ses.setUserAgent(ua);

  console.log('\n=== environment ===');
  out('electron', process.versions.electron);
  out('chromium', process.versions.chrome);
  out('node', process.versions.node);
  out('v8', process.versions.v8);

  console.log('\n=== user agent ===');
  out('stock', stock);
  out('sent to page', ua);

  const win = new BrowserWindow({
    show: false,
    width: 1280, height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });

  const failed = [];
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    failed.push({ code, desc, url });
  });

  let finalUrl = null;
  win.webContents.on('did-navigate', (_e, url) => { finalUrl = url; });
  win.webContents.on('did-navigate-in-page', (_e, url) => { finalUrl = url; });

  try {
    await win.loadURL(URL_TO_TEST);
  } catch (e) {
    console.log(`\nloadURL threw: ${e.message}`);
  }

  // Give the SPA time to either boot or show a gate.
  await new Promise((r) => setTimeout(r, WAIT_MS));

  let probe = {};
  try {
    probe = await win.webContents.executeJavaScript(`(() => {
      const text = (document.body && document.body.innerText || '').trim();
      return {
        readyState: document.readyState,
        title: document.title,
        href: location.href,
        ua: navigator.userAgent,
        // A short, low-signal fingerprint of what actually rendered.
        textLen: text.length,
        head: text.slice(0, 400),
        hasCanvas: typeof document.createElement('canvas').getContext === 'function',
        // WhatsApp's own markers.
        hasWag-root: !!document.querySelector('#app, [data-animate-role], #webpack'),
        hasLogin: /phone number|Log in|Verify your phone/i.test(text),
        hasGate: /Chrome|Chrome 100|update your browser|supported browser|not supported/i.test(text),
        hasQr: !!document.querySelector('canvas'),
        scriptCount: document.scripts.length,
        // Did the CSP block our own injection attempts? (informational)
        csp: (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || null,
      };
    })()`);
  } catch (e) {
    probe = { error: (e && e.message) || String(e) };
    console.log(`\n  !! executeJavaScript failed: ${probe.error}`);
  }

  console.log('\n=== what came back ===');
  out('readyState', probe.readyState);
  out('final url', probe.href || finalUrl);
  out('title', JSON.stringify(probe.title));
  out('navigator.userAgent', probe.ua);
  out('visible text', `${probe.textLen} chars`);
  out('scripts', probe.scriptCount);

  console.log('\n=== classification ===');
  if (failed.length) console.log('  LOAD FAILED:', JSON.stringify(failed));
  if (probe.hasGate) console.log('  -> BROWSER GATE: WhatsApp is refusing this client. See "visible text" above.');
  else if (probe.hasLogin) console.log('  -> LOGIN PROMPT: the app loaded. You are simply logged out.');
  else if (probe.textLen < 50) console.log('  -> BLANK: the bundle loaded but rendered nothing.');
  else console.log('  -> UNKNOWN: inspect "visible text".');

  console.log('\n=== visible text (first 400 chars) ===');
  console.log((probe.head || '(none)').split('\n').map((l) => `  | ${l}`).join('\n'));

  app.exit(0);
}).catch((e) => {
  console.error('probe failed:', e && e.stack || e);
  app.exit(1);
});
