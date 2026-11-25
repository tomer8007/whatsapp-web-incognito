// Re-exports shared bundle definitions from shared/bundle_manifest.js
// so build.mjs, verify-bundles.mjs, core_injection.js, and tests read one list.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const manifest = require('../shared/bundle_manifest.js');

export const DESKTOP_UA = manifest.DESKTOP_UA;
export const MAIN_CRITICAL = manifest.MAIN_CRITICAL;
export const MAIN_REST = manifest.MAIN_REST;
export const DEFERRED = manifest.DEFERRED;
export const UI = manifest.UI;
export const CSS = manifest.CSS;
export const IMAGE_ASSETS = manifest.IMAGE_ASSETS;
