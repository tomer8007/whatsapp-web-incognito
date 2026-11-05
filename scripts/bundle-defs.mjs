// Shared bundle definitions for build.mjs and verify-bundles.mjs.
//
// Load order mirrors core_injection.js exactly. If upstream changes the chain,
// both the builder and the assertions see the same lists.

// MAIN_CRITICAL is the only file with a hard deadline: it must replace the
// WebSocket constructor before WhatsApp opens its first socket (C1).
export const MAIN_CRITICAL = ['core/ws_hook.js'];

export const MAIN_REST = [
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

// moduleRaid scans WhatsApp's webpack module registry, which does not exist until
// the page bundle has run. Upstream defers it with setTimeout(10).
export const DEFERRED = ['lib/moduleraid.js'];

// ui_class_names is repeated on purpose: it is idempotent (var + IIFE) and
// keeps the group mirroring the manifest.
export const UI = [
  'core/ui_class_names.js',
  'core/ui.js',
  'core/status_download.js',
  'lib/drop.js',
  'lib/sweetalert.min.js',
];

export const CSS = ['styles.css', 'lib/css/drop-theme-basic.css'];

// The 4 getURL images, plus incognito_gray.svg which styles.css references.
export const IMAGE_ASSETS = [
  'images/download.svg',
  'images/incognito_gray_24_hollow_9.svg',
  'images/computer.svg',
  'images/phone.svg',
  'images/incognito_gray.svg',
];
