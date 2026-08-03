(function () {
  'use strict';

  var frame = document.getElementById('hfAppFrame');
  var VALIDATOR_STATE_KEY = 'hfMockupValidatorExpandedV1';

  function installStyles(doc) {
    if (doc.getElementById('hfUiFixesStyle')) return;

    var style = doc.createElement('style');
    style.id = 'hfUiFixesStyle';
    style.textContent = [
      '#appDialogOverlay { z-index: 12000 !important; }',
      '#appDialogOverlay .app-dialog-card { position: relative; z-index: 12001 !important; }',
      '.toast-stack { z-index: 12020 !important; }',
      '.hf-validator-panel > .panel-label { margin:0 !important; }',
      '.hf-validator-toggle { width:100%; min-height:34px; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0; border:0; background:transparent; color:var(--text); cursor:pointer; text-align:left; font:700 9px/1 var(--font-mono); letter-spacing:.11em; text-transform:uppercase; }',
      '.hf-validator-toggle:hover { color:var(--accent); }',
      '.hf-validator-arrow { width:22px; height:22px; display:grid; place-items:center; flex:none; border:1px solid var(--line); border-radius:7px; color:var(--text-dim); font:700 18px/1 system-ui; transform:rotate(0deg); transition:transform .16s ease,color .16s ease,border-color .16s ease; }',
      '.hf-validator-toggle[aria-expanded="true"] .hf-validator-arrow { transform:rotate(90deg); color:var(--accent); border-color:rgba(255,71,19,.45); }',
      '.hf-validator-body { padding-top:8px; }',
      '.hf-validator-body[hidden] { display:none !important; }'
    ].join('\n');
    doc.head.appendChild(style);
  }

  function installValidatorToggle(doc) {
    var summary = doc.getElementById('mockupValidationSummary');
    var panel = summary && summary.closest('.panel-group');
    if (!panel || panel.dataset.hfCollapsible === '1') return;

    var label = panel.querySelector(':scope > .panel-label');
    if (!label) return;

    panel.dataset.hfCollapsible = '1';
    panel.classList.add('hf-validator-panel');

    var body = doc.createElement('div');
    body.className = 'hf-validator-body';
    body.id = 'hfMockupValidatorBody';

    var children = Array.prototype.slice.call(panel.children);
    children.forEach(function (child) {
      if (child !== label) body.appendChild(child);
    });
    panel.appendChild(body);

    var toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'hf-validator-toggle';
    toggle.setAttribute('aria-controls', body.id);
    toggle.innerHTML = '<span>Validador do modelo</span><span class="hf-validator-arrow" aria-hidden="true">›</span>';
    label.textContent = '';
    label.appendChild(toggle);

    var expanded = false;
    try { expanded = localStorage.getItem(VALIDATOR_STATE_KEY) === 'true'; } catch (_) {}

    function applyState(value) {
      expanded = !!value;
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      body.hidden = !expanded;
      toggle.title = expanded ? 'Recolher validador' : 'Expandir validador';
      try { localStorage.setItem(VALIDATOR_STATE_KEY, expanded ? 'true' : 'false'); } catch (_) {}
    }

    toggle.addEventListener('click', function () {
      applyState(!expanded);
    });

    applyState(expanded);
  }

  function install() {
    var doc;
    try { doc = frame && frame.contentDocument; } catch (_) { return; }
    if (!doc) return;

    installStyles(doc);
    installValidatorToggle(doc);
  }

  if (frame) {
    frame.addEventListener('load', function () {
      setTimeout(install, 100);
      setTimeout(install, 700);
      setTimeout(install, 1600);
    });
    setTimeout(install, 500);
  }
})();