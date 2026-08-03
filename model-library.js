(function () {
  'use strict';

  var API_BASE = 'https://cloudflare-worker.armanioller.workers.dev';
  var ADMIN_SESSION_KEY = 'hfModelAdminKeyV1';
  var frame = document.getElementById('hfAppFrame');
  var appDoc = null;
  var appWin = null;
  var initializedDocument = null;
  var models = [];

  function safeText(value) {
    return String(value == null ? '' : value);
  }

  function adminModeRequested() {
    try {
      return new URL(window.location.href).searchParams.get('admin') === 'armanioller';
    } catch (_) {
      return false;
    }
  }

  async function api(path, options) {
    var response = await fetch(API_BASE + path, options || {});
    var text = await response.text();
    var body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
    if (!response.ok) {
      throw new Error(body && body.error ? body.error : ('Servidor respondeu ' + response.status));
    }
    return body;
  }

  function setLibraryStatus(text, kind) {
    if (!appDoc) return;
    var el = appDoc.getElementById('hfModelLibraryStatus');
    if (!el) return;
    el.className = 'hf-model-library-status ' + (kind || '');
    el.textContent = text || '';
  }

  function setAdminStatus(text, kind) {
    if (!appDoc) return;
    var el = appDoc.getElementById('hfModelAdminStatus');
    if (!el) return;
    el.className = 'hf-model-admin-status ' + (kind || '');
    el.textContent = text || '';
  }

  function injectStyles() {
    if (!appDoc || appDoc.getElementById('hfModelLibraryStyle')) return;
    var style = appDoc.createElement('style');
    style.id = 'hfModelLibraryStyle';
    style.textContent = [
      '.hf-model-library-list{display:flex;flex-direction:column;gap:7px;margin-top:8px}',
      '.hf-model-library-empty{padding:11px;border:1px dashed var(--line);border-radius:9px;color:var(--text-dim);font-size:10px;line-height:1.45}',
      '.hf-model-card{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(255,255,255,.025)}',
      '.hf-model-card-copy{min-width:0}',
      '.hf-model-card-name{font-size:11px;font-weight:700;color:var(--text)}',
      '.hf-model-card-desc{margin-top:3px;color:var(--text-dim);font-size:9.5px;line-height:1.35}',
      '.hf-model-card-meta{margin-top:4px;color:var(--text-dim);font:8.5px/1.3 var(--font-mono)}',
      '.hf-model-card .btn{white-space:nowrap}',
      '.hf-model-library-status,.hf-model-admin-status{margin-top:7px;color:var(--text-dim);font:9px/1.4 var(--font-mono)}',
      '.hf-model-library-status.error,.hf-model-admin-status.error{color:var(--danger)}',
      '.hf-model-library-status.ok,.hf-model-admin-status.ok{color:var(--success)}',
      '.hf-model-admin{margin-top:8px;padding-top:8px;border-top:1px solid var(--line)}',
      '.hf-model-admin-grid{display:grid;grid-template-columns:1fr;gap:7px}',
      '.hf-model-admin input,.hf-model-admin textarea{width:100%;min-height:34px;padding:8px;border:1px solid var(--line);border-radius:8px;background:#111218;color:var(--text);font:10px/1.35 var(--font-ui)}',
      '.hf-model-admin textarea{min-height:58px;resize:vertical}',
      '.hf-model-admin-actions{display:flex;gap:7px;flex-wrap:wrap}',
      '.hf-model-admin-note{color:var(--text-dim);font-size:9.5px;line-height:1.4}'
    ].join('\n');
    appDoc.head.appendChild(style);
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1048576) return (value / 1024).toFixed(1) + ' KB';
    return (value / 1048576).toFixed(2) + ' MB';
  }

  function dispatchModelFile(file) {
    var input = appDoc && appDoc.getElementById('mockupModelInput');
    if (!input) throw new Error('Campo de modelo não encontrado.');
    var transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function openModel(model, button) {
    if (!model || !model.id) return;
    var oldText = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Carregando…';
    }
    setLibraryStatus('Baixando ' + safeText(model.name || model.id) + '…');
    try {
      var response = await fetch(API_BASE + '/api/model?id=' + encodeURIComponent(model.id));
      if (!response.ok) {
        var message = 'Não foi possível baixar o modelo.';
        try {
          var err = await response.json();
          if (err && err.error) message = err.error;
        } catch (_) {}
        throw new Error(message);
      }
      var blob = await response.blob();
      var filename = safeText(model.filename || (model.id + '.glb'));
      var file = new File([blob], filename, {
        type: 'model/gltf-binary',
        lastModified: Date.now()
      });
      dispatchModelFile(file);
      setLibraryStatus('Modelo padrão carregado: ' + safeText(model.name || filename), 'ok');
    } catch (error) {
      console.error(error);
      setLibraryStatus('Erro: ' + error.message, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText || 'Usar';
      }
    }
  }

  function renderModels() {
    if (!appDoc) return;
    var list = appDoc.getElementById('hfModelLibraryList');
    if (!list) return;
    list.innerHTML = '';

    if (!models.length) {
      var empty = appDoc.createElement('div');
      empty.className = 'hf-model-library-empty';
      empty.textContent = 'Nenhum modelo padrão publicado ainda. O botão “Carregar modelo GLB” continua disponível para arquivos do computador.';
      list.appendChild(empty);
      return;
    }

    models.forEach(function (model) {
      var card = appDoc.createElement('div');
      card.className = 'hf-model-card';

      var copy = appDoc.createElement('div');
      copy.className = 'hf-model-card-copy';

      var name = appDoc.createElement('div');
      name.className = 'hf-model-card-name';
      name.textContent = safeText(model.name || model.id);

      var desc = appDoc.createElement('div');
      desc.className = 'hf-model-card-desc';
      desc.textContent = safeText(model.description || 'Modelo 3D padrão do Halftone Forge.');

      var meta = appDoc.createElement('div');
      meta.className = 'hf-model-card-meta';
      meta.textContent = [safeText(model.filename || (model.id + '.glb')), formatBytes(model.sizeBytes)].filter(Boolean).join(' · ');

      copy.appendChild(name);
      copy.appendChild(desc);
      copy.appendChild(meta);

      var use = appDoc.createElement('button');
      use.type = 'button';
      use.className = 'btn btn-ghost';
      use.textContent = 'Usar';
      use.addEventListener('click', function () { openModel(model, use); });

      card.appendChild(copy);
      card.appendChild(use);
      list.appendChild(card);
    });
  }

  async function refreshModels() {
    setLibraryStatus('Atualizando biblioteca…');
    try {
      var result = await api('/api/models');
      models = result && Array.isArray(result.models) ? result.models : [];
      renderModels();
      setLibraryStatus(models.length ? (models.length + ' modelo(s) padrão disponível(is).') : 'Biblioteca pronta para receber modelos.', 'ok');
    } catch (error) {
      console.error(error);
      models = [];
      renderModels();
      setLibraryStatus('Não foi possível carregar a biblioteca: ' + error.message, 'error');
    }
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var value = String(reader.result || '');
        var comma = value.indexOf(',');
        resolve(comma >= 0 ? value.slice(comma + 1).replace(/\s/g, '') : '');
      };
      reader.onerror = function () { reject(reader.error || new Error('Falha ao ler o GLB.')); };
      reader.readAsDataURL(file);
    });
  }

  async function uploadAdminModel() {
    var keyInput = appDoc.getElementById('hfModelAdminKey');
    var nameInput = appDoc.getElementById('hfModelAdminName');
    var descInput = appDoc.getElementById('hfModelAdminDescription');
    var fileInput = appDoc.getElementById('hfModelAdminFile');
    var uploadBtn = appDoc.getElementById('hfModelAdminUpload');
    var key = String(keyInput && keyInput.value || sessionStorage.getItem(ADMIN_SESSION_KEY) || '').trim();
    var file = fileInput && fileInput.files && fileInput.files[0];

    if (!key) {
      setAdminStatus('Digite a chave administrativa.', 'error');
      return;
    }
    if (!file || !/\.glb$/i.test(file.name)) {
      setAdminStatus('Selecione um arquivo .GLB.', 'error');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setAdminStatus('O modelo deve ter no máximo 30 MB.', 'error');
      return;
    }

    sessionStorage.setItem(ADMIN_SESSION_KEY, key);
    uploadBtn.disabled = true;
    setAdminStatus('Enviando modelo para a biblioteca…');

    try {
      var baseName = file.name.replace(/\.glb$/i, '');
      var id = baseName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
      if (!id) id = 'modelo-' + Date.now();

      await api('/api/admin/model', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': key
        },
        body: JSON.stringify({
          id: id,
          name: String(nameInput && nameInput.value || baseName).trim() || baseName,
          description: String(descInput && descInput.value || '').trim(),
          filename: file.name,
          sizeBytes: file.size,
          base64: await fileToBase64(file)
        })
      });

      if (fileInput) fileInput.value = '';
      if (nameInput) nameInput.value = '';
      if (descInput) descInput.value = '';
      setAdminStatus('Modelo publicado com sucesso.', 'ok');
      await refreshModels();
    } catch (error) {
      console.error(error);
      setAdminStatus('Falha ao publicar: ' + error.message, 'error');
    } finally {
      uploadBtn.disabled = false;
    }
  }

  function injectAdminPanel(container) {
    if (!adminModeRequested() || appDoc.getElementById('hfModelAdminPanel')) return;

    var admin = appDoc.createElement('div');
    admin.className = 'hf-model-admin';
    admin.id = 'hfModelAdminPanel';
    admin.innerHTML = '' +
      '<div class="panel-label">Administrador · Armanioller</div>' +
      '<div class="hf-model-admin-grid">' +
        '<input id="hfModelAdminKey" type="password" autocomplete="off" placeholder="Chave administrativa da Cloudflare">' +
        '<input id="hfModelAdminName" type="text" maxlength="100" placeholder="Nome exibido do modelo">' +
        '<textarea id="hfModelAdminDescription" maxlength="300" placeholder="Descrição curta"></textarea>' +
        '<input id="hfModelAdminFile" type="file" accept=".glb,model/gltf-binary">' +
        '<div class="hf-model-admin-actions"><button class="btn btn-primary" id="hfModelAdminUpload" type="button">Publicar modelo padrão</button></div>' +
        '<div class="hf-model-admin-note">A chave não fica no código público. Ela é enviada somente ao Worker e permanece nesta aba durante a sessão.</div>' +
        '<div class="hf-model-admin-status" id="hfModelAdminStatus"></div>' +
      '</div>';

    container.appendChild(admin);

    var saved = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (saved) appDoc.getElementById('hfModelAdminKey').value = saved;
    appDoc.getElementById('hfModelAdminUpload').addEventListener('click', uploadAdminModel);
  }

  function injectLibrary() {
    if (!appDoc || appDoc.getElementById('hfModelLibraryPanel')) return true;
    var loadButton = appDoc.getElementById('btnMockupLoadModel');
    var sourceGroup = loadButton && loadButton.closest('.panel-group');
    if (!sourceGroup || !sourceGroup.parentNode) return false;

    var panel = appDoc.createElement('div');
    panel.className = 'panel-group';
    panel.id = 'hfModelLibraryPanel';
    panel.innerHTML = '' +
      '<div class="panel-label">Modelos padrão</div>' +
      '<div class="mockup3d-panel-note">Escolha um modelo publicado pelo administrador ou use “Carregar modelo GLB” para importar o seu próprio arquivo.</div>' +
      '<div class="hf-model-library-list" id="hfModelLibraryList"></div>' +
      '<div class="hf-model-library-status" id="hfModelLibraryStatus">Conectando à biblioteca…</div>';

    sourceGroup.parentNode.insertBefore(panel, sourceGroup.nextSibling);
    injectAdminPanel(panel);
    refreshModels();
    return true;
  }

  function updateDocumentation() {
    if (!appDoc || appDoc.getElementById('docs-modelos-3d')) return;
    var docsContent = appDoc.getElementById('docsContent');
    var faq = appDoc.getElementById('docs-faq');
    if (!docsContent) return;

    var section = appDoc.createElement('section');
    section.id = 'docs-modelos-3d';
    section.innerHTML = '' +
      '<h2>Modelos 3D padrão</h2>' +
      '<p>No módulo <code>Mockup 3D</code>, a área <code>Modelos padrão</code> apresenta os modelos publicados pelo administrador.</p>' +
      '<ul>' +
        '<li>Clique em <code>Usar</code> para baixar e abrir um modelo padrão.</li>' +
        '<li>O botão <code>Carregar modelo GLB</code> continua aceitando modelos próprios do computador.</li>' +
        '<li>Os modelos padrão passam pelo mesmo validador de triângulos, materiais, UV, escala e zonas de estampa.</li>' +
        '<li>Os arquivos são armazenados no repositório privado e entregues pelo Worker da Cloudflare.</li>' +
      '</ul>';

    if (faq && faq.parentNode) faq.parentNode.insertBefore(section, faq);
    else docsContent.appendChild(section);

    var toc = appDoc.querySelector('#docsOverlay .docs-toc');
    if (toc && !toc.querySelector('a[href="#docs-modelos-3d"]')) {
      var link = appDoc.createElement('a');
      link.className = 'docs-toc-link';
      link.href = '#docs-modelos-3d';
      link.textContent = 'Modelos 3D padrão';
      toc.appendChild(link);
      link.addEventListener('click', function (event) {
        event.preventDefault();
        Array.prototype.forEach.call(appDoc.querySelectorAll('.docs-toc-link'), function (item) {
          item.classList.toggle('active', item === link);
        });
        docsContent.scrollTo({ top: Math.max(0, section.offsetTop - 12), behavior: 'smooth' });
      });
    }
  }

  function initialize() {
    try {
      appWin = frame && frame.contentWindow;
      appDoc = frame && frame.contentDocument;
    } catch (_) {
      appWin = null;
      appDoc = null;
    }
    if (!appDoc) return;
    if (initializedDocument !== appDoc) {
      initializedDocument = appDoc;
      injectStyles();
    }
    injectLibrary();
    updateDocumentation();
  }

  if (frame) {
    frame.addEventListener('load', function () {
      setTimeout(initialize, 200);
      setTimeout(initialize, 1000);
      setTimeout(initialize, 2400);
    });
    setTimeout(initialize, 700);
  }
})();