;(function (root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof exports === 'object' && typeof module === 'object') { module.exports = factory(); }
  else { root.WAIBundleManifest = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

  var MAIN_CRITICAL = Object.freeze([
    'core/ws_hook.js',
    'core/comms_worker_fix.js',
  ]);

  var MAIN_REST = Object.freeze([
    'lib/pbf.3.0.5.min.js',
    'lib/libsignal-protocol-ee5b8ba.min.js',
    'lib/pako.js',
    'shared/jid_utils.js',
    'shared/ephemeral_utils.js',
    'shared/settings_schema.js',
    'shared/wai_page_bus.js',
    'shared/error_hook.js',
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
  ]);

  var DEFERRED = Object.freeze([]);

  var UI = Object.freeze([
    'core/ui_class_names.js',
    'shared/jid_utils.js',
    'shared/ephemeral_utils.js',
    'shared/settings_schema.js',
    'shared/wai_page_bus.js',
    'shared/privacy_lock.js',
    'shared/settings_renderer.js',
    'shared/error_hook.js',
    'core/ui.js',
    'core/status_download.js',
    'lib/sweetalert.min.js',
  ]);

  var CSS = Object.freeze([
    'styles.css',
  ]);

  var IMAGE_ASSETS = Object.freeze([
    'images/download.svg',
    'images/incognito_gray_24_hollow_9.svg',
    'images/computer.svg',
    'images/phone.svg',
    'images/incognito_gray.svg',
  ]);

  return {
    DESKTOP_UA: DESKTOP_UA,
    MAIN_CRITICAL: MAIN_CRITICAL,
    MAIN_REST: MAIN_REST,
    DEFERRED: DEFERRED,
    UI: UI,
    CSS: CSS,
    IMAGE_ASSETS: IMAGE_ASSETS,
  };
});
