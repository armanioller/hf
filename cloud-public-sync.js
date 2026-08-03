(function () {
  'use strict';

  var API_BASE = 'https://cloudflare-worker.armanioller.workers.dev';
  var CLIENT_ID_KEY = 'hfCloudClientIdV1';
  var AUTO_SAVE_KEY = 'hfCloudAutoSaveV1';
  var GALLERY_KEY = 'halftoneForgeGallery';
  var SETTINGS_PREFIX = 'halftoneForge';
  var UPLOADED_IMAGES_KEY = 'hfCloudUploadedImagesV1';
  var UPLOADED_MUSIC_KEY = 'hfCloudUploadedMusicV1';

  var frame = document.getElementById('hfAppFrame');
  var clientId = getClientId();
  var appWin = null;
  var appDoc = null;
  var busy = false;
  var cloudAvailable = false;
  var queue = Promise.resolve();
  var galleryTimer = 0;
  var settingsTimer = 0;
  var musicTimer = 0;
  var musicChecking = false;
  var monitoringStarted = false;
  var lastGalleryFingerprint = '';
  var lastSettingsFingerprint = '';
  var lastMusicFingerprint = '';
  var statusText = 'Conectando à nuvem…';
  var statusKind = 'idle';
  var lastSavedAt = '';

  var autoSaveInput = null;
  var saveNowBtn = null;
  var restoreBtn = null;
  var cloudStatusEl = null;
  var cloudLastSaveEl = null;

  localStorage.removeItem('hfCloudToken');
  sessionStorage.removeItem('hfCloudTokenSession');
  localStorage.removeItem('hfCloudUser');

  function getClientId() {
    var current = localStorage.getItem(CLIENT_ID_KEY);
    if (current && /^[a-zA-Z0-9_-]{16,80}$/.test(current)) return current;
    var id = '';
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      id = window.crypto.randomUUID().replace(/-/g, '');
    }
    if (!id) {
      var bytes = new Uint8Array(24);
      window.crypto.getRandomValues(bytes);
      id = Array.prototype.map.call(bytes, function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    }
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  }

  function autoSaveEnabled() {
    return localStorage.getItem(AUTO_SAVE_KEY) !== 'false';
  }

  function setAutoSaveEnabled(value) {
    localStorage.setItem(AUTO_SAVE_KEY, value ? 'true' : 'false');
    if (autoSaveInput) autoSaveInput.checked = !!value;
    if (!value) {
      clearTimeout(galleryTimer);
      clearTimeout(settingsTimer);
      clearTimeout(musicTimer);
      setStatus('idle', 'Salvamento automático desativado');
    } else if (cloudAvailable) {
      setStatus('ok', 'Nuvem ativa · salvamento automático ligado');
    }
  }

  function notify(message, isError) {
    try {
      if (appWin && typeof appWin.showToast === 'function') appWin.showToast(message, !!isError);
    } catch (_) {}
  }

  function setStatus(kind, text) {
    statusKind = kind || 'idle';
    statusText = text || '';
    if (cloudStatusEl) {
      cloudStatusEl.className = 'hf-cloud-settings-status ' + statusKind;
      cloudStatusEl.textContent = statusText;
    }
    updateSettingsButtons();
  }

  function setLastSavedNow() {
    lastSavedAt = new Date().toLocaleString('pt-BR');
    if (cloudLastSaveEl) cloudLastSaveEl.textContent = 'Último salvamento: ' + lastSavedAt;
  }

  function setBusy(value, text) {
    busy = !!value;
    if (text) setStatus(value ? 'working' : 'ok', text);
    updateSettingsButtons();
  }

  function updateSettingsButtons() {
    if (saveNowBtn) saveNowBtn.disabled = busy || !cloudAvailable;
    if (restoreBtn) restoreBtn.disabled = busy || !cloudAvailable;
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
    if (!response.ok) {
      throw new Error(body && body.error ? body.error : ('Servidor respondeu ' + response.status));
    }
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
    var parsed = safeJsonParse(localStorage.getItem(GALLERY_KEY) || '[]', []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function collectPreferences() {
    var values = {};
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || key === GALLERY_KEY || key === CLIENT_ID_KEY || key === UPLOADED_IMAGES_KEY || key === UPLOADED_MUSIC_KEY) continue;
      if (key.indexOf(SETTINGS_PREFIX) === 0 || key === AUTO_SAVE_KEY) values[key] = localStorage.getItem(key);
    }
    return {
      schema: 'halftone-forge-cloud-preferences',
      version: 2,
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
      version: 2,
      savedAt: new Date().toISOString(),
      appSettings: settings,
      gallery: null,
      userPresets: null,
      dtf: null,
      cloud: { clientId: clientId, backend: API_BASE, autoSave: autoSaveEnabled() }
    };
  }

  function storedMap(key) {
    var map = safeJsonParse(localStorage.getItem(key) || '{}', {});
    return map && typeof map === 'object' ? map : {};
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var value = String(reader.result || '');
        var comma = value.indexOf(',');
        resolve(comma >= 0 ? value.slice(comma + 1).replace(/\s/g, '') : '');
      };
      reader.onerror = function () { reject(reader.error || new Error('Falha ao ler arquivo.')); };
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlFromBlob(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function localMusicRecords() {
    try {
      if (appWin && typeof appWin.musicDbAll === 'function') {
        var records = await appWin.musicDbAll();
        return Array.isArray(records) ? records : [];
      }
    } catch (_) {}
    return [];
  }

  async function musicFingerprint() {
    var records = await localMusicRecords();
    return stableFingerprint(records.map(function (record) {
      return {
        id: record.id,
        name: record.name,
        type: record.type,
        size: record.blob ? record.blob.size : 0,
        addedAt: record.addedAt || 0
      };
    }));
  }

  async function syncGallery(reason) {
    var items = localGalleryItems();
    var uploaded = storedMap(UPLOADED_IMAGES_KEY);
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
        localStorage.setItem(UPLOADED_IMAGES_KEY, JSON.stringify(uploaded));
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
      version: 2,
      savedAt: new Date().toISOString(),
      reason: reason || 'automático',
      items: metadata
    });
  }

  async function syncMusic(reason) {
    var records = await localMusicRecords();
    var uploaded = storedMap(UPLOADED_MUSIC_KEY);
    var metadata = [];

    for (var i = 0; i < records.length; i++) {
      var record = records[i] || {};
      if (!record.blob) continue;
      var id = String(record.id || ('m_' + Date.now() + '_' + i)).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
      var fp = stableFingerprint({
        name: record.name || 'Faixa',
        type: record.type || record.blob.type || 'audio/mpeg',
        size: record.blob.size || 0,
        addedAt: record.addedAt || 0
      });
      if (uploaded[id] !== fp) {
        await postSave('audio', null, { id: id, base64: await blobToBase64(record.blob) });
        uploaded[id] = fp;
        localStorage.setItem(UPLOADED_MUSIC_KEY, JSON.stringify(uploaded));
      }
      metadata.push({
        id: id,
        name: record.name || 'Faixa',
        type: record.type || record.blob.type || 'audio/mpeg',
        size: record.blob.size || 0,
        addedAt: record.addedAt || Date.now()
      });
    }

    await postSave('music', {
      schema: 'halftone-forge-cloud-music',
      version: 2,
      savedAt: new Date().toISOString(),
      reason: reason || 'automático',
      tracks: metadata
    });
    lastMusicFingerprint = await musicFingerprint();
  }

  async function syncSettings() {
    await postSave('preferences', collectPreferences());
    await postSave('workspace', collectWorkspace());
    lastSettingsFingerprint = currentSettingsFingerprint();
  }

  async function syncAll(reason, manual) {
    if (busy || !cloudAvailable) return;
    setBusy(true, 'Salvando imagens, músicas e configurações…');
    try {
      await syncGallery(reason || 'manual');
      await syncMusic(reason || 'manual');
      await syncSettings();
      lastGalleryFingerprint = currentGalleryFingerprint();
      lastMusicFingerprint = await musicFingerprint();
      setLastSavedNow();
      setStatus('ok', 'Tudo salvo na nuvem');
      if (manual) notify('Imagens, músicas e configurações salvas na nuvem.');
    } catch (error) {
      console.error(error);
      setStatus('error', 'Erro ao salvar: ' + error.message);
      if (manual) notify('Erro ao salvar na nuvem: ' + error.message, true);
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
    return stableFingerprint({
      preferences: collectPreferences().values,
      workspace: collectWorkspace().appSettings
    });
  }

  function scheduleGallerySave() {
    if (!autoSaveEnabled()) return;
    clearTimeout(galleryTimer);
    galleryTimer = setTimeout(function () { syncAll('galeria', false); }, 1200);
  }

  function scheduleSettingsSave() {
    if (!autoSaveEnabled()) return;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(function () {
      if (busy || !cloudAvailable) return;
      syncSettings().then(function () {
        setLastSavedNow();
        setStatus('ok', 'Configurações salvas automaticamente');
      }).catch(function (error) {
        console.error(error);
        setStatus('error', 'Erro ao salvar configurações: ' + error.message);
      });
    }, 2800);
  }

  function scheduleMusicSave() {
    if (!autoSaveEnabled()) return;
    clearTimeout(musicTimer);
    musicTimer = setTimeout(function () {
      if (busy || !cloudAvailable) return;
      setStatus('working', 'Salvando biblioteca musical…');
      syncMusic('música').then(function () {
        setLastSavedNow();
        setStatus('ok', 'Músicas salvas automaticamente');
      }).catch(function (error) {
        console.error(error);
        setStatus('error', 'Erro ao salvar músicas: ' + error.message);
      });
    }, 1600);
  }

  async function restoreAll() {
    if (busy || !cloudAvailable) return;
    if (!confirm('Restaurar galeria, músicas e configurações salvas na nuvem para este navegador?')) return;
    setBusy(true, 'Restaurando dados da nuvem…');
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
          var imageResponse = await fetch(API_BASE + '/api/image?clientId=' + encodeURIComponent(clientId) + '&id=' + encodeURIComponent(meta.id));
          if (!imageResponse.ok) continue;
          restored.push({
            id: meta.id,
            title: meta.title,
            createdAt: meta.createdAt,
            mode: meta.mode,
            screenStyle: meta.screenStyle,
            dataUrl: await dataUrlFromBlob(await imageResponse.blob())
          });
        }
        localStorage.setItem(GALLERY_KEY, JSON.stringify(restored));
        if (appWin && typeof appWin.setGalleryItems === 'function') appWin.setGalleryItems(restored);
        if (appWin && typeof appWin.renderGallery === 'function') appWin.renderGallery();
      }

      var musicResult = await loadKind('music');
      if (musicResult.found && musicResult.data && Array.isArray(musicResult.data.tracks) && appWin) {
        if (typeof appWin.musicDbClear === 'function') await appWin.musicDbClear();
        var restoredMusicMap = {};
        for (var j = 0; j < musicResult.data.tracks.length; j++) {
          var track = musicResult.data.tracks[j];
          var audioResponse = await fetch(API_BASE + '/api/audio?clientId=' + encodeURIComponent(clientId) + '&id=' + encodeURIComponent(track.id));
          if (!audioResponse.ok) continue;
          var audioBlob = new Blob([await audioResponse.arrayBuffer()], { type: track.type || 'audio/mpeg' });
          if (typeof appWin.musicDbAdd === 'function') {
            await appWin.musicDbAdd({
              name: track.name || 'Faixa',
              type: track.type || 'audio/mpeg',
              blob: audioBlob,
              addedAt: track.addedAt || Date.now()
            });
          }
          restoredMusicMap[String(track.id)] = stableFingerprint({
            name: track.name || 'Faixa',
            type: track.type || 'audio/mpeg',
            size: audioBlob.size,
            addedAt: track.addedAt || 0
          });
        }
        localStorage.setItem(UPLOADED_MUSIC_KEY, JSON.stringify(restoredMusicMap));
        if (typeof appWin.loadMusicLibrary === 'function') await appWin.loadMusicLibrary();
      }

      setAutoSaveEnabled(autoSaveEnabled());
      lastGalleryFingerprint = currentGalleryFingerprint();
      lastSettingsFingerprint = currentSettingsFingerprint();
      lastMusicFingerprint = await musicFingerprint();
      setStatus('ok', 'Galeria, músicas e configurações restauradas');
      notify('Dados restaurados da nuvem.');
    } catch (error) {
      console.error(error);
      setStatus('error', 'Erro ao restaurar: ' + error.message);
      notify('Erro ao restaurar da nuvem: ' + error.message, true);
    } finally {
      setBusy(false);
    }
  }

  function injectCloudStyles() {
    if (!appDoc || appDoc.getElementById('hfCloudSettingsStyles')) return;
    var style = appDoc.createElement('style');
    style.id = 'hfCloudSettingsStyles';
    style.textContent = [
      '.hf-cloud-settings-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}',
      '.hf-cloud-settings-status{display:inline-flex;align-items:center;gap:7px;color:var(--text-dim);font:10px/1.35 var(--font-mono)}',
      '.hf-cloud-settings-status:before{content:"";width:8px;height:8px;border-radius:50%;background:#6d6d76;flex:none}',
      '.hf-cloud-settings-status.ok:before{background:#2ed6a1}',
      '.hf-cloud-settings-status.working:before{background:#ffb347;box-shadow:0 0 0 3px rgba(255,179,71,.13)}',
      '.hf-cloud-settings-status.error:before{background:#ff5d5d}',
      '.hf-cloud-settings-meta{margin-left:auto;align-self:center;color:var(--text-dim);font:9px/1.3 var(--font-mono)}',
      '@media(max-width:720px){.hf-cloud-settings-meta{width:100%;margin-left:0}}'
    ].join('\n');
    appDoc.head.appendChild(style);
  }

  function injectSettingsPanel() {
    if (!appDoc) return false;
    var existing = appDoc.getElementById('hfCloudSettingsCard');
    if (existing) return true;
    var grid = appDoc.querySelector('#settingsOverlay .settings-grid');
    if (!grid) return false;

    var card = appDoc.createElement('section');
    card.className = 'settings-card settings-card-wide';
    card.id = 'hfCloudSettingsCard';
    card.innerHTML = '' +
      '<h3>Nuvem e backup</h3>' +
      '<div class="settings-row">' +
        '<div class="settings-copy"><div class="settings-label">Salvar automaticamente na nuvem</div><div class="settings-desc">Quando ativado, alterações na galeria, músicas e configurações são enviadas automaticamente para o backup privado.</div></div>' +
        '<div class="settings-control"><input aria-label="Salvar automaticamente na nuvem" id="settingCloudAutoSave" type="checkbox"></div>' +
      '</div>' +
      '<div class="settings-row">' +
        '<div class="settings-copy"><div class="settings-label">Status da nuvem</div><div class="settings-desc">O salvamento usa um identificador anônimo deste navegador. Nenhuma conta GitHub é solicitada ao usuário.</div></div>' +
        '<div class="settings-control"><span class="hf-cloud-settings-status idle" id="hfCloudSettingsStatus">Conectando…</span></div>' +
      '</div>' +
      '<div class="hf-cloud-settings-actions">' +
        '<button class="btn btn-primary" id="btnCloudSaveNow" type="button">Salvar agora</button>' +
        '<button class="btn btn-ghost" id="btnCloudRestore" type="button">Restaurar da nuvem</button>' +
        '<span class="hf-cloud-settings-meta" id="hfCloudLastSave">Nenhum salvamento nesta sessão</span>' +
      '</div>';

    var musicCard = appDoc.querySelector('#settingsOverlay .music-library');
    var targetCard = musicCard ? musicCard.closest('.settings-card') : null;
    if (targetCard && targetCard.parentNode === grid) grid.insertBefore(card, targetCard);
    else grid.appendChild(card);

    autoSaveInput = appDoc.getElementById('settingCloudAutoSave');
    saveNowBtn = appDoc.getElementById('btnCloudSaveNow');
    restoreBtn = appDoc.getElementById('btnCloudRestore');
    cloudStatusEl = appDoc.getElementById('hfCloudSettingsStatus');
    cloudLastSaveEl = appDoc.getElementById('hfCloudLastSave');

    autoSaveInput.checked = autoSaveEnabled();
    autoSaveInput.addEventListener('change', function () {
      setAutoSaveEnabled(autoSaveInput.checked);
      if (autoSaveInput.checked && cloudAvailable) syncAll('ativação do salvamento automático', false);
    });
    saveNowBtn.addEventListener('click', function () { syncAll('manual', true); });
    restoreBtn.addEventListener('click', restoreAll);

    setStatus(statusKind, statusText);
    if (lastSavedAt) cloudLastSaveEl.textContent = 'Último salvamento: ' + lastSavedAt;
    updateSettingsButtons();
    return true;
  }

  function injectDocumentation() {
    if (!appDoc) return;
    var toc = appDoc.querySelector('#docsOverlay .docs-toc');
    var configSection = appDoc.getElementById('docs-config-musica');
    var modeSection = appDoc.getElementById('docs-modo');

    if (toc && !toc.querySelector('a[href="#docs-nuvem"]')) {
      var link = appDoc.createElement('a');
      link.className = 'docs-toc-link';
      link.href = '#docs-nuvem';
      link.textContent = 'Nuvem e backup';
      var configLink = toc.querySelector('a[href="#docs-config-musica"]');
      if (configLink && configLink.nextSibling) toc.insertBefore(link, configLink.nextSibling);
      else toc.appendChild(link);
      link.addEventListener('click', function (event) {
        event.preventDefault();
        var target = appDoc.getElementById('docs-nuvem');
        var content = appDoc.getElementById('docsContent');
        Array.prototype.forEach.call(appDoc.querySelectorAll('.docs-toc-link'), function (item) {
          item.classList.toggle('active', item === link);
        });
        if (target && content) content.scrollTo({ top: Math.max(0, target.offsetTop - 12), behavior: 'smooth' });
      });
    }

    if (configSection && !configSection.dataset.cloudDocsUpdated) {
      configSection.dataset.cloudDocsUpdated = '1';
      configSection.innerHTML = '' +
        '<h2>Configurações gerais e música</h2>' +
        '<p>O botão de engrenagem reúne preferências da interface, biblioteca musical e controles do backup em nuvem.</p>' +
        '<h3>Interface</h3>' +
        '<p>É possível alternar entre densidade compacta e confortável, trocar a cor de destaque e reduzir animações. Essas preferências ficam no navegador e também entram no backup quando o salvamento em nuvem está ativo.</p>' +
        '<h3>Player de inspiração</h3>' +
        '<ul>' +
          '<li>Ative o player e importe arquivos de áudio do computador.</li>' +
          '<li>As faixas ficam no IndexedDB do navegador para reprodução rápida e também são enviadas ao backup privado quando a nuvem está ativa.</li>' +
          '<li>O player no topo permite voltar, reproduzir ou pausar, avançar, buscar no tempo e controlar o volume.</li>' +
          '<li>Volume, embaralhamento, repetição e ativação do player fazem parte das configurações sincronizadas.</li>' +
        '</ul>' +
        '<div class="docs-tip"><strong>Reprodução automática:</strong> a primeira reprodução pode exigir um clique por política do navegador.</div>';
    }

    if (!appDoc.getElementById('docs-nuvem')) {
      var section = appDoc.createElement('section');
      section.id = 'docs-nuvem';
      section.innerHTML = '' +
        '<h2>Nuvem e backup</h2>' +
        '<p>Os controles de nuvem ficam em <code>Configurações gerais</code>. Não existe mais uma barra fixa sobre a área de trabalho.</p>' +
        '<h3>Salvar automaticamente</h3>' +
        '<p>Ative <code>Salvar automaticamente na nuvem</code> para enviar alterações após um curto período sem novas mudanças. Desativar essa opção mantém os dados somente no navegador até que o botão manual seja usado.</p>' +
        '<h3>Salvar agora</h3>' +
        '<p>O botão <code>Salvar agora</code> envia imediatamente galeria, músicas, preferências da interface e configurações do projeto.</p>' +
        '<h3>Restaurar da nuvem</h3>' +
        '<p>O botão <code>Restaurar da nuvem</code> substitui os dados locais pelos arquivos salvos para este navegador.</p>' +
        '<h3>O que é armazenado</h3>' +
        '<ul>' +
          '<li>Imagens e metadados da galeria.</li>' +
          '<li>Biblioteca musical importada.</li>' +
          '<li>Preferências gerais, tema, player e parâmetros do app.</li>' +
          '<li>Configurações atuais do projeto e do efeito halftone.</li>' +
        '</ul>' +
        '<h3>Privacidade e identificação</h3>' +
        '<p>Cada navegador recebe um identificador anônimo. O visitante não conecta uma conta GitHub e não recebe acesso ao repositório. A credencial do proprietário permanece protegida no Worker da Cloudflare.</p>' +
        '<div class="docs-tip"><strong>Importante:</strong> limpar os dados do navegador pode gerar um novo identificador. Nesse caso, os backups antigos continuam no repositório, mas não aparecem automaticamente para o novo identificador.</div>';
      if (modeSection && modeSection.parentNode) modeSection.parentNode.insertBefore(section, modeSection);
      else if (configSection && configSection.parentNode) configSection.parentNode.appendChild(section);
    }

    var settingsSub = appDoc.querySelector('#settingsOverlay .studio-modal-sub');
    var settingsKicker = appDoc.querySelector('#settingsOverlay .studio-modal-kicker');
    if (settingsSub) settingsSub.textContent = 'Ajustes da interface, música e backup em nuvem.';
    if (settingsKicker) settingsKicker.textContent = 'Preferências e nuvem';
  }

  async function checkHealth() {
    try {
      var result = await api('/health');
      if (!result || !result.ok) throw new Error('Serviço indisponível');
      cloudAvailable = true;
      setStatus('ok', autoSaveEnabled() ? 'Nuvem ativa · salvamento automático ligado' : 'Nuvem ativa · salvamento automático desligado');
    } catch (error) {
      cloudAvailable = false;
      setStatus('error', 'Nuvem indisponível');
    }
    updateSettingsButtons();
  }

  async function checkMusicChanges() {
    if (musicChecking || busy || !autoSaveEnabled()) return;
    musicChecking = true;
    try {
      var fp = await musicFingerprint();
      if (fp !== lastMusicFingerprint) {
        lastMusicFingerprint = fp;
        scheduleMusicSave();
      }
    } finally {
      musicChecking = false;
    }
  }

  function beginMonitoring() {
    if (monitoringStarted) return;
    monitoringStarted = true;
    lastGalleryFingerprint = currentGalleryFingerprint();
    lastSettingsFingerprint = currentSettingsFingerprint();
    musicFingerprint().then(function (fp) { lastMusicFingerprint = fp; });

    setInterval(function () {
      if (busy || !autoSaveEnabled()) return;
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

    setInterval(checkMusicChanges, 3000);
  }

  function initializeInsideApp() {
    try {
      appWin = frame.contentWindow;
      appDoc = frame.contentDocument;
    } catch (_) {
      appWin = null;
      appDoc = null;
    }
    if (!appDoc) return;
    injectCloudStyles();
    injectSettingsPanel();
    injectDocumentation();
    beginMonitoring();
  }

  frame.addEventListener('load', function () {
    setTimeout(initializeInsideApp, 250);
    setTimeout(initializeInsideApp, 1200);
  });

  checkHealth();
})();
