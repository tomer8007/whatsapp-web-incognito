#!/usr/bin/env node
// P7: make hookLogs()'s WALogger installation defensive, and fix the DEV/LOG
// copy-paste bug.
//
// Why (both observed at runtime):
//   a) `require("WALogger")` returns null until WhatsApp's webpack bundle registers that
//      module. Upstream ran the install once, 2s after injection, with no guard, so it
//      threw "Cannot read properties of null (reading 'LOG')" on every launch — an
//      uncaught error in a setTimeout, which then also tripped the
//      window.onunhandledrejection hook installed just above.
//   b) `originalWALoggerDev = require("WALogger").LOG` should have been `.DEV`, so
//      hookedWALoggerDev invoked the log function's original with DEV arguments.
//
// Idempotent: refuses to run twice.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'core', 'interception.js');

const src = readFileSync(FILE, 'utf8');

if (src.includes('function installWALoggerHooks')) {
  console.log('P7 already applied; nothing to do.');
  process.exit(0);
}

const lines = src.split('\n');
const start = lines.findIndex((l) => l.trim() === 'setTimeout(() => {');
if (start === -1) { console.error('could not find the setTimeout(() => { opening the WALogger install'); process.exit(1); }

// Find the matching close: the line that is exactly "    }, 2000);"
let end = -1;
for (let i = start; i < lines.length; i++) {
  if (/^\s*\}, 2000\);\s*$/.test(lines[i])) { end = i; break; }
}
if (end === -1) { console.error('could not find the closing "}, 2000);"'); process.exit(1); }

const REPLACEMENT = `    // P7: upstream ran this once, 2s after injection, with no guard at all. Two bugs:
    //
    //  a) \`require("WALogger")\` returns null until WhatsApp's webpack bundle has
    //     registered that module, so 2s after document_start this threw
    //     "Cannot read properties of null (reading 'LOG')" on every single launch — an
    //     uncaught error inside a setTimeout, which then also surfaced through the
    //     window.onunhandledrejection hook installed just above.
    //  b) \`originalWALoggerDev\` was assigned \`.LOG\` instead of \`.DEV\`, so
    //     hookedWALoggerDev called the *log* function's original with DEV arguments.
    //
    // The hook exists so WhatsApp's own error reports do not leak (see the comment at
    // the top of hookLogs), so it is worth getting right — but it is not worth throwing
    // over. Resolve the modules with a bounded retry; if they never appear, give up
    // quietly rather than throwing on the page.
    function installWALoggerHooks(attempt)
    {
        var WALogger = null, WAUtils = null;
        try { WALogger = require("WALogger"); } catch (e) { WALogger = null; }
        try { WAUtils = require("WALoggerUtils"); } catch (e) { WAUtils = null; }

        if (!WALogger)
        {
            if (attempt < 40) setTimeout(function () { installWALoggerHooks(attempt + 1); }, 500);
            return;
        }

        // P7b: DEV, not LOG.
        var originalWALoggerLog = WALogger.LOG;
        var originalWALoggerDev = WALogger.DEV;
        var originalWALoggerERROR = WALogger.ERROR;

        WALogger.LOG = hookedWALoggerLog;
        WALogger.DEV = hookedWALoggerDev;
        WALogger.ERROR = hookedWALoggerError;
        WALogger.WARN = hookedWALoggerWarn;

        // rebuildTemplate is unavailable until WALoggerUtils registers, and can itself
        // throw on an unexpected template. Fall back to the raw arguments so a log line
        // is never lost to a null dereference.
        function rebuild(n, r)
        {
            if (WAUtils && typeof WAUtils.rebuildTemplate === 'function')
            {
                try { return WAUtils.rebuildTemplate(n, r); } catch (e) { /* fall through */ }
            }
            return String(n) + (r && r.length ? ' ' + r.join(' ') : '');
        }

        function hookedWALoggerDev(n)
        {
            if (WAdebugMode)
            {
                for (var t = arguments.length, r = new Array(t > 1 ? t - 1 : 0), a = 1; a < t; a++)
                    r[a - 1] = arguments[a];
                var logLine = rebuild(n, r)
                console.log("[WhatsApp DEV] " + logLine);
            }
            if (typeof originalWALoggerDev === 'function') return originalWALoggerDev.apply(null, arguments);
        }
        function hookedWALoggerLog(n)
        {
            if (WAdebugMode)
            {
                for (var t = arguments.length, r = new Array(t > 1 ? t - 1 : 0), a = 1; a < t; a++)
                    r[a - 1] = arguments[a];
                var logLine = rebuild(n, r)
                console.log("[WhatsApp LOG] " + logLine);
            }
            if (typeof originalWALoggerLog === 'function') return originalWALoggerLog.apply(null, arguments);
        }
        function hookedWALoggerError(n)
        {
            for (var t = arguments.length, r = new Array(t > 1 ? t - 1 : 0), a = 1; a < t; a++)
                r[a - 1] = arguments[a];
            var logLine = rebuild(n, r)
            console.error("[WhatsApp ERROR] " + logLine);
            if (typeof originalWALoggerERROR === 'function') return originalWALoggerERROR.apply(null, arguments);
        }
        function hookedWALoggerWarn(n)
        {
            for (var t = arguments.length, r = new Array(t > 1 ? t - 1 : 0), a = 1; a < t; a++)
                r[a - 1] = arguments[a];
            var logLine = rebuild(n, r)
            console.warn("[WhatsApp WARN] " + logLine);
            if (typeof originalWALoggerERROR === 'function') return originalWALoggerERROR.apply(null, arguments);
        }
    }

    setTimeout(function () { installWALoggerHooks(0); }, 2000);`;

const out = [...lines.slice(0, start), ...REPLACEMENT.split('\n'), ...lines.slice(end + 1)].join('\n');
writeFileSync(FILE, out, 'utf8');
console.log(`P7 applied: replaced lines ${start + 1}-${end + 1} of core/interception.js`);
