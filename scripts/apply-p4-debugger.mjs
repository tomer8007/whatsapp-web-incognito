#!/usr/bin/env node
// P4: remove live `debugger;` statements from upstream core/ files.
//
// Why: a `debugger` statement is free when no debugger is attached, but it SUSPENDS
// execution when DevTools is open. Electron users will open DevTools. The worst sites
// were on the per-frame WebSocket path and in hookedPromiseError, which fires on every
// unhandled promise rejection anywhere in WhatsApp.
//
// This transform is deliberately conservative:
//   - only lines whose entire content is `debugger;` (plus optional indentation)
//   - `//debugger;` comments are left untouched
//   - the single inline `if (...) debugger;` is rewritten to a console.warn
//   - `debugger` appearing inside strings or identifiers is never touched
//
// It is idempotent and safe to re-run. It edits files in place, so it is a one-time
// source patch, not a per-build step.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'core/interception.js',
  'core/multi_device.js',
  'core/utils.js',
  'core/ui.js',
  'core/parsing/binary_reader.js',
  'core/parsing/node_reader_writer.js',
];

const STANDALONE = /^[ \t]*debugger;[ \t]*\r?\n/gm;
const INLINE = /^([ \t]*)if[ \t]*\((.+)\)[ \t]*debugger;[ \t]*$/gm;

let totalRemoved = 0;
let totalRewritten = 0;

for (const rel of FILES) {
  const path = join(ROOT, rel);
  const before = readFileSync(path, 'utf8');

  const removed = (before.match(STANDALONE) || []).length;
  let after = before.replace(STANDALONE, '');

  let rewritten = 0;
  after = after.replace(INLINE, (_m, indent, cond) => {
    rewritten++;
    return `${indent}if (${cond}) console.warn("WhatsIncognito: unexpected condition: ${cond.trim()}");`;
  });

  if (after !== before) {
    writeFileSync(path, after, 'utf8');
    totalRemoved += removed;
    totalRewritten += rewritten;
    console.log(`  ${rel.padEnd(38)} -${removed} debugger, ${rewritten} inline rewritten`);
  } else {
    console.log(`  ${rel.padEnd(38)} unchanged`);
  }
}

console.log(`\nP4: removed ${totalRemoved} debugger statements, rewrote ${totalRewritten} inline guards.`);
