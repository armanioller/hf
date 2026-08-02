(function () {
  'use strict';

  var API_BASE = 'https://cloudflare-worker.armanioller.workers.dev';
  var CLIENT_ID_KEY = 'hfCloudClientIdV1';
  var GALLERY_KEY = 'halftoneForgeGallery';
  var SETTINGS_PREFIX = 'halftoneForge';
  var UPLOADED_KEY = 'hfCloudUploadedImagesV1';

  var frame = document.getElementById('hfAppFrame');
  var statusEl = document.getElementById('hfCloudStatus');
  var statusText = document.getElementById('hfCloudStatusText');
  var syncBtn = document.getElementById('hfCloudSync');
  var restoreBtn = document.getElementById('hfCloudRestore');

  var clientId = getClientId();
  var appWin = null;
  var busy = false;
  var queue = Promise.resolve();
  var galleryTimer = 0;
  var settingsTimer = 0;
  var lastGalleryFingerprint = '';
  var lastSettingsFingerprint = '';

  localStorage.removeItem('hfCloudToken');
  sessionStorage.removeItem('hfCloudTokenSession');
  localStorage.removeItem('hfCloudUser');

  function getClientId() {
    var current = localStorage.getItem(CLIENT_ID_KEY);
    if (current && /^[a-zA-Z0-9_-]{16,80}$/.test(current)) return current;
    var id = '';
    if (crypto && typeof crypto.randomUUID === 'function') id = crypto.randomUUID().replace(/-/g, '');
    if (!id) {
      var bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      id = Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  }

  function setStatus(kind, text) {
    statusEl.className = 'hf-cloud-status ' + (kind || 'idle');
    statusText.textContent = text;
  }

  function setBusy(value, text) {
    busy = !!value;
    syncBtn.disabled = busy;
    restoreBtn.disabled = busy;
    if (text) setStatus(value ? 'working' : 'ok', text);
  }

  function stableFingerprint(value) {
    var str = typeof value === 'string' ? value : JSON.stringify(value);
    var hash = 2166136261;
    for (var i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16) + ':' + str.length;
  }

  function safeJsonParse(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  async function api(path, options) {
    var response = await fetch(API_BASE + path, options || {});
    var text = await response.text();
    var body = text ? safeJsonParse(text, text) : null;
    if (!response.ok) throw new Error(body && body.error ? body.error : ('Servidor respondeu ' + response.status));
    return body;
  }

  function enqueue(task) {
    queue = queue.then(task, task);
    return queue;
  }

  function postSave(kind, data, extra) {
    var payload = Object.assign({ clientId: clientId, kind: kind, data: data }, extra || {});
    return enqueue(function () {
      return api('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    });
  }

  function loadKind(kind) {
    return api('/api/load?clientId=' + encodeURIComponent(clientId) + '&kind=' + encodeURIComponent(kind));
  }

  function localGalleryItems() {
    try {
      if (appWin && typeof appWin.getGalleryItems === 'function') {
        var items = appWin.getGalleryItems();
        if (Array.isArray(items)) return items;
      }
    } catch (_) {}
    var raw = localStorage.getItem(GALLERY_KEY);
    var parsed = safeJsonParse(raw || '[]', []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function collectPreferences() {
    var values = {};
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || key === GALLERY_KEY || key === CLIENT_ID_KEY || key === UPLOADED_KEY) continue;
      if (key.indexOf(SETTINGS_PREFIX) === 0) values[key] = localStorage.getItem(key);
    }
    return {
      schema: 'halftone-forge-cloud-preferences',
      version: 1,
      savedAt: new Date().toISOString(),
      values: values
    };
  }

  function collectWorkspace() {
    var settings = {};
    try {
      if (appWin && typeof appWin.serializeAppSettings === 'function') settings = appWin.serializeAppSettings() || {};
    } catch (_) {}
    return {
      schema: 'halftone-forge-project',
      version: 1,
      savedAt: new Date().toISOString(),
      appSettings: settings,
      gallery: null,
      userPresets: null,
      dtf: null,
      cloud: { clientId: clientId, backend: API_BASE }
    };
  }

  function uploadedMap() {
    var map = safeJsonParse(localStorage.getItem(UPLOADED_KEY) || '{}', {});
    return map && typeof map === 'object' ? map : {};
  }

  async function syncGallery(reason) {
    var items = localGalleryItems();
    var uploaded = uploadedMap();
    var metadata = [];

    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var id = String(item.id || ('g_' + Date.now() + '_' + i)).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
      var fp = item.dataUrl ? stableFingerprint(item.dataUrl) : null;
      if (item.dataUrl && uploaded[id] !== fp) {
        var comma = String(item.dataUrl).indexOf(',');
        var base64 = comma >= 0 ? String(item.dataUrl).slice(comma + 1).replace(/\s/g, '') : '';
        await postSave('image', null, { id: id, base64: base64 });
        uploaded[id] = fp;
        localStorage.setItem(UPLOADED_KEY, JSON.stringify(uploaded));
      }
      metadata.push({
        id: id,
        title: item.title || 'Halftone',
        createdAt: item.createdAt || new Date().toISOString(),
        mode: item.mode || null,
        screenStyle: item.screenStyle || null
      });
    }

    await postSave('gallery', {
      schema: 'halftone-forge-cloud-gallery',
      version: 1,
      savedAt: new Date().toISOString(),
      reason: reason || 'automático',
      items: metadata
    });
  }

  async function syncSettings(reason) {
    await postSave('preferences', collectPreferences());
    await postSave('workspace', collectWorkspace());
    lastSettingsFingerprint = currentSettingsFingerprint();
  }

  async function syncAll(reason) {
    if (busy) return;
    setBusy(true, 'Salvando na nuvem…');
    try {
      await syncGallery(reason || 'manual');
      await syncSettings(reason || 'manual');
      lastGalleryFingerprint = currentGalleryFingerprint();
      setStatus('ok', 'Salvo na nuvem às ' + new Date().toLocaleTimeString('pt-BR'));
    } catch (error) {
      console.error(error);
      setStatus('error', 'Erro ao salvar: ' + error.message);
    } finally {
      setBusy(false);
    }
  }

  function currentGalleryFingerprint() {
    return stableFingerprint(localGalleryItems().map(function (item) {
      return {
        id: item.id,
        title: item.title,
        createdAt: item.createdAt,
        mode: item.mode,
        screenStyle: item.screenStyle,
        data: item.dataUrl ? stableFingerprint(item.dataUrl) : null
      };
    }));
  }

  function currentSettingsFingerprint() {
    return stableFingerprint({ preferences: collectPreferences(), workspace: collectWorkspace().appSettings });
  }

  function scheduleGallerySave() {
    clearTimeout(galleryTimer);
    galleryTimer = setTimeout(function () { syncAll('galeria'); }, 1200);
  }

  function scheduleSettingsSave() {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(function () { syncSettings('configurações').then(function () {
      setStatus('ok', 'Configurações salvas automaticamente');
    }).catch(function (error) {
      console.error(error);
      setStatus('error', 'Erro ao salvar configurações: ' + error.message);
    }); }, 2800);
  }

  function dataUrlFromBlob(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function restoreAll() {
    if (busy) return;
    if (!confirm('Restaurar a galeria e as configurações salvas na nuvem para este navegador?')) return;
    setBusy(true, 'Restaurando da nuvem…');
    try {
      var preferencesResult = await loadKind('preferences');
      if (preferencesResult.found && preferencesResult.data && preferencesResult.data.values) {
        Object.keys(preferencesResult.data.values).forEach(function (key) {
          localStorage.setItem(key, preferencesResult.data.values[key]);
        });
      }

      var workspaceResult = await loadKind('workspace');
      if (workspaceResult.found && appWin && typeof appWin.loadProjectPayload === 'function') {
        await appWin.loadProjectPayload(workspaceResult.data);
      }

      var galleryResult = await loadKind('gallery');
      if (galleryResult.found && galleryResult.data && Array.isArray(galleryResult.data.items)) {
        var restored = [];
        for (var i = 0; i < galleryResult.data.items.length; i++) {
          var meta = galleryResult.data.items[i];
          var response = await fetch(API_BASE + '/api/image?clientId=' + encodeURIComponent(clientId) + '&id=' + encodeURIComponent(meta.id));
          if (!response.ok) continue;
          var dataUrl = await dataUrlFromBlob(await response.blob());
          restored.push({
            id: meta.id,
            title: meta.title,
            createdAt: meta.createdAt,
            mode: meta.mode,
            screenStyle: meta.screenStyle,
            dataUrl: dataUrl
          });
        }
        localStorage.setItem(GALLERY_KEY, JSON.stringify(restored));
        if (appWin && typeof appWin.setGalleryItems === 'function') appWin.setGalleryItems(restored);
        if (appWin && typeof appWin.renderGallery === 'function') appWin.renderGallery();
      }

      lastGalleryFingerprint = currentGalleryFingerprint();
      lastSettingsFingerprint = currentSettingsFingerprint();
      setStatus('ok', 'Dados restaurados da nuvem');
    } catch (error) {
      console.error(error);
      setStatus('error', 'Erro ao restaurar: ' + error.message);
    } finally {
      setBusy(false);
    }
  }

  async function checkHealth() {
    try {
      var result = await api('/health');
      if (!result || !result.ok) throw new Error('Serviço indisponível');
      setStatus('ok', 'Nuvem ativa · salvamento automático');
      syncBtn.disabled = false;
      restoreBtn.disabled = false;
    } catch (error) {
      setStatus('error', 'Nuvem indisponível');
      syncBtn.disabled = true;
      restoreBtn.disabled = true;
    }
  }

  function beginMonitoring() {
    lastGalleryFingerprint = currentGalleryFingerprint();
    lastSettingsFingerprint = currentSettingsFingerprint();

    setInterval(function () {
      if (busy) return;
      var galleryFp = currentGalleryFingerprint();
      if (galleryFp !== lastGalleryFingerprint) {
        lastGalleryFingerprint = galleryFp;
        scheduleGallerySave();
      }
      var settingsFp = currentSettingsFingerprint();
      if (settingsFp !== lastSettingsFingerprint) {
        lastSettingsFingerprint = settingsFp;
        scheduleSettingsSave();
      }
    }, 1500);
  }

  frame.addEventListener('load', function () {
    try { appWin = frame.contentWindow; } catch (_) { appWin = null; }
    setTimeout(beginMonitoring, 900);
  });

  syncBtn.addEventListener('click', function () { syncAll('manual'); });
  restoreBtn.addEventListener('click', restoreAll);

  checkHealth();
})();
