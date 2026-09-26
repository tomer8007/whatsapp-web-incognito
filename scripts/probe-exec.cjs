'use strict';
// Minimal executeJavaScript sanity check, to find out why the probe returned undefined
// properties: is it the code string, the page, or the IPC?
//
//   npx electron scripts/probe-exec.cjs

const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');
console.log('probe: electron up, argv switches applied');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });

  // 1. A trivial expression, before any navigation.
  try {
    const r = await win.webContents.executeJavaScript('1 + 1');
    console.log(`trivial on blank page      -> ${JSON.stringify(r)}`);
  } catch (e) {
    console.log(`trivial on blank page      -> THREW: ${e.message}`);
  }

  // 2. After navigation to a data: URL, so no network is involved.
  await win.loadURL('data:text/html,<title>probe</title><body><p id=x>hello</p>');
  for (const [label, code] of [
    ['string literal', '"hello"'],
    ['object literal', '({a:1,b:"two"})'],
    ['IIFE', '(() => ({a:1}))()'],
    ['document.title', 'document.title'],
    ['IIFE reading DOM', '(() => ({t: document.title, txt: document.body.innerText.trim()}))()'],
  ]) {
    try {
      const r = await win.webContents.executeJavaScript(code);
      console.log(`${label.padEnd(24)} -> ${JSON.stringify(r)}`);
    } catch (e) {
      console.log(`${label.padEnd(24)} -> THREW: ${e.message}`);
    }
  }

  // 3. Now the real thing, with a shorter wait so this stays quick.
  console.log('\n--- loading web.whatsapp.com ---');
  const failures = [];
  win.webContents.on('did-fail-load', (_e, code, desc, url) => failures.push({ code, desc, url }));
  const consoleLines = [];
  win.webContents.on('console-message', (e) => {
    // Electron 44 passes an event object with a `message` field.
    const m = (e && e.message) || String(e);
    if (!/DevTools|Autofill/i.test(m)) consoleLines.push(m.slice(0, 200));
  });

  // Do NOT await: WhatsApp never fires did-finish-load promptly, so awaiting hangs
  // until the process is killed. This is also why app/electron/main.js calls loadURL
  // without awaiting it.
  win.loadURL('https://web.whatsapp.com/').catch((e) => console.log(`loadURL rejected: ${e.message}`));

  await new Promise((r) => setTimeout(r, 8000));

  console.log(`did-fail-load events: ${failures.length ? JSON.stringify(failures) : 'none'}`);
  console.log(`url now: ${win.webContents.getURL()}`);

  for (const [label, code] of [
    ['readyState', 'document.readyState'],
    ['title', 'document.title'],
    ['navigator.userAgent', 'navigator.userAgent'],
    ['body length', '(document.body && document.body.innerText || "").length'],
    ['body head', '((document.body && document.body.innerText || "").trim().slice(0,300))'],
  ]) {
    try {
      const r = await win.webContents.executeJavaScript(code);
      console.log(`${label.padEnd(24)} -> ${JSON.stringify(r)}`);
    } catch (e) {
      console.log(`${label.padEnd(24)} -> THREW: ${e.message}`);
    }
  }

  if (consoleLines.length) {
    console.log('\n--- page console (first 12) ---');
    for (const l of consoleLines.slice(0, 12)) console.log(`  | ${l}`);
  }

  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });
