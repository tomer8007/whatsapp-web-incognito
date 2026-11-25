;(function (root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof exports === 'object' && typeof module === 'object') { module.exports = factory(); }
  else { root.WAISettingsRenderer = factory(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function resolveGlobalSchema() {
    if (typeof WAISettingsSchema !== 'undefined' && WAISettingsSchema) return WAISettingsSchema;
    if (typeof globalThis !== 'undefined' && globalThis.WAISettingsSchema) return globalThis.WAISettingsSchema;
    if (typeof window !== 'undefined' && window.WAISettingsSchema) return window.WAISettingsSchema;
    return null;
  }

  function sha256Hex(text) {
    if (typeof crypto === 'undefined' || !crypto.subtle || typeof TextEncoder === 'undefined') {
      return Promise.reject(new Error('WebCrypto SHA-256 unavailable'));
    }
    var bytes = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      var arr = Array.from(new Uint8Array(buf));
      return arr.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }

  function createEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function mount(container, config) {
    if (!container) throw new Error('WAISettingsRenderer.mount requires a container element');
    var cfg = config && typeof config === 'object' ? config : {};
    var schema = cfg.schema || resolveGlobalSchema();
    if (!schema || typeof schema.specsFor !== 'function') {
      throw new Error('WAISettingsSchema must be loaded or passed to WAISettingsRenderer.mount');
    }

    var scope = cfg.scope || 'shared';
    var specs = schema.specsFor(scope);
    var defaults = schema.defaults(scope);
    var prefs = Object.assign({}, defaults);
    if (cfg.prefs && typeof cfg.prefs === 'object') {
      var initResult = schema.validatePatch(cfg.prefs, defaults, scope);
      prefs = initResult.prefs;
    }

    var onChange = typeof cfg.onChange === 'function' ? cfg.onChange : null;
    var onReset = typeof cfg.onReset === 'function' ? cfg.onReset : null;
    var onClose = typeof cfg.onClose === 'function' ? cfg.onClose : null;

    var statusState = cfg.status || null;
    var pinnedKeys = Object.create(null);
    var resetArmed = false;
    var resetTimer = null;
    var destroyed = false;

    var root = createEl('div', 'wai-panel');
    root.setAttribute('dir', 'ltr');

    // Header
    var header = createEl('div', 'wai-panel-header');
    var titleWrap = createEl('div', 'wai-panel-title-wrap');
    var titleEl = createEl('h2', 'wai-panel-title', cfg.title || 'Incognito Options');
    titleWrap.appendChild(titleEl);
    header.appendChild(titleWrap);

    if (onClose) {
      var closeBtn = createEl('button', 'wai-close-btn', '\u00d7');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close settings');
      closeBtn.setAttribute('data-wai-action', 'close');
      header.appendChild(closeBtn);
    }
    root.appendChild(header);

    // Optional Status Bar
    var statusBar = createEl('div', 'wai-status-bar');
    statusBar.style.display = 'none';
    var statusTextEl = createEl('span', 'wai-status-text');
    var statusActionBtn = createEl('button', 'wai-btn wai-btn-primary wai-status-action');
    statusActionBtn.type = 'button';
    statusActionBtn.setAttribute('data-wai-action', 'status-action');
    statusBar.appendChild(statusTextEl);
    statusBar.appendChild(statusActionBtn);
    root.appendChild(statusBar);

    // Body (scrollable groups)
    var body = createEl('div', 'wai-panel-body');
    var rowMap = Object.create(null);
    var groupList = Array.isArray(schema.GROUPS) ? schema.GROUPS : [];

    function renderChoiceGroup(spec, row) {
      var wrap = createEl('div', 'wai-choice-group');
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', spec.label);
      wrap.setAttribute('data-wai-choice-container', spec.key);
      row.appendChild(wrap);
      return wrap;
    }

    function syncChoicePills(spec, entry) {
      var containerEl = entry.choiceGroup;
      if (!containerEl) return;
      var currentVal = prefs[spec.key];
      var choices = Array.isArray(spec.choices) ? spec.choices.slice() : [];
      var hasCustom = typeof currentVal === 'number' && choices.indexOf(currentVal) === -1;
      containerEl.textContent = '';

      if (hasCustom) {
        var customBtn = createEl('button', 'wai-choice-pill wai-pill-active wai-pill-custom', 'Custom: ' + schema.choiceLabel(currentVal, spec));
        customBtn.type = 'button';
        customBtn.setAttribute('aria-pressed', 'true');
        customBtn.setAttribute('data-wai-action', 'choice');
        customBtn.setAttribute('data-wai-key', spec.key);
        customBtn.setAttribute('data-wai-value', String(currentVal));
        containerEl.appendChild(customBtn);
      }

      for (var c = 0; c < choices.length; c++) {
        var val = choices[c];
        var isActive = currentVal === val;
        var label = schema.choiceLabel ? schema.choiceLabel(val, spec) : String(val);
        var btn = createEl('button', isActive ? 'wai-choice-pill wai-pill-active' : 'wai-choice-pill', label);
        btn.type = 'button';
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        btn.setAttribute('data-wai-action', 'choice');
        btn.setAttribute('data-wai-key', spec.key);
        btn.setAttribute('data-wai-value', String(val));
        containerEl.appendChild(btn);
      }
    }

    function buildRow(spec) {
      var row = createEl('div', 'wai-setting-row wai-setting-' + spec.type);
      row.setAttribute('data-wai-row', spec.key);

      var entry = { spec: spec, row: row };

      if (spec.type === 'boolean') {
        var top = createEl('div', 'wai-setting-header');
        var textCol = createEl('div', 'wai-setting-text');
        var labelEl = createEl('div', 'wai-setting-label', spec.label);
        textCol.appendChild(labelEl);
        if (spec.caption) {
          textCol.appendChild(createEl('div', 'wai-setting-caption', spec.caption));
        }
        if (spec.note) {
          textCol.appendChild(createEl('div', 'wai-setting-note', spec.note));
        }

        var toggleBtn = createEl('button', 'wai-switch');
        toggleBtn.type = 'button';
        toggleBtn.setAttribute('role', 'switch');
        toggleBtn.setAttribute('aria-label', spec.label);
        toggleBtn.setAttribute('data-wai-action', 'toggle');
        toggleBtn.setAttribute('data-wai-key', spec.key);
        toggleBtn.appendChild(createEl('span', 'wai-switch-thumb'));

        row.setAttribute('data-wai-action', 'toggle');
        row.setAttribute('data-wai-key', spec.key);

        top.appendChild(textCol);
        top.appendChild(toggleBtn);
        row.appendChild(top);
        entry.toggleBtn = toggleBtn;
      } else if (spec.type === 'integer') {
        var intHeader = createEl('div', 'wai-setting-text');
        intHeader.appendChild(createEl('div', 'wai-setting-label', spec.label));
        if (spec.caption) {
          intHeader.appendChild(createEl('div', 'wai-setting-caption', spec.caption));
        }
        if (spec.note) {
          intHeader.appendChild(createEl('div', 'wai-setting-note', spec.note));
        }
        row.appendChild(intHeader);
        entry.choiceGroup = renderChoiceGroup(spec, row);
      } else if (spec.type === 'secret-hash') {
        var secretHeader = createEl('div', 'wai-setting-header');
        var secretText = createEl('div', 'wai-setting-text');
        secretText.appendChild(createEl('div', 'wai-setting-label', spec.label));
        if (spec.caption) {
          secretText.appendChild(createEl('div', 'wai-setting-caption', spec.caption));
        }
        var badge = createEl('span', 'wai-pin-badge');
        secretHeader.appendChild(secretText);
        secretHeader.appendChild(badge);
        row.appendChild(secretHeader);

        var depHint = createEl('div', 'wai-pin-hint');
        depHint.style.display = 'none';
        row.appendChild(depHint);

        var controls = createEl('div', 'wai-pin-controls');
        var pinLen = spec.pinLength || 4;
        var pinInput = createEl('input', 'wai-pin-input');
        pinInput.type = 'password';
        pinInput.setAttribute('inputmode', 'numeric');
        pinInput.setAttribute('autocomplete', 'off');
        pinInput.maxLength = pinLen;
        pinInput.placeholder = pinLen + '-digit PIN';
        pinInput.setAttribute('aria-label', spec.label);
        pinInput.setAttribute('data-wai-pin-input', spec.key);

        var saveBtn = createEl('button', 'wai-btn wai-btn-primary', 'Save PIN');
        saveBtn.type = 'button';
        saveBtn.setAttribute('data-wai-action', 'save-pin');
        saveBtn.setAttribute('data-wai-key', spec.key);

        var clearBtn = createEl('button', 'wai-btn wai-btn-secondary', 'Clear PIN');
        clearBtn.type = 'button';
        clearBtn.setAttribute('data-wai-action', 'clear-pin');
        clearBtn.setAttribute('data-wai-key', spec.key);

        controls.appendChild(pinInput);
        controls.appendChild(saveBtn);
        controls.appendChild(clearBtn);
        row.appendChild(controls);

        var feedback = createEl('div', 'wai-field-feedback');
        row.appendChild(feedback);

        entry.pinBadge = badge;
        entry.depHint = depHint;
        entry.pinInput = pinInput;
        entry.saveBtn = saveBtn;
        entry.clearBtn = clearBtn;
        entry.feedbackEl = feedback;
      }

      rowMap[spec.key] = entry;
      return row;
    }

    for (var g = 0; g < groupList.length; g++) {
      var group = groupList[g];
      var groupSpecs = specs.filter(function (s) { return s.group === group.id; });
      if (!groupSpecs.length) continue;

      var section = createEl('section', 'wai-group');
      section.setAttribute('data-wai-group', group.id);
      section.appendChild(createEl('h3', 'wai-group-title', group.label));

      var list = createEl('div', 'wai-group-items');
      for (var i = 0; i < groupSpecs.length; i++) {
        list.appendChild(buildRow(groupSpecs[i]));
      }
      section.appendChild(list);
      body.appendChild(section);
    }

    root.appendChild(body);

    // Footer
    var resetBtn = null;
    if (onReset) {
      var footer = createEl('div', 'wai-panel-footer');
      resetBtn = createEl('button', 'wai-btn wai-btn-danger-ghost', 'Reset all options to defaults');
      resetBtn.type = 'button';
      resetBtn.setAttribute('data-wai-action', 'reset');
      footer.appendChild(resetBtn);
      root.appendChild(footer);
    }

    function syncDOM() {
      if (destroyed) return;
      for (var j = 0; j < specs.length; j++) {
        var spec = specs[j];
        var entry = rowMap[spec.key];
        if (!entry) continue;

        var parentSatisfied = true;
        if (spec.dependsOn && spec.dependsOn.key) {
          parentSatisfied = prefs[spec.dependsOn.key] === spec.dependsOn.value;
        }
        var shouldShow = parentSatisfied || pinnedKeys[spec.key] === true;
        entry.row.style.display = shouldShow ? '' : 'none';
        entry.row.classList.toggle('wai-row-indented', Boolean(spec.dependsOn));

        if (spec.type === 'boolean' && entry.toggleBtn) {
          var checked = Boolean(prefs[spec.key]);
          entry.toggleBtn.setAttribute('aria-checked', checked ? 'true' : 'false');
          entry.toggleBtn.classList.toggle('wai-switch-on', checked);
          entry.row.classList.toggle('wai-row-active', checked);
        } else if (spec.type === 'integer') {
          syncChoicePills(spec, entry);
        } else if (spec.type === 'secret-hash') {
          var isSet = Boolean(prefs[spec.key]);
          entry.pinBadge.textContent = isSet ? 'PIN set' : 'No PIN set';
          entry.pinBadge.classList.toggle('wai-pin-badge-set', isSet);
          entry.clearBtn.disabled = !isSet;
          if (!parentSatisfied && pinnedKeys[spec.key] && spec.dependsOn) {
            var parentSpec = schema.getSpec(spec.dependsOn.key);
            entry.depHint.textContent = 'Enable "' + (parentSpec ? parentSpec.label : spec.dependsOn.key) + '" above for idle locking to activate.';
            entry.depHint.style.display = 'block';
          } else {
            entry.depHint.style.display = 'none';
          }
        }
      }
    }

    function renderStatus() {
      if (!statusState || !statusState.text) {
        statusBar.style.display = 'none';
        return;
      }
      statusBar.style.display = 'flex';
      statusBar.className = 'wai-status-bar wai-status-' + (statusState.tone || 'info');
      statusTextEl.textContent = statusState.text;
      if (statusState.actionLabel && typeof statusState.onAction === 'function') {
        statusActionBtn.textContent = statusState.actionLabel;
        statusActionBtn.style.display = '';
      } else {
        statusActionBtn.style.display = 'none';
      }
    }

    function applyUserPatch(rawPatch) {
      var res = schema.validatePatch(rawPatch, prefs, scope);
      if (!res.applied.length) return;
      prefs = res.prefs;
      syncDOM();
      if (onChange) {
        onChange(Object.assign({}, res.patch), Object.assign({}, prefs));
      }
    }

    function setPinFeedback(entry, text, isError) {
      if (!entry || !entry.feedbackEl) return;
      entry.feedbackEl.textContent = text || '';
      entry.feedbackEl.classList.toggle('wai-feedback-error', Boolean(isError));
      entry.feedbackEl.classList.toggle('wai-feedback-ok', Boolean(text && !isError));
    }

    function handleSavePin(key) {
      var entry = rowMap[key];
      if (!entry || !entry.pinInput) return;
      var pinLen = entry.spec.pinLength || 4;
      var val = String(entry.pinInput.value || '').replace(/[^0-9]/g, '');
      entry.pinInput.value = val;
      if (val.length !== pinLen) {
        setPinFeedback(entry, 'Enter ' + pinLen + ' digits (0-9).', true);
        entry.pinInput.focus();
        return;
      }
      setPinFeedback(entry, 'Saving...', false);
      sha256Hex(val).then(function (hashHex) {
        if (destroyed) return;
        entry.pinInput.value = '';
        var patch = {};
        patch[key] = hashHex;
        applyUserPatch(patch);
        setPinFeedback(entry, 'PIN saved.', false);
      }, function () {
        if (destroyed) return;
        setPinFeedback(entry, 'Unable to hash PIN in this context.', true);
      });
    }

    function handleClearPin(key) {
      var entry = rowMap[key];
      if (entry && entry.pinInput) entry.pinInput.value = '';
      var patch = {};
      patch[key] = '';
      applyUserPatch(patch);
      if (entry) setPinFeedback(entry, 'PIN cleared.', false);
    }

    function clearResetConfirm() {
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      resetArmed = false;
      if (resetBtn) {
        resetBtn.textContent = 'Reset all options to defaults';
        resetBtn.classList.remove('wai-btn-danger-armed');
      }
    }

    function onClick(e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      // Ignore row-wide toggle clicks if user clicked text link or button inside row
      var actionEl = target.closest('[data-wai-action]');
      if (!actionEl || !root.contains(actionEl)) return;

      var action = actionEl.getAttribute('data-wai-action');
      var key = actionEl.getAttribute('data-wai-key');

      if (action !== 'reset' && resetArmed) {
        clearResetConfirm();
      }

      if (action === 'close') {
        if (onClose) onClose();
        return;
      }

      if (action === 'status-action') {
        if (statusState && typeof statusState.onAction === 'function') {
          statusState.onAction();
        }
        return;
      }

      if (action === 'toggle' && key) {
        var patch = {};
        patch[key] = !prefs[key];
        if (key === 'privacyScreenLockEnabled' && pinnedKeys.privacyScreenLockPIN) {
          delete pinnedKeys.privacyScreenLockPIN;
        }
        applyUserPatch(patch);
        return;
      }

      if (action === 'choice' && key) {
        var val = parseInt(actionEl.getAttribute('data-wai-value'), 10);
        if (!isNaN(val)) {
          var choicePatch = {};
          choicePatch[key] = val;
          applyUserPatch(choicePatch);
        }
        return;
      }

      if (action === 'save-pin' && key) {
        handleSavePin(key);
        return;
      }

      if (action === 'clear-pin' && key) {
        handleClearPin(key);
        return;
      }

      if (action === 'reset' && onReset) {
        if (!resetArmed) {
          resetArmed = true;
          if (resetBtn) {
            resetBtn.textContent = 'Click again to confirm reset';
            resetBtn.classList.add('wai-btn-danger-armed');
          }
          resetTimer = setTimeout(clearResetConfirm, 4000);
        } else {
          clearResetConfirm();
          onReset();
        }
      }
    }

    function onInput(e) {
      var target = e.target;
      if (!target || !target.getAttribute) return;
      var key = target.getAttribute('data-wai-pin-input');
      if (!key) return;
      var cleaned = String(target.value || '').replace(/[^0-9]/g, '');
      if (target.value !== cleaned) target.value = cleaned;
      if (rowMap[key]) setPinFeedback(rowMap[key], '', false);
    }

    function onKeyDown(e) {
      var target = e.target;
      if (!target || !target.getAttribute) return;
      var key = target.getAttribute('data-wai-pin-input');
      if (key && e.key === 'Enter') {
        e.preventDefault();
        handleSavePin(key);
      }
    }

    function focusKey(key) {
      if (!key || !rowMap[key]) return false;
      pinnedKeys[key] = true;
      syncDOM();
      var entry = rowMap[key];
      for (var rKey in rowMap) {
        if (Object.prototype.hasOwnProperty.call(rowMap, rKey)) {
          rowMap[rKey].row.classList.remove('wai-row-highlight');
        }
      }
      entry.row.classList.add('wai-row-highlight');
      try {
        if (typeof entry.row.scrollIntoView === 'function') {
          entry.row.scrollIntoView({ block: 'nearest' });
        }
      } catch (e) {}
      if (entry.pinInput && typeof entry.pinInput.focus === 'function') {
        setTimeout(function () {
          if (!destroyed) entry.pinInput.focus();
        }, 0);
      } else if (entry.toggleBtn && typeof entry.toggleBtn.focus === 'function') {
        entry.toggleBtn.focus();
      }
      return true;
    }

    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKeyDown);

    syncDOM();
    renderStatus();
    container.textContent = '';
    container.appendChild(root);

    if (cfg.focusKey) {
      focusKey(cfg.focusKey);
    }

    return {
      element: root,
      update: function (nextPrefs) {
        if (destroyed || !nextPrefs || typeof nextPrefs !== 'object') return;
        var merged = Object.assign({}, prefs);
        var keys = Object.keys(nextPrefs);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          var spec = schema.getSpec(k);
          if (!spec || (scope !== 'all' && spec.scope !== scope)) continue;
          var coerced = schema.coerceSetting(spec, nextPrefs[k], merged[k]);
          if (coerced !== undefined) merged[k] = coerced;
        }
        prefs = merged;
        syncDOM();
      },
      setStatus: function (nextStatus) {
        if (destroyed) return;
        statusState = nextStatus || null;
        renderStatus();
      },
      focusKey: focusKey,
      getPrefs: function () {
        return Object.assign({}, prefs);
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        clearResetConfirm();
        root.removeEventListener('click', onClick);
        root.removeEventListener('input', onInput);
        root.removeEventListener('keydown', onKeyDown);
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
  }

  return {
    mount: mount,
  };
});
