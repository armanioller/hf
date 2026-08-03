(function () {
  'use strict';

  var frame = document.getElementById('hfAppFrame');
  var PANEL_KEY = 'halftoneForgeMockupPanelsV2';
  var SCENE_KEY = 'halftoneForgeMockupSceneV2';
  var AUTO_CONFIG_NAME = '__HALFTONE_FORGE_AUTOSAVE__';
  var ART_DB = 'HFMockupProStore';
  var ART_STORE = 'files';
  var ART_KEY = 'lastArt';
  var initializedDocument = null;
  var doc = null;
  var win = null;
  var editActive = false;
  var overlay = null;
  var editButton = null;
  var resumeButton = null;
  var exportButton = null;
  var saveTimer = 0;
  var syncTimer = 0;
  var lastSceneFingerprint = '';
  var artAspect = 1;

  function safeJson(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function fingerprint(value) {
    var text = typeof value === 'string' ? value : JSON.stringify(value);
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16) + ':' + text.length;
  }

  function dispatchInput(element) {
    if (!element) return;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function injectStyles() {
    if (!doc || doc.getElementById('hfMockupProStyle')) return;
    var style = doc.createElement('style');
    style.id = 'hfMockupProStyle';
    style.textContent = [
      '.hf-pro-panel > .panel-label{margin:0!important}',
      '.hf-pro-panel-toggle{width:100%;min-height:34px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0;border:0;background:transparent;color:var(--text);cursor:pointer;text-align:left;font:700 9px/1 var(--font-mono);letter-spacing:.11em;text-transform:uppercase}',
      '.hf-pro-panel-toggle:hover{color:var(--accent)}',
      '.hf-pro-panel-arrow{width:22px;height:22px;display:grid;place-items:center;flex:none;border:1px solid var(--line);border-radius:7px;color:var(--text-dim);font:700 18px/1 system-ui;transition:transform .16s ease,color .16s ease,border-color .16s ease}',
      '.hf-pro-panel-toggle[aria-expanded="true"] .hf-pro-panel-arrow{transform:rotate(90deg);color:var(--accent);border-color:rgba(255,71,19,.45)}',
      '.hf-pro-panel-body{padding-top:8px}',
      '.hf-pro-panel-body[hidden]{display:none!important}',
      '.hf-pro-toolbar-btn.active{background:var(--accent)!important;border-color:var(--accent)!important;color:#160703!important}',
      '.hf-stamp-editor{position:absolute;inset:0;z-index:18;pointer-events:none;overflow:hidden}',
      '.hf-stamp-box{position:absolute;left:50%;top:50%;width:180px;height:180px;transform:translate(-50%,-50%);border:1.5px dashed var(--accent);box-shadow:0 0 0 1px rgba(0,0,0,.8),0 0 24px rgba(255,71,19,.2);pointer-events:auto;cursor:move;touch-action:none}',
      '.hf-stamp-box:before,.hf-stamp-box:after{content:"";position:absolute;background:rgba(255,255,255,.62);pointer-events:none}',
      '.hf-stamp-box:before{left:50%;top:-18px;bottom:-18px;width:1px}',
      '.hf-stamp-box:after{top:50%;left:-18px;right:-18px;height:1px}',
      '.hf-stamp-label{position:absolute;left:50%;top:-31px;transform:translateX(-50%);padding:4px 7px;border-radius:6px;background:rgba(17,18,24,.96);border:1px solid rgba(255,255,255,.12);color:#fff;font:700 8px/1 var(--font-mono);white-space:nowrap}',
      '.hf-stamp-handle{position:absolute;width:15px;height:15px;border-radius:50%;background:var(--accent);border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5)}',
      '.hf-stamp-handle.resize{right:-8px;bottom:-8px;cursor:nwse-resize}',
      '.hf-stamp-handle.rotate{left:50%;top:-52px;transform:translateX(-50%);cursor:grab}',
      '.hf-stamp-handle.rotate:after{content:"";position:absolute;left:50%;top:13px;width:1px;height:25px;background:var(--accent)}',
      '.hf-stamp-editor-hint{position:absolute;left:12px;bottom:12px;padding:7px 9px;border-radius:8px;background:rgba(12,13,18,.88);border:1px solid rgba(255,255,255,.1);color:#c9c9d0;font:9px/1.4 var(--font-ui);pointer-events:none}',
      '.hf-export-overlay{position:fixed;inset:0;z-index:13000;display:grid;place-items:center;padding:18px;background:rgba(4,5,8,.82);backdrop-filter:blur(10px)}',
      '.hf-export-overlay[hidden]{display:none!important}',
      '.hf-export-card{width:min(720px,96vw);max-height:92vh;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:linear-gradient(180deg,#202027,#15151a);box-shadow:0 28px 100px rgba(0,0,0,.7);overflow:hidden}',
      '.hf-export-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line)}',
      '.hf-export-title{font:700 14px/1.2 var(--font-mono)}',
      '.hf-export-sub{margin-top:4px;color:var(--text-dim);font-size:10px}',
      '.hf-export-body{padding:14px;overflow:auto}',
      '.hf-export-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
      '.hf-export-field{display:flex;flex-direction:column;gap:6px}',
      '.hf-export-field label,.hf-export-section-title{font:700 8.5px/1 var(--font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)}',
      '.hf-export-field input,.hf-export-field select{min-height:36px;padding:8px;border:1px solid var(--line);border-radius:8px;background:#111218;color:var(--text)}',
      '.hf-export-angles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:8px}',
      '.hf-export-check{display:flex;align-items:center;gap:7px;padding:8px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.025);font-size:10px}',
      '.hf-export-note{margin-top:10px;padding:9px;border:1px solid rgba(255,179,71,.22);border-radius:8px;background:rgba(255,179,71,.05);color:#d2c6ae;font-size:9.5px;line-height:1.45}',
      '.hf-export-progress{margin-top:10px;color:var(--text-dim);font:9px/1.4 var(--font-mono)}',
      '.hf-export-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 14px;border-top:1px solid var(--line)}',
      '.hf-scene-pill{display:inline-flex;align-items:center;gap:6px;margin-right:auto;color:var(--text-dim);font:8.5px/1 var(--font-mono)}',
      '.hf-scene-pill:before{content:"";width:7px;height:7px;border-radius:50%;background:#2ed6a1}',
      '@media(max-width:680px){.hf-export-grid{grid-template-columns:1fr}.hf-export-angles{grid-template-columns:1fr}}'
    ].join('\n');
    doc.head.appendChild(style);
  }

  function panelState() {
    return safeJson(localStorage.getItem(PANEL_KEY) || '{}', {});
  }

  function savePanelState(state) {
    try { localStorage.setItem(PANEL_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function normalizePanelKey(text, index) {
    return String(text || ('painel-' + index)).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function makePanelCollapsible(panel, index) {
    if (!panel || panel.dataset.hfProCollapsible === '1') return;
    if (panel.classList.contains('hf-validator-panel')) {
      panel.dataset.hfProCollapsible = '1';
      return;
    }
    var label = panel.querySelector(':scope > .panel-label');
    if (!label) return;
    var title = (label.textContent || '').trim() || 'Painel';
    var key = normalizePanelKey(title, index);
    var body = doc.createElement('div');
    body.className = 'hf-pro-panel-body';
    body.id = 'hfProPanelBody_' + key;
    Array.prototype.slice.call(panel.children).forEach(function (child) {
      if (child !== label) body.appendChild(child);
    });
    panel.appendChild(body);
    panel.classList.add('hf-pro-panel');
    panel.dataset.hfProCollapsible = '1';

    var button = doc.createElement('button');
    button.type = 'button';
    button.className = 'hf-pro-panel-toggle';
    button.setAttribute('aria-controls', body.id);
    button.innerHTML = '<span></span><span class="hf-pro-panel-arrow" aria-hidden="true">›</span>';
    button.firstChild.textContent = title;
    label.textContent = '';
    label.appendChild(button);

    var state = panelState();
    var defaultOpen = /arquivo do modelo|modelos padrao|arte da estampa|transformacao da estampa/i.test(title.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    var expanded = Object.prototype.hasOwnProperty.call(state, key) ? !!state[key] : defaultOpen;

    function apply(value) {
      expanded = !!value;
      body.hidden = !expanded;
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      button.title = expanded ? 'Recolher painel' : 'Expandir painel';
      state[key] = expanded;
      savePanelState(state);
    }

    button.addEventListener('click', function () { apply(!expanded); });
    apply(expanded);
  }

  function enhancePanels() {
    var sidebar = doc && doc.querySelector('#mockup3dOverlay .mockup3d-sidebar');
    if (!sidebar) return;
    Array.prototype.forEach.call(sidebar.querySelectorAll(':scope > .panel-group'), makePanelCollapsible);
  }

  function getSlider(id) {
    return doc && doc.getElementById(id);
  }

  function readRange(id) {
    var el = getSlider(id);
    if (!el) return { value: 0, min: 0, max: 1 };
    return {
      value: parseFloat(el.value || '0'),
      min: parseFloat(el.min || '0'),
      max: parseFloat(el.max || '1')
    };
  }

  function setRange(id, value) {
    var el = getSlider(id);
    if (!el) return;
    var min = parseFloat(el.min || '-9999');
    var max = parseFloat(el.max || '9999');
    var step = parseFloat(el.step || '0.01');
    var next = clamp(value, min, max);
    if (step > 0) next = Math.round(next / step) * step;
    el.value = String(next);
    dispatchInput(el);
  }

  function currentArtAspect() {
    var preview = doc && doc.getElementById('mockupArtPreview');
    if (preview && !preview.hidden && preview.naturalWidth && preview.naturalHeight) {
      artAspect = preview.naturalWidth / preview.naturalHeight;
    }
    return clamp(artAspect || 1, 0.2, 5);
  }

  function syncEditorOverlay() {
    if (!overlay || !editActive) return;
    var host = doc.getElementById('mockup3dCanvasHost');
    var box = overlay.querySelector('.hf-stamp-box');
    if (!host || !box) return;
    var rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    var xr = readRange('mockupStampX');
    var yr = readRange('mockupStampY');
    var sr = readRange('mockupStampScale');
    var rr = readRange('mockupStampRot');
    var nx = (xr.value - xr.min) / Math.max(0.001, xr.max - xr.min);
    var ny = (yr.value - yr.min) / Math.max(0.001, yr.max - yr.min);
    var ns = (sr.value - sr.min) / Math.max(0.001, sr.max - sr.min);
    var centerX = rect.width * (0.12 + nx * 0.76);
    var centerY = rect.height * (0.86 - ny * 0.72);
    var width = clamp(72 + ns * Math.min(rect.width, rect.height) * 0.46, 64, rect.width * 0.72);
    var height = width / currentArtAspect();
    height = clamp(height, 48, rect.height * 0.68);

    box.style.left = centerX + 'px';
    box.style.top = centerY + 'px';
    box.style.width = width + 'px';
    box.style.height = height + 'px';
    box.style.transform = 'translate(-50%,-50%) rotate(' + rr.value + 'deg)';
    var label = box.querySelector('.hf-stamp-label');
    if (label) label.textContent = 'ESTAMPA · ' + sr.value.toFixed(2) + '× · ' + rr.value.toFixed(0) + '°';
  }

  function pointerToStamp(event, hostRect) {
    var xr = readRange('mockupStampX');
    var yr = readRange('mockupStampY');
    var nx = clamp((event.clientX - hostRect.left) / hostRect.width, 0.12, 0.88);
    var ny = clamp((event.clientY - hostRect.top) / hostRect.height, 0.14, 0.86);
    setRange('mockupStampX', xr.min + ((nx - 0.12) / 0.76) * (xr.max - xr.min));
    setRange('mockupStampY', yr.min + ((0.86 - ny) / 0.72) * (yr.max - yr.min));
  }

  function installEditorInteractions(box) {
    var dragMode = '';
    var start = null;

    function down(event, mode) {
      if (!editActive) return;
      event.preventDefault();
      event.stopPropagation();
      dragMode = mode;
      var host = doc.getElementById('mockup3dCanvasHost');
      var rect = host.getBoundingClientRect();
      start = {
        rect: rect,
        x: event.clientX,
        y: event.clientY,
        scale: readRange('mockupStampScale').value,
        rot: readRange('mockupStampRot').value,
        box: box.getBoundingClientRect()
      };
      box.setPointerCapture(event.pointerId);
    }

    box.addEventListener('pointerdown', function (event) {
      if (event.target.classList.contains('resize')) return down(event, 'resize');
      if (event.target.classList.contains('rotate')) return down(event, 'rotate');
      down(event, 'move');
    });

    box.addEventListener('pointermove', function (event) {
      if (!dragMode || !start) return;
      event.preventDefault();
      if (dragMode === 'move') {
        pointerToStamp(event, start.rect);
      } else if (dragMode === 'resize') {
        var dx = event.clientX - start.x;
        var dy = event.clientY - start.y;
        var factor = 1 + (dx + dy) / Math.max(80, start.box.width + start.box.height);
        setRange('mockupStampScale', start.scale * clamp(factor, 0.15, 6));
      } else if (dragMode === 'rotate') {
        var cx = start.box.left + start.box.width / 2;
        var cy = start.box.top + start.box.height / 2;
        var angle = Math.atan2(event.clientY - cy, event.clientX - cx) * 180 / Math.PI + 90;
        setRange('mockupStampRot', angle);
      }
      syncEditorOverlay();
      scheduleSceneSave();
    });

    function up(event) {
      if (!dragMode) return;
      dragMode = '';
      start = null;
      try { box.releasePointerCapture(event.pointerId); } catch (_) {}
      scheduleSceneSave();
    }
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
    box.addEventListener('wheel', function (event) {
      if (!editActive) return;
      event.preventDefault();
      var value = readRange('mockupStampScale').value;
      setRange('mockupStampScale', value * (event.deltaY > 0 ? 0.94 : 1.06));
      syncEditorOverlay();
      scheduleSceneSave();
    }, { passive: false });
    box.addEventListener('dblclick', function (event) {
      event.preventDefault();
      var center = doc.getElementById('btnMockupCenterPrint');
      if (center) center.click();
      setTimeout(syncEditorOverlay, 60);
      scheduleSceneSave();
    });
  }

  function setEditMode(value) {
    editActive = !!value;
    if (editButton) {
      editButton.classList.toggle('active', editActive);
      editButton.textContent = editActive ? 'Concluir edição' : 'Editar estampa';
    }
    if (overlay) overlay.hidden = !editActive;
    var host = doc && doc.getElementById('mockup3dCanvasHost');
    var canvas = host && host.querySelector('canvas');
    if (canvas) canvas.style.pointerEvents = editActive ? 'none' : '';
    if (editActive) syncEditorOverlay();
  }

  function injectDirectEditor() {
    if (!doc || doc.getElementById('hfStampEditor')) return;
    var host = doc.getElementById('mockup3dCanvasHost');
    var toolbar = doc.querySelector('#mockup3dOverlay .mockup3d-toolbar-right');
    if (!host || !toolbar) return;
    if (win && win.getComputedStyle(host).position === 'static') host.style.position = 'relative';

    editButton = doc.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn-ghost hf-pro-toolbar-btn';
    editButton.id = 'btnHfDirectStampEdit';
    editButton.textContent = 'Editar estampa';
    var existingExport = doc.getElementById('btnMockupExport');
    toolbar.insertBefore(editButton, existingExport || null);
    editButton.addEventListener('click', function () { setEditMode(!editActive); });

    overlay = doc.createElement('div');
    overlay.className = 'hf-stamp-editor';
    overlay.id = 'hfStampEditor';
    overlay.hidden = true;
    overlay.innerHTML = '' +
      '<div class="hf-stamp-box">' +
        '<div class="hf-stamp-label">ESTAMPA</div>' +
        '<span class="hf-stamp-handle rotate" aria-label="Girar"></span>' +
        '<span class="hf-stamp-handle resize" aria-label="Redimensionar"></span>' +
      '</div>' +
      '<div class="hf-stamp-editor-hint">Arraste para mover · canto para redimensionar · alça superior para girar · roda para escala · duplo clique centraliza</div>';
    host.appendChild(overlay);
    installEditorInteractions(overlay.querySelector('.hf-stamp-box'));

    ['mockupStampScale','mockupStampX','mockupStampY','mockupStampRot'].forEach(function (id) {
      var el = doc.getElementById(id);
      if (el) el.addEventListener('input', function () { syncEditorOverlay(); scheduleSceneSave(); });
    });
    var preview = doc.getElementById('mockupArtPreview');
    if (preview) preview.addEventListener('load', function () { currentArtAspect(); syncEditorOverlay(); });
    if (win) win.addEventListener('resize', syncEditorOverlay);
  }

  function openArtDb() {
    return new Promise(function (resolve, reject) {
      try {
        var request = indexedDB.open(ART_DB, 1);
        request.onupgradeneeded = function () {
          var db = request.result;
          if (!db.objectStoreNames.contains(ART_STORE)) db.createObjectStore(ART_STORE);
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error || new Error('Falha ao abrir armazenamento da cena.')); };
      } catch (error) { reject(error); }
    });
  }

  function artDbPut(value) {
    return openArtDb().then(function (db) {
      return new Promise(function (resolve) {
        var request = db.transaction(ART_STORE, 'readwrite').objectStore(ART_STORE).put(value, ART_KEY);
        request.onsuccess = request.onerror = function () { resolve(); };
      });
    }).catch(function () {});
  }

  function artDbGet() {
    return openArtDb().then(function (db) {
      return new Promise(function (resolve) {
        var request = db.transaction(ART_STORE, 'readonly').objectStore(ART_STORE).get(ART_KEY);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function saveArtFile(file) {
    if (!file || String(file.type || '').indexOf('image/') !== 0) return;
    artDbPut({ blob: file, name: file.name || 'arte.png', type: file.type || 'image/png', savedAt: Date.now() });
  }

  function saveCurrentCanvasArt() {
    var canvas = doc && doc.getElementById('previewCanvas');
    if (!canvas || !canvas.width || !canvas.height) return;
    canvas.toBlob(function (blob) {
      if (blob) artDbPut({ blob: blob, name: 'arte-atual-halftone.png', type: 'image/png', savedAt: Date.now() });
    }, 'image/png');
  }

  function sceneSnapshot() {
    var ids = [
      'mockupGarmentTint','mockupGarmentBrightness','mockupGarmentRoughness','mockupGarmentMetalness',
      'mockupBgColor','mockupAmbient','mockupKeyLight','mockupExposure','mockupPrintZone','mockupProjectionMode',
      'mockupFrontAxis','mockupStampScale','mockupStampX','mockupStampY','mockupStampZ','mockupStampRot'
    ];
    var values = {};
    ids.forEach(function (id) {
      var el = doc.getElementById(id);
      if (el) values[id] = el.value;
    });
    var diagnostics = null;
    try {
      diagnostics = win.HFMockup3D && typeof win.HFMockup3D.getDiagnostics === 'function' ? win.HFMockup3D.getDiagnostics() : null;
    } catch (_) {}
    return {
      schema: 'halftone-forge-mockup-scene',
      version: 2,
      savedAt: new Date().toISOString(),
      values: values,
      camera: diagnostics && diagnostics.camera || null,
      model: diagnostics && diagnostics.model || null,
      art: diagnostics && diagnostics.art || null
    };
  }

  function hideAutoConfigOption() {
    var select = doc && doc.getElementById('mockupConfigSelect');
    if (!select) return;
    Array.prototype.forEach.call(select.options, function (option) {
      if (option.value === AUTO_CONFIG_NAME) option.hidden = true;
    });
  }

  function saveWithNativeConfig() {
    var nameInput = doc.getElementById('mockupConfigName');
    var saveBtn = doc.getElementById('btnMockupSaveConfig');
    var status = doc.getElementById('mockupStatusLine');
    if (!nameInput || !saveBtn) return;
    var oldName = nameInput.value;
    var oldStatus = status ? status.textContent : '';
    nameInput.value = AUTO_CONFIG_NAME;
    saveBtn.click();
    nameInput.value = oldName;
    if (status) setTimeout(function () { status.textContent = oldStatus || 'Cena salva automaticamente.'; }, 20);
    hideAutoConfigOption();
  }

  function saveSceneNow() {
    if (!doc) return;
    clearTimeout(saveTimer);
    var snap = sceneSnapshot();
    var fp = fingerprint(snap.values) + ':' + fingerprint(snap.camera || {});
    if (fp === lastSceneFingerprint) return;
    lastSceneFingerprint = fp;
    try { localStorage.setItem(SCENE_KEY, JSON.stringify(snap)); } catch (_) {}
    saveWithNativeConfig();
    updateResumeButton();
  }

  function scheduleSceneSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSceneNow, 700);
  }

  function restoreArtRecord(record) {
    if (!record || !record.blob) return Promise.resolve();
    var input = doc.getElementById('mockupArtInput');
    if (!input) return Promise.resolve();
    var file;
    try { file = new File([record.blob], record.name || 'arte.png', { type: record.type || record.blob.type || 'image/png' }); }
    catch (_) { file = record.blob; file.name = record.name || 'arte.png'; }
    var transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return wait(250);
  }

  async function resumeScene() {
    if (!doc) return;
    if (resumeButton) { resumeButton.disabled = true; resumeButton.textContent = 'Restaurando…'; }
    try {
      var openSaved = doc.getElementById('btnMockupLoadSavedModel');
      if (openSaved) openSaved.click();
      await wait(900);
      await restoreArtRecord(await artDbGet());
      var select = doc.getElementById('mockupConfigSelect');
      var load = doc.getElementById('btnMockupLoadConfig');
      if (select && load) {
        var option = Array.prototype.find.call(select.options, function (item) { return item.value === AUTO_CONFIG_NAME; });
        if (option) {
          select.value = AUTO_CONFIG_NAME;
          load.click();
        }
      }
      await wait(200);
      syncEditorOverlay();
      var status = doc.getElementById('mockupStatusLine');
      if (status) status.textContent = 'Última cena restaurada.';
    } finally {
      if (resumeButton) { resumeButton.disabled = false; resumeButton.textContent = 'Continuar cena'; }
    }
  }

  function updateResumeButton() {
    if (!resumeButton) return;
    var has = !!localStorage.getItem(SCENE_KEY);
    resumeButton.disabled = !has;
    resumeButton.title = has ? 'Restaurar modelo, arte e ajustes da última sessão' : 'Nenhuma cena salva ainda';
  }

  function installScenePersistence() {
    if (!doc || doc.getElementById('btnHfResumeScene')) return;
    var toolbar = doc.querySelector('#mockup3dOverlay .mockup3d-toolbar-right');
    if (!toolbar) return;
    resumeButton = doc.createElement('button');
    resumeButton.type = 'button';
    resumeButton.className = 'btn btn-ghost';
    resumeButton.id = 'btnHfResumeScene';
    resumeButton.textContent = 'Continuar cena';
    toolbar.insertBefore(resumeButton, toolbar.firstChild);
    resumeButton.addEventListener('click', resumeScene);
    updateResumeButton();

    var sidebar = doc.querySelector('#mockup3dOverlay .mockup3d-sidebar');
    if (sidebar && !doc.getElementById('hfSceneAutosavePill')) {
      var pill = doc.createElement('div');
      pill.className = 'hf-scene-pill';
      pill.id = 'hfSceneAutosavePill';
      pill.textContent = 'Cena 3D com recuperação automática';
      sidebar.insertBefore(pill, sidebar.firstChild);
    }

    var watched = doc.querySelectorAll('#mockup3dOverlay input, #mockup3dOverlay select');
    Array.prototype.forEach.call(watched, function (el) {
      if (el.id === 'mockupModelInput' || el.id === 'mockupArtInput') return;
      el.addEventListener('input', scheduleSceneSave);
      el.addEventListener('change', scheduleSceneSave);
    });

    var artInput = doc.getElementById('mockupArtInput');
    if (artInput) artInput.addEventListener('change', function () {
      var file = artInput.files && artInput.files[0];
      if (file) saveArtFile(file);
      scheduleSceneSave();
    }, true);
    var currentArt = doc.getElementById('btnMockupUseCurrentArt');
    if (currentArt) currentArt.addEventListener('click', function () {
      setTimeout(saveCurrentCanvasArt, 250);
      scheduleSceneSave();
    });
    ['btnMockupClose','btnMockup3DCloseTop'].forEach(function (id) {
      var el = doc.getElementById(id);
      if (el) el.addEventListener('click', saveSceneNow, true);
    });

    var configSelect = doc.getElementById('mockupConfigSelect');
    if (configSelect) {
      new MutationObserver(hideAutoConfigOption).observe(configSelect, { childList: true });
      hideAutoConfigOption();
    }

    clearInterval(syncTimer);
    syncTimer = setInterval(function () {
      var modal = doc.getElementById('mockup3dOverlay');
      if (modal && !modal.hidden) scheduleSceneSave();
    }, 3500);
  }

  function u16le(n) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }
  function u32le(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
  function concat(parts) {
    var total = parts.reduce(function (sum, item) { return sum + item.length; }, 0);
    var out = new Uint8Array(total);
    var offset = 0;
    parts.forEach(function (part) { out.set(part, offset); offset += part.length; });
    return out;
  }
  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var i = 0; i < 256; i++) {
        var c = i;
        for (var j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[i] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var k = 0; k < bytes.length; k++) crc = crcTable[(crc ^ bytes[k]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  async function buildZip(entries) {
    var enc = new TextEncoder();
    var locals = [], centrals = [], offset = 0;
    var now = new Date();
    var dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() / 2) & 31);
    var dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
    for (var i = 0; i < entries.length; i++) {
      var name = enc.encode(entries[i].name);
      var data = new Uint8Array(await entries[i].blob.arrayBuffer());
      var crc = crc32(data);
      var flags = 0x0800;
      var local = concat([u32le(0x04034b50),u16le(20),u16le(flags),u16le(0),u16le(dosTime),u16le(dosDate),u32le(crc),u32le(data.length),u32le(data.length),u16le(name.length),u16le(0),name,data]);
      locals.push(local);
      var central = concat([u32le(0x02014b50),u16le(20),u16le(20),u16le(flags),u16le(0),u16le(dosTime),u16le(dosDate),u32le(crc),u32le(data.length),u32le(data.length),u16le(name.length),u16le(0),u16le(0),u16le(0),u16le(0),u32le(0),u32le(offset),name]);
      centrals.push(central);
      offset += local.length;
    }
    var centralSize = centrals.reduce(function (sum, item) { return sum + item.length; }, 0);
    var end = concat([u32le(0x06054b50),u16le(0),u16le(0),u16le(entries.length),u16le(entries.length),u32le(centralSize),u32le(offset),u16le(0)]);
    return new Blob(locals.concat(centrals).concat([end]), { type: 'application/zip' });
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = name;
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2500);
  }

  function removeGreenBackground(canvas) {
    var ctx = canvas.getContext('2d');
    var image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var data = image.data;
    for (var i = 0; i < data.length; i += 4) {
      var r = data[i], g = data[i + 1], b = data[i + 2];
      var greenDominance = g - Math.max(r, b);
      if (g > 80 && greenDominance > 35) {
        var alpha = clamp(255 - (greenDominance - 35) * 5, 0, 255);
        data[i + 3] = Math.min(data[i + 3], alpha);
        if (alpha < 180) {
          var spill = Math.min(g, Math.max(r, b) + 15);
          data[i + 1] = spill;
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  function captureCanvas(width, height, transparent) {
    var source = doc.querySelector('#mockup3dCanvasHost canvas');
    if (!source) return Promise.reject(new Error('O renderizador 3D ainda não está pronto.'));
    var out = doc.createElement('canvas');
    out.width = width;
    out.height = height;
    var ctx = out.getContext('2d');
    if (!transparent) {
      var bg = doc.getElementById('mockupBgColor');
      ctx.fillStyle = bg ? bg.value : '#11141b';
      ctx.fillRect(0, 0, width, height);
    }
    var scale = Math.min(width / source.width, height / source.height);
    var dw = source.width * scale;
    var dh = source.height * scale;
    ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
    if (transparent) removeGreenBackground(out);
    return new Promise(function (resolve, reject) {
      out.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('Falha ao gerar PNG.')); }, 'image/png');
    });
  }

  function exportPresetChanged(select, width, height, background, angles) {
    var presets = {
      custom: null,
      mercado: { w: 1200, h: 1200, bg: 'white', a: ['PRINT_FRONT','PRINT_BACK'] },
      shopee: { w: 1200, h: 1200, bg: 'white', a: ['PRINT_FRONT','PRINT_BACK'] },
      instagram: { w: 1080, h: 1350, bg: 'current', a: ['PRINT_FRONT'] },
      story: { w: 1080, h: 1920, bg: 'current', a: ['PRINT_FRONT'] },
      catalogo: { w: 1600, h: 1600, bg: 'white', a: ['PRINT_FRONT','PRINT_BACK','PRINT_LEFT_SLEEVE','PRINT_RIGHT_SLEEVE'] },
      premium: { w: 2048, h: 2048, bg: 'black', a: ['PRINT_FRONT','PRINT_BACK'] },
      transparente: { w: 2048, h: 2048, bg: 'transparent', a: ['PRINT_FRONT'] }
    };
    var preset = presets[select.value];
    if (!preset) return;
    width.value = preset.w;
    height.value = preset.h;
    background.value = preset.bg;
    Array.prototype.forEach.call(angles.querySelectorAll('input[type="checkbox"]'), function (input) {
      input.checked = preset.a.indexOf(input.value) >= 0;
    });
  }

  function injectExportStudio() {
    if (!doc || doc.getElementById('hfExportStudioOverlay')) return;
    var toolbar = doc.querySelector('#mockup3dOverlay .mockup3d-toolbar-right');
    if (!toolbar) return;
    exportButton = doc.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'btn btn-primary';
    exportButton.id = 'btnHfExportStudio';
    exportButton.textContent = 'Exportar Pro';
    var existing = doc.getElementById('btnMockupExport');
    if (existing) existing.className = 'btn btn-ghost';
    toolbar.appendChild(exportButton);

    var modal = doc.createElement('div');
    modal.className = 'hf-export-overlay';
    modal.id = 'hfExportStudioOverlay';
    modal.hidden = true;
    modal.innerHTML = '' +
      '<div class="hf-export-card" role="dialog" aria-modal="true" aria-labelledby="hfExportTitle">' +
        '<div class="hf-export-head"><div><div class="hf-export-title" id="hfExportTitle">EXPORTAÇÃO PROFISSIONAL DO MOCKUP</div><div class="hf-export-sub">Gere uma imagem ou um pacote com vários ângulos para anúncios e catálogos.</div></div><button class="btn btn-ghost" id="btnHfExportClose" type="button">Fechar</button></div>' +
        '<div class="hf-export-body">' +
          '<div class="hf-export-grid">' +
            '<div class="hf-export-field"><label for="hfExportPreset">Preset</label><select id="hfExportPreset"><option value="custom">Personalizado</option><option value="mercado">Mercado Livre · quadrado</option><option value="shopee">Shopee · quadrado</option><option value="instagram">Instagram · 4:5</option><option value="story">Story · 9:16</option><option value="catalogo">Catálogo · quatro ângulos</option><option value="premium">Imagem premium · fundo escuro</option><option value="transparente">PNG transparente</option></select></div>' +
            '<div class="hf-export-field"><label for="hfExportBackground">Fundo</label><select id="hfExportBackground"><option value="current">Atual do estúdio</option><option value="white">Branco</option><option value="black">Preto</option><option value="transparent">Transparente</option></select></div>' +
            '<div class="hf-export-field"><label for="hfExportWidth">Largura em pixels</label><input id="hfExportWidth" type="number" min="320" max="8192" step="10" value="1600"></div>' +
            '<div class="hf-export-field"><label for="hfExportHeight">Altura em pixels</label><input id="hfExportHeight" type="number" min="320" max="8192" step="10" value="1600"></div>' +
          '</div>' +
          '<div class="hf-export-section-title" style="margin-top:13px">Ângulos</div>' +
          '<div class="hf-export-angles" id="hfExportAngles">' +
            '<label class="hf-export-check"><input type="checkbox" value="CURRENT"> Vista atual</label>' +
            '<label class="hf-export-check"><input type="checkbox" value="PRINT_FRONT" checked> Frente</label>' +
            '<label class="hf-export-check"><input type="checkbox" value="PRINT_BACK"> Costas</label>' +
            '<label class="hf-export-check"><input type="checkbox" value="PRINT_LEFT_SLEEVE"> Manga esquerda</label>' +
            '<label class="hf-export-check"><input type="checkbox" value="PRINT_RIGHT_SLEEVE"> Manga direita</label>' +
          '</div>' +
          '<div class="hf-export-note">A saída usa o render atual do WebGL e é redimensionada para o tamanho escolhido. No modo transparente, o estúdio usa remoção automática do fundo; confira bordas e sombras antes da produção final.</div>' +
          '<div class="hf-export-progress" id="hfExportProgress">Pronto para exportar.</div>' +
        '</div>' +
        '<div class="hf-export-foot"><button class="btn btn-ghost" id="btnHfExportCancel" type="button">Cancelar</button><button class="btn btn-primary" id="btnHfExportRun" type="button">Gerar arquivos</button></div>' +
      '</div>';
    doc.body.appendChild(modal);

    var preset = doc.getElementById('hfExportPreset');
    var width = doc.getElementById('hfExportWidth');
    var height = doc.getElementById('hfExportHeight');
    var background = doc.getElementById('hfExportBackground');
    var angles = doc.getElementById('hfExportAngles');
    preset.addEventListener('change', function () { exportPresetChanged(preset, width, height, background, angles); });

    function close() { modal.hidden = true; }
    exportButton.addEventListener('click', function () { modal.hidden = false; });
    doc.getElementById('btnHfExportClose').addEventListener('click', close);
    doc.getElementById('btnHfExportCancel').addEventListener('click', close);
    modal.addEventListener('click', function (event) { if (event.target === modal) close(); });

    doc.getElementById('btnHfExportRun').addEventListener('click', async function () {
      var run = this;
      var progress = doc.getElementById('hfExportProgress');
      var selected = Array.prototype.filter.call(angles.querySelectorAll('input:checked'), function (input) { return input.checked; }).map(function (input) { return input.value; });
      if (!selected.length) { progress.textContent = 'Selecione pelo menos um ângulo.'; return; }
      var w = clamp(parseInt(width.value, 10) || 1600, 320, 8192);
      var h = clamp(parseInt(height.value, 10) || 1600, 320, 8192);
      var bgMode = background.value;
      var bgInput = doc.getElementById('mockupBgColor');
      var oldBg = bgInput ? bgInput.value : '#11141b';
      var zoneSelect = doc.getElementById('mockupPrintZone');
      var oldZone = zoneSelect ? zoneSelect.value : 'PRINT_FRONT';
      var entries = [];
      run.disabled = true;
      run.textContent = 'Gerando…';
      try {
        if (bgInput && bgMode !== 'current') {
          bgInput.value = bgMode === 'white' ? '#ffffff' : bgMode === 'black' ? '#000000' : '#00ff00';
          dispatchInput(bgInput);
          await wait(180);
        }
        for (var i = 0; i < selected.length; i++) {
          var zone = selected[i];
          progress.textContent = 'Renderizando ' + (i + 1) + ' de ' + selected.length + '…';
          if (zone !== 'CURRENT' && zoneSelect) {
            zoneSelect.value = zone;
            dispatchInput(zoneSelect);
            var view = doc.getElementById('btnMockupViewZone');
            if (view) view.click();
            await wait(650);
          } else {
            await wait(120);
          }
          var blob = await captureCanvas(w, h, bgMode === 'transparent');
          var label = zone === 'CURRENT' ? 'vista-atual' : zone.toLowerCase().replace('print_', '').replace(/_/g, '-');
          entries.push({ name: 'mockup-' + label + '-' + w + 'x' + h + '.png', blob: blob });
        }
        if (entries.length === 1) downloadBlob(entries[0].blob, entries[0].name);
        else downloadBlob(await buildZip(entries), 'mockup-halftone-forge-' + entries.length + '-angulos.zip');
        progress.textContent = entries.length + ' arquivo(s) gerado(s) com sucesso.';
        scheduleSceneSave();
      } catch (error) {
        console.error(error);
        progress.textContent = 'Falha na exportação: ' + error.message;
      } finally {
        if (zoneSelect) { zoneSelect.value = oldZone; dispatchInput(zoneSelect); }
        if (bgInput) { bgInput.value = oldBg; dispatchInput(bgInput); }
        run.disabled = false;
        run.textContent = 'Gerar arquivos';
      }
    });
  }

  function updateDocumentation() {
    if (!doc || doc.getElementById('docs-mockup-pro')) return;
    var docs = doc.getElementById('docsContent');
    if (!docs) return;
    var section = doc.createElement('section');
    section.id = 'docs-mockup-pro';
    section.innerHTML = '' +
      '<h2>Mockup 3D Pro</h2>' +
      '<p>A barra lateral foi organizada em painéis expansíveis. O estado aberto ou fechado fica salvo neste navegador.</p>' +
      '<h3>Edição direta da estampa</h3><p>Use <code>Editar estampa</code> para mover, redimensionar e girar a arte diretamente sobre a área do modelo. Os controles tradicionais continuam sincronizados.</p>' +
      '<h3>Recuperação da cena</h3><p>O app mantém uma recuperação automática do modelo lembrado, da última arte e das configurações da cena. Use <code>Continuar cena</code> para restaurar o trabalho.</p>' +
      '<h3>Exportação profissional</h3><p>O botão <code>Exportar Pro</code> oferece tamanhos para marketplaces, fundos e exportação de frente, costas e mangas. Vários ângulos são entregues em um arquivo ZIP.</p>' +
      '<div class="docs-tip"><strong>Transparência:</strong> o fundo transparente usa remoção automática do fundo renderizado. Confira sombras e bordas antes do uso final.</div>';
    var faq = doc.getElementById('docs-faq');
    if (faq && faq.parentNode) faq.parentNode.insertBefore(section, faq);
    else docs.appendChild(section);
    var toc = doc.querySelector('#docsOverlay .docs-toc');
    if (toc) {
      var link = doc.createElement('a');
      link.className = 'docs-toc-link';
      link.href = '#docs-mockup-pro';
      link.textContent = 'Mockup 3D Pro';
      toc.appendChild(link);
      link.addEventListener('click', function (event) {
        event.preventDefault();
        docs.scrollTo({ top: Math.max(0, section.offsetTop - 12), behavior: 'smooth' });
      });
    }
  }

  function initialize() {
    try {
      win = frame && frame.contentWindow;
      doc = frame && frame.contentDocument;
    } catch (_) {
      win = null;
      doc = null;
    }
    if (!doc) return;
    if (initializedDocument !== doc) {
      initializedDocument = doc;
      injectStyles();
    }
    enhancePanels();
    injectDirectEditor();
    installScenePersistence();
    injectExportStudio();
    updateDocumentation();
  }

  if (frame) {
    frame.addEventListener('load', function () {
      setTimeout(initialize, 200);
      setTimeout(initialize, 1000);
      setTimeout(initialize, 2600);
    });
    setTimeout(initialize, 700);
  }
})();