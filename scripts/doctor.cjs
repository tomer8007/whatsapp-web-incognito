'use strict';
// Minimal, fast probe of the real page. Prints facts, not guesses.
//
//   npx electron --no-sandbox scripts/probe-quick.cjs
//
// Deliberately tiny. Two things cost time when this was first written:
//   - `await loadURL(...)` HANGS, because WhatsApp never fires did-finish-load
//     promptly. Fire-and-forget, then wait. (app/electron/main.js already does this.)
//   - extra commandLine switches and extra windows add failure modes with no diagnostic
//     value. This file does the minimum.

const { app, BrowserWindow, session } = require('electron');

const TARGET = 'https://web.whatsapp.com/';
const WAIT = Number(process.env.WAI_PROBE_WAIT || 9000);

// `--version` makes this usable as a plain "what engine is installed?" query, which is
// what scripts/one.mjs needs. Electron has no `-e`, so the version has to come from a real
// script run; folding it in here avoids a second throwaway file.
if (process.argv.includes('--version')) {
  console.log(JSON.stringify({
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
  }));
  app.exit(0);
  return;
}

const line = (k, v) => console.log(`  ${k.padEnd(20)} ${v}`);


app.whenReady().then(async () => {
  if (process.argv.includes('--version')) {
    console.log(JSON.stringify({
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
    }));
    app.exit(0);
  }
  const ses = session.defaultSession;

  // Use the app's own rewrite so this reflects reality.
  const stock = ses.getUserAgent();
  let ua = stock;
  try {
    const { buildChromeUserAgent } = require('../app/electron/user-agent.js');
    const pkg = require('../package.json');
    ua = buildChromeUserAgent(stock, {
      appName: pkg.productName || pkg.name,
      appVersion: pkg.version,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
    }) || stock;
  } catch (e) { console.log(`  (UA rewrite failed: ${e.message})`); }
  ses.setUserAgent(ua);

  console.log('\n== env ==');
  line('electron', process.versions.electron);
  line('chromium', process.versions.chrome);
  console.log('\n== ua ==');
  line('stock', stock);
  line('sending', ua);

  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });

  const fails = [];
  win.webContents.on('did-fail-load', (_e, code, desc, url) => fails.push(`${code} ${desc} ${url}`));

  win.loadURL(TARGET).catch((e) => console.log(`  loadURL rejected: ${e.message}`));
  await new Promise((r) => setTimeout(r, WAIT));

  const q = (code) => win.webContents.executeJavaScript(code).catch((e) => `<threw: ${e.message}>`);

  console.log('\n== page ==');
  line('url', await q('location.href'));
  line('readyState', await q('document.readyState'));
  line('title', JSON.stringify(await q('document.title')));
  line('page sees UA', await q('navigator.userAgent'));
  line('scripts', await q('document.scripts.length'));
  const text = String(await q('((document.body&&document.body.innerText)||"").trim()'));
  line('text length', text.length);
  line('did-fail-load', fails.length ? fails.join(' | ') : 'none');

  console.log('\n== verdict ==');
  if (/log in|phone number|verify your phone|qr code/i.test(text)) {
    console.log('  OK — the app loaded and is asking you to log in.');
  } else if (/chrome|update your browser|not supported|supported browser|too old/i.test(text)) {
    console.log('  GATED — WhatsApp is refusing this client. Text above says which gate.');
  } else if (text.length < 40) {
    console.log('  BLANK — the bundle loaded but rendered nothing. Look at scripts count.');
  } else {
    console.log('  UNKNOWN — read the text dump.');
  }

  console.log('\n== visible text ==');
  console.log(text.slice(0, 500).split('\n').map((l) => `  | ${l}`).join('\n') || '  (empty)');

  app.exit(0);
}).catch((e) => { console.error('probe crashed:', e && e.stack || e); app.exit(1); });
