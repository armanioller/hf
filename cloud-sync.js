(function () {
  'use strict';

  var OWNER = 'armanioller';
  var REPO = 'hf-data';
  var API = 'https://api.github.com';
  var TOKEN_LOCAL_KEY = 'hfCloudToken';
  var TOKEN_SESSION_KEY = 'hfCloudTokenSession';
  var USER_KEY = 'hfCloudUser';
  var GALLERY_KEY = 'halftoneForgeGallery';
  var SETTINGS_PREFIX = 'halftoneForge';

  var frame = document.getElementById('hfAppFrame');
  var statusEl = document.getElementById('hfCloudStatus');
  var statusTextEl = document.getElementById('hfCloudStatusText');
  var connectBtn = document.getElementById('hfCloudConnect');
  var syncBtn = document.getElementById('hfCloudSync');
  var restoreBtn = document.getElementById('hfCloudRestore');
  var modal = document.getElementById('hfCloudModal');
  var tokenInput = document.getElementById('hfCloudTokenInput');
  var rememberInput = document.getElementById('hfCloudRemember');
  var modalSaveBtn = document.getElementById('hfCloudModalSave');
  var modalCloseBtn = document.getElementById('hfCloudModalClose');
  var disconnectBtn = document.getElementById('hfCloudDisconnect');
  var fullProjectBtn = document.getElementById('hfCloudFullProject');
  var restoreProjectBtn = document.getElementById('hfCloudRestoreProject');
  var cloudUserEl = document.getElementById('hfCloudUser');

  var token = '';
  var cloudUser = '';
  var appWin = null;
  var appDoc = null;
  var working = false;
  var writeQueue = Promise.resolve();
  var settingsTimer = 0;
  var galleryTimer = 0;
  var lastSettingsFingerprint = '';
  var lastGalleryFingerprint = '';
  var lastSettingsWriteAt = 0;
  var pendingSettingsAfterThrottle = false;

  function setStatus(kind, text) {
    statusEl.className = 'hf-cloud-status ' + (kind || 'idle');
    statusTextEl.textContent = text;
  }

  function setBusy(value, text) {
    working = !!value;
    syncBtn.disabled = working || !token;
    restoreBtn.disabled = working || !token;
    fullProjectBtn.disabled = working || !token;
    restoreProjectBtn.disabled = working || !token;
    modalSaveBtn.disabled = working;
    if (text) setStatus(value ? 'working' : 'ok', text);
  }

  function showModal() {
    tokenInput.value = token || '';
    rememberInput.checked = !!localStorage.getItem(TOKEN_LOCAL_KEY);
    modal.hidden = false;
    setTimeout(function () { tokenInput.focus(); }, 30);
  }

  function hideModal() {
    modal.hidden = true;
  }

  function encodePath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  function utf8ToBase64(text) {
    var bytes = new TextEncoder().encode(String(text));
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(binary);
  }

  function base64ToUtf8(base64) {
    var clean = String(base64 || '').replace(/\s/g, '');
    var binary = atob(clean);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function dataUrlBase64(dataUrl) {
    var comma = String(dataUrl || '').indexOf(',');
    return comma >= 0 ? String(dataUrl).slice(comma + 1).replace(/\s/g, '') : '';
  }

  function safeJsonParse(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
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

  function headers(extra) {
    var h = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token) h.Authorization = 'Bearer ' + token;
    Object.keys(extra || {}).forEach(function (key) { h[key] = extra[key]; });
    return h;
  }

  async function api(path, options) {
    var opts = options || {};
    opts.headers = headers(opts.headers || {});
    var response = await fetch(API + path, opts);
    var text = await response.text();
    var body = text ? safeJsonParse(text, text) : null;
    if (!response.ok) {
      var message = body && body.message ? body.message : ('GitHub respondeu ' + response.status);
      var error = new Error(message);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function enqueue(task) {
    writeQueue = writeQueue.then(task, task);
    return writeQueue;
  }

  function userRoot() {
    if (!cloudUser) throw new Error('Usuário do GitHub não identificado.');
    return 'users/' + cloudUser;
  }

  async function getFile(path) {
    try {
      var item = await api('/repos/' + OWNER + '/' + REPO + '/contents/' + encodePath(path) + '?ref=main');
      if (item && (!item.content || item.encoding === 'none') && item.sha) {
        var blob = await api('/repos/' + OWNER + '/' + REPO + '/git/blobs/' + item.sha);
        if (blob && blob.content) item.content = blob.content;
      }
      return item;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async function putBase64(path, base64Content, message) {
    return enqueue(async function () {
      var existing = await getFile(path);
      var payload = {
        message: message,
        content: String(base64Content || '').replace(/\s/g, ''),
        branch: 'main'
      };
      if (existing && existing.sha) payload.sha = existing.sha;
      return api('/repos/' + OWNER + '/' + REPO + '/contents/' + encodePath(path), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    });
  }

  function putText(path, text, message) {
    return putBase64(path, utf8ToBase64(text), message);
  }

  async function readJson(path, fallback) {
    var file = await getFile(path);
    if (!file || !file.content) return fallback;
    return safeJsonParse(base64ToUtf8(file.content), fallback);
  }

  function updateConnectedUi() {
    var connected = !!token && !!cloudUser;
    connectBtn.textContent = connected ? 'GitHub conectado' : 'Conectar GitHub';
    syncBtn.disabled = !connected || working;
    restoreBtn.disabled = !connected || working;
    fullProjectBtn.disabled = !connected || working;
    restoreProjectBtn.disabled = !connected || working;
    disconnectBtn.hidden = !connected;
    cloudUserEl.textContent = connected ? ('Conta: @' + cloudUser + ' · dados privados em ' + OWNER + '/' + REPO) : 'Nenhuma conta conectada';
    if (connected) setStatus('ok', 'Nuvem conectada como @' + cloudUser);
    else setStatus('idle', 'Galeria local');
  }

  async function connect(candidateToken, remember) {
    var previousToken = token;
    token = String(candidateToken || '').trim();
    if (!token) throw new Error('Informe um token do GitHub.');
    try {
      setBusy(true, 'Verificando acesso ao GitHub…');
      var me = await api('/user');
      await api('/repos/' + OWNER + '/' + REPO);
      cloudUser = me.login;
      if (remember) {
        localStorage.setItem(TOKEN_LOCAL_KEY, token);
        sessionStorage.removeItem(TOKEN_SESSION_KEY);
      } else {
        sessionStorage.setItem(TOKEN_SESSION_KEY, token);
        localStorage.removeItem(TOKEN_LOCAL_KEY);
      }
      localStorage.setItem(USER_KEY, cloudUser);
      updateConnectedUi();
      hideModal();
      var existing = await getFile(userRoot() + '/workspace.json');
      if (!existing) {
        await syncAll('Primeira sincronização');
      } else {
        setStatus('ok', 'Conectado. Use Restaurar para trazer os dados da nuvem.');
      }
    } catch (error) {
      token = previousToken;
      setStatus('error', 'Falha ao conectar: ' + error.message);
      throw error;
    } finally {
      setBusy(false);
      updateConnectedUi();
    }
  }

  function disconnect() {
    token = '';
    cloudUser = '';
    localStorage.removeItem(TOKEN_LOCAL_KEY);
    sessionStorage.removeItem(TOKEN_SESSION_KEY);
    localStorage.removeItem(USER_KEY);
    updateConnectedUi();
    hideModal();
  }

  function collectLocalPreferences() {
    var values = {};
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || key === GALLERY_KEY || key.indexOf(SETTINGS_PREFIX) !== 0) continue;
      values[key] = localStorage.getItem(key);
    }
    return values;
  }

  function collectWorkspacePayload() {
    var appSettings = null;
    try {
      if (appWin && typeof appWin.serializeAppSettings === 'function') appSettings = appWin.serializeAppSettings();
    } catch (_) {}
    return {
      schema: 'halftone-forge-project',
      version: 1,
      savedAt: new Date().toISOString(),
      appSettings: appSettings || {},
      gallery: null,
      userPresets: null,
      dtf: null,
      cloud: { user: cloudUser, repository: OWNER + '/' + REPO, kind: 'workspace-settings' }
    };
  }

  async function syncPreferences(reason) {
    var payload = {
      schema: 'halftone-forge-cloud-preferences',
      version: 1,
      savedAt: new Date().toISOString(),
      user: cloudUser,
      values: collectLocalPreferences()
    };
    await putText(userRoot() + '/preferences.json', JSON.stringify(payload, null, 2), reason + ': preferências');
  }

  async function syncWorkspace(reason) {
    var payload = collectWorkspacePayload();
    await putText(userRoot() + '/workspace.json', JSON.stringify(payload, null, 2), reason + ': configurações do projeto');
  }

  function localGalleryItems() {
    var raw = localStorage.getItem(GALLERY_KEY);
    var items = safeJsonParse(raw || '[]', []);
    return Array.isArray(items) ? items : [];
  }

  async function syncGallery(reason) {
    var items = localGalleryItems();
    var existingManifest = await readJson(userRoot() + '/gallery.json', { items: [] });
    var existingById = {};
    (existingManifest.items || []).forEach(function (item) { existingById[item.id] = item; });
    var metadata = [];

    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var id = String(item.id || ('g_' + Date.now() + '_' + i)).replace(/[^a-zA-Z0-9_-]/g, '_');
      var imagePath = userRoot() + '/gallery/' + id + '.png';
      if (item.dataUrl && (!existingById[id] || existingById[id].imageFingerprint !== stableFingerprint(item.dataUrl))) {
        await putBase64(imagePath, dataUrlBase64(item.dataUrl), reason + ': imagem ' + id);
      }
      metadata.push({
        id: id,
        title: item.title || 'Halftone',
        createdAt: item.createdAt || new Date().toISOString(),
        mode: item.mode || null,
        screenStyle: item.screenStyle || null,
        imagePath: imagePath,
        imageFingerprint: item.dataUrl ? stableFingerprint(item.dataUrl) : (existingById[id] && existingById[id].imageFingerprint) || null
      });
    }

    var manifest = {
      schema: 'halftone-forge-cloud-gallery',
      version: 1,
      savedAt: new Date().toISOString(),
      user: cloudUser,
      items: metadata
    };
    await putText(userRoot() + '/gallery.json', JSON.stringify(manifest, null, 2), reason + ': índice da galeria');
  }

  async function syncAll(reason) {
    if (!token || !cloudUser) { showModal(); return; }
    setBusy(true, 'Sincronizando imagens e configurações…');
    try {
      await syncGallery(reason || 'Sincronização manual');
      await syncPreferences(reason || 'Sincronização manual');
      await syncWorkspace(reason || 'Sincronização manual');
      lastGalleryFingerprint = stableFingerprint(localStorage.getItem(GALLERY_KEY) || '[]');
      lastSettingsFingerprint = currentSettingsFingerprint();
      lastSettingsWriteAt = Date.now();
      setStatus('ok', 'Tudo sincronizado no GitHub às ' + new Date().toLocaleTimeString('pt-BR'));
    } catch (error) {
      console.error(error);
      setStatus('error', 'Erro na sincronização: ' + error.message);
    } finally {
      setBusy(false);
      updateConnectedUi();
    }
  }

  async function restoreGallery() {
    var manifest = await readJson(userRoot() + '/gallery.json', { items: [] });
    var restored = [];
    for (var i = 0; i < (manifest.items || []).length; i++) {
      var meta = manifest.items[i];
      var file = await getFile(meta.imagePath);
      if (!file || !file.content) continue;
      restored.push({
        id: meta.id,
        title: meta.title,
        createdAt: meta.createdAt,
        mode: meta.mode,
        screenStyle: meta.screenStyle,
        dataUrl: 'data:image/png;base64,' + String(file.content).replace(/\s/g, '')
      });
    }
    localStorage.setItem(GALLERY_KEY, JSON.stringify(restored));
    if (appWin && typeof appWin.setGalleryItems === 'function') appWin.setGalleryItems(restored);
    if (appWin && typeof appWin.renderGallery === 'function') appWin.renderGallery();
  }

  async function restorePreferences() {
    var preferences = await readJson(userRoot() + '/preferences.json', null);
    if (!preferences || !preferences.values) return;
    Object.keys(preferences.values).forEach(function (key) {
      localStorage.setItem(key, preferences.values[key]);
    });
    try {
      var appSettingsRaw = localStorage.getItem('halftoneForgeAppSettingsV1');
      if (appSettingsRaw && appWin && appWin.appSettings) {
        Object.assign(appWin.appSettings, safeJsonParse(appSettingsRaw, {}));
        if (typeof appWin.applyAppSettings === 'function') appWin.applyAppSettings();
        if (typeof appWin.syncSettingsForm === 'function') appWin.syncSettingsForm();
      }
    } catch (_) {}
  }

  async function restoreWorkspace() {
    var workspace = await readJson(userRoot() + '/workspace.json', null);
    if (workspace && appWin && typeof appWin.loadProjectPayload === 'function') {
      await appWin.loadProjectPayload(workspace);
    }
  }

  async function restoreAll() {
    if (!token || !cloudUser) { showModal(); return; }
    if (!confirm('Restaurar a galeria e as configurações salvas no GitHub? As configurações atuais serão substituídas.')) return;
    setBusy(true, 'Restaurando dados da nuvem…');
    try {
      await restorePreferences();
      await restoreWorkspace();
      await restoreGallery();
      lastGalleryFingerprint = stableFingerprint(localStorage.getItem(GALLERY_KEY) || '[]');
      lastSettingsFingerprint = currentSettingsFingerprint();
      setStatus('ok', 'Dados restaurados do GitHub.');
    } catch (error) {
      console.error(error);
      setStatus('error', 'Erro ao restaurar: ' + error.message);
    } finally {
      setBusy(false);
      updateConnectedUi();
    }
  }

  async function saveFullProject() {
    if (!token || !cloudUser) { showModal(); return; }
    if (!appWin || typeof appWin.buildProjectPayload !== 'function') {
      setStatus('error', 'O projeto ainda não terminou de carregar.');
      return;
    }
    setBusy(true, 'Preparando projeto completo…');
    try {
      var project = appWin.buildProjectPayload();
      await putText(userRoot() + '/current-project.hfp', JSON.stringify(project), 'Salva projeto completo na nuvem');
      setStatus('ok', 'Projeto completo salvo no GitHub.');
    } catch (error) {
      console.error(error);
      setStatus('error', 'Erro ao salvar projeto completo: ' + error.message);
    } finally {
      setBusy(false);
      updateConnectedUi();
    }
  }

  async function restoreFullProject() {
    if (!token || !cloudUser) { showModal(); return; }
    if (!confirm('Abrir o projeto completo salvo no GitHub? O trabalho atual será substituído.')) return;
    setBusy(true, 'Baixando projeto completo…');
    try {
      var project = await readJson(userRoot() + '/current-project.hfp', null);
      if (!project) throw new Error('Nenhum projeto completo foi salvo ainda.');
      if (!appWin || typeof appWin.loadProjectPayload !== 'function') throw new Error('O aplicativo ainda não terminou de carregar.');
      await appWin.loadProjectPayload(project);
      setStatus('ok', 'Projeto completo restaurado.');
    } catch (error) {
      console.error(error);
      setStatus('error', 'Erro ao abrir projeto: ' + error.message);
    } finally {
      setBusy(false);
      updateConnectedUi();
    }
  }

  function currentSettingsFingerprint() {
    var payload = {
      prefs: collectLocalPreferences(),
      workspace: collectWorkspacePayload().appSettings
    };
    return stableFingerprint(payload);
  }

  function scheduleSettingsSync() {
    if (!token || !cloudUser) return;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(function () {
      var fingerprint = currentSettingsFingerprint();
      if (fingerprint === lastSettingsFingerprint) return;
      var elapsed = Date.now() - lastSettingsWriteAt;
      if (elapsed < 30000) {
        pendingSettingsAfterThrottle = true;
        clearTimeout(settingsTimer);
        settingsTimer = setTimeout(scheduleSettingsSync, 30000 - elapsed + 300);
        return;
      }
      pendingSettingsAfterThrottle = false;
      setStatus('working', 'Salvando configurações…');
      Promise.all([
        syncPreferences('Salvamento automático'),
        syncWorkspace('Salvamento automático')
      ]).then(function () {
        lastSettingsFingerprint = fingerprint;
        lastSettingsWriteAt = Date.now();
        setStatus('ok', 'Configurações salvas automaticamente.');
      }).catch(function (error) {
        console.error(error);
        setStatus('error', 'Falha ao salvar configurações: ' + error.message);
      });
    }, 5000);
  }

  function scheduleGallerySync() {
    if (!token || !cloudUser) return;
    clearTimeout(galleryTimer);
    galleryTimer = setTimeout(function () {
      var fingerprint = stableFingerprint(localStorage.getItem(GALLERY_KEY) || '[]');
      if (fingerprint === lastGalleryFingerprint) return;
      setStatus('working', 'Enviando imagem para a galeria privada…');
      syncGallery('Galeria automática').then(function () {
        lastGalleryFingerprint = fingerprint;
        setStatus('ok', 'Galeria salva no GitHub.');
      }).catch(function (error) {
        console.error(error);
        setStatus('error', 'Falha ao salvar galeria: ' + error.message);
      });
    }, 1200);
  }

  function attachAppHooks() {
    try {
      appWin = frame.contentWindow;
      appDoc = frame.contentDocument;
      if (!appWin || !appDoc) return;
      if (appDoc.documentElement && appDoc.documentElement.dataset.hfCloudAttached === '1') return;
      if (appDoc.documentElement) appDoc.documentElement.dataset.hfCloudAttached = '1';

      appDoc.addEventListener('input', scheduleSettingsSync, true);
      appDoc.addEventListener('change', scheduleSettingsSync, true);
      appDoc.addEventListener('click', function (event) {
        var target = event.target && event.target.closest ? event.target.closest('button') : null;
        if (!target) return;
        var galleryButtons = ['btnSaveGallery', 'btnSaveGalleryHeader', 'btnSaveGalleryQuick'];
        if (galleryButtons.indexOf(target.id) >= 0 || /salvar na galeria|salvar resultado atual/i.test(target.textContent || '')) {
          setTimeout(scheduleGallerySync, 350);
        }
      }, true);

      lastGalleryFingerprint = stableFingerprint(localStorage.getItem(GALLERY_KEY) || '[]');
      lastSettingsFingerprint = currentSettingsFingerprint();

      setInterval(function () {
        if (!token || !cloudUser) return;
        var galleryFingerprint = stableFingerprint(localStorage.getItem(GALLERY_KEY) || '[]');
        if (galleryFingerprint !== lastGalleryFingerprint) scheduleGallerySync();
        var settingsFingerprint = currentSettingsFingerprint();
        if (settingsFingerprint !== lastSettingsFingerprint) scheduleSettingsSync();
      }, 2500);
    } catch (error) {
      console.error('Não foi possível conectar o painel ao app:', error);
      setStatus('error', 'Falha ao iniciar sincronização.');
    }
  }

  connectBtn.addEventListener('click', showModal);
  syncBtn.addEventListener('click', function () { syncAll('Sincronização manual'); });
  restoreBtn.addEventListener('click', restoreAll);
  fullProjectBtn.addEventListener('click', saveFullProject);
  restoreProjectBtn.addEventListener('click', restoreFullProject);
  modalCloseBtn.addEventListener('click', hideModal);
  disconnectBtn.addEventListener('click', disconnect);
  modal.addEventListener('click', function (event) { if (event.target === modal) hideModal(); });
  modalSaveBtn.addEventListener('click', function () {
    connect(tokenInput.value, rememberInput.checked).catch(function (error) {
      alert('Não foi possível conectar: ' + error.message);
    });
  });
  tokenInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') modalSaveBtn.click();
  });
  frame.addEventListener('load', attachAppHooks);
  try {
    if (frame.contentDocument && frame.contentDocument.readyState === 'complete') setTimeout(attachAppHooks, 0);
  } catch (_) {}

  token = localStorage.getItem(TOKEN_LOCAL_KEY) || sessionStorage.getItem(TOKEN_SESSION_KEY) || '';
  cloudUser = localStorage.getItem(USER_KEY) || '';
  updateConnectedUi();
  if (token) {
    connect(token, !!localStorage.getItem(TOKEN_LOCAL_KEY)).catch(function () {
      disconnect();
      setStatus('error', 'A conexão expirou. Conecte novamente.');
    });
  }
}());
