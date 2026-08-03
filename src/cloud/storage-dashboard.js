(function () {
  'use strict';

  var API_BASE = 'https://cloudflare-worker.armanioller.workers.dev';
  var CLIENT_ID_KEY = 'hfCloudClientIdV1';
  var RETENTION_KEY = 'halftoneForgeCloudRetentionV1';
  var frame = document.getElementById('hfAppFrame');
  var doc = null;
  var initializedDocument = null;
  var loading = false;

  function clientId() {
    return localStorage.getItem(CLIENT_ID_KEY) || '';
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1048576) return (value / 1024).toFixed(1) + ' KB';
    if (value < 1073741824) return (value / 1048576).toFixed(1) + ' MB';
    return (value / 1073741824).toFixed(2) + ' GB';
  }

  function safeJson(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  async function api(path, options) {
    var response = await fetch(API_BASE + path, options || {});
    var text = await response.text();
    var body = text ? safeJson(text, text) : null;
    if (!response.ok) throw new Error(body && body.error ? body.error : ('Servidor respondeu ' + response.status));
    return body;
  }

  function injectStyles() {
    if (!doc || doc.getElementById('hfStorageDashboardStyle')) return;
    var style = doc.createElement('style');
    style.id = 'hfStorageDashboardStyle';
    style.textContent = [
      '.hf-storage-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border:1px solid rgba(46,214,161,.18);border-radius:10px;background:rgba(46,214,161,.04)}',
      '.hf-storage-summary strong{font:700 15px/1 var(--font-mono);color:#fff}',
      '.hf-storage-summary span{color:var(--text-dim);font-size:9.5px}',
      '.hf-storage-list{display:flex;flex-direction:column;gap:6px;margin-top:9px}',
      '.hf-storage-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;padding:8px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.02)}',
      '.hf-storage-name{font-size:10px;font-weight:700;color:var(--text)}',
      '.hf-storage-meta{margin-top:2px;color:var(--text-dim);font:8.5px/1.3 var(--font-mono)}',
      '.hf-storage-size{font:700 9px/1 var(--font-mono);color:#d4d4da;white-space:nowrap}',
      '.hf-storage-row .btn{padding:7px 8px;font-size:9px}',
      '.hf-storage-actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:7px;margin-top:9px}',
      '.hf-storage-actions select{min-height:34px;padding:7px;border:1px solid var(--line);border-radius:8px;background:#111218;color:var(--text);font-size:9.5px}',
      '.hf-storage-status{margin-top:8px;color:var(--text-dim);font:9px/1.4 var(--font-mono)}',
      '.hf-storage-status.ok{color:var(--success)}.hf-storage-status.error{color:var(--danger)}',
      '@media(max-width:680px){.hf-storage-row{grid-template-columns:minmax(0,1fr) auto}.hf-storage-row .btn{grid-column:1/-1}.hf-storage-actions{grid-template-columns:1fr}}'
    ].join('\n');
    doc.head.appendChild(style);
  }

  function setStatus(text, kind) {
    var el = doc && doc.getElementById('hfStorageStatus');
    if (!el) return;
    el.className = 'hf-storage-status ' + (kind || '');
    el.textContent = text || '';
  }

  function categoryLabel(key) {
    return {
      uploads: 'Imagens originais carregadas',
      exports: 'Arquivos exportados',
      gallery: 'Galeria',
      music: 'Biblioteca musical',
      settings: 'Configurações e projeto',
      models: 'Modelos 3D padrão'
    }[key] || key;
  }

  function renderUsage(data) {
    var total = doc.getElementById('hfStorageTotal');
    var subtitle = doc.getElementById('hfStorageSubtitle');
    var list = doc.getElementById('hfStorageList');
    if (!total || !list) return;
    total.textContent = formatBytes(data.totalBytes || 0);
    subtitle.textContent = (data.totalFiles || 0) + ' arquivo(s) no backup privado';
    list.innerHTML = '';
    var order = ['uploads','exports','gallery','music','settings','models'];
    order.forEach(function (key) {
      var item = data.categories && data.categories[key] || { bytes: 0, files: 0 };
      var row = doc.createElement('div');
      row.className = 'hf-storage-row';
      row.innerHTML = '' +
        '<div><div class="hf-storage-name"></div><div class="hf-storage-meta"></div></div>' +
        '<div class="hf-storage-size"></div>' +
        '<button class="btn btn-ghost" type="button">Limpar</button>';
      row.querySelector('.hf-storage-name').textContent = categoryLabel(key);
      row.querySelector('.hf-storage-meta').textContent = (item.files || 0) + ' arquivo(s)';
      row.querySelector('.hf-storage-size').textContent = formatBytes(item.bytes || 0);
      var button = row.querySelector('button');
      button.disabled = !item.files || key === 'models';
      button.title = key === 'models' ? 'Modelos padrão são administrados no painel do proprietário' : 'Apagar esta categoria do backup deste navegador';
      button.addEventListener('click', function () { clearCategory(key, button); });
      list.appendChild(row);
    });
  }

  async function refreshUsage() {
    if (loading || !clientId()) return;
    loading = true;
    setStatus('Calculando uso do armazenamento…');
    try {
      var result = await api('/api/storage?clientId=' + encodeURIComponent(clientId()));
      renderUsage(result);
      setStatus('Uso atualizado em ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '.', 'ok');
    } catch (error) {
      console.error(error);
      setStatus('Não foi possível consultar o armazenamento: ' + error.message, 'error');
    } finally {
      loading = false;
    }
  }

  async function clearCategory(category, button) {
    if (!confirm('Apagar os arquivos de “' + categoryLabel(category) + '” deste backup? Esta ação não pode ser desfeita.')) return;
    button.disabled = true;
    setStatus('Limpando ' + categoryLabel(category) + '…');
    try {
      await api('/api/storage/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: clientId(), category: category })
      });
      setStatus('Categoria limpa com sucesso.', 'ok');
      await refreshUsage();
    } catch (error) {
      console.error(error);
      setStatus('Falha ao limpar: ' + error.message, 'error');
      button.disabled = false;
    }
  }

  async function applyRetention() {
    var days = doc.getElementById('hfRetentionDays');
    var maxFiles = doc.getElementById('hfRetentionMax');
    var button = doc.getElementById('btnHfApplyRetention');
    var config = {
      days: parseInt(days.value, 10) || 0,
      maxFiles: parseInt(maxFiles.value, 10) || 0
    };
    try { localStorage.setItem(RETENTION_KEY, JSON.stringify(config)); } catch (_) {}
    button.disabled = true;
    setStatus('Aplicando política aos uploads e exportações…');
    try {
      var result = await api('/api/storage/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: clientId(), days: config.days, maxFiles: config.maxFiles })
      });
      setStatus((result.deleted || 0) + ' arquivo(s) antigo(s) removido(s).', 'ok');
      await refreshUsage();
    } catch (error) {
      console.error(error);
      setStatus('Falha ao aplicar retenção: ' + error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function injectDashboard() {
    if (!doc || doc.getElementById('hfStorageDashboard')) return true;
    var grid = doc.querySelector('#settingsOverlay .settings-grid');
    if (!grid) return false;
    var card = doc.createElement('section');
    card.className = 'settings-card settings-card-wide';
    card.id = 'hfStorageDashboard';
    card.innerHTML = '' +
      '<h3>Armazenamento</h3>' +
      '<div class="hf-storage-summary"><div><strong id="hfStorageTotal">—</strong><div><span id="hfStorageSubtitle">Calculando…</span></div></div><button class="btn btn-ghost" id="btnHfStorageRefresh" type="button">Atualizar</button></div>' +
      '<div class="hf-storage-list" id="hfStorageList"></div>' +
      '<div class="hf-storage-actions">' +
        '<select id="hfRetentionDays" aria-label="Prazo de retenção"><option value="0">Não apagar por idade</option><option value="7">Manter por 7 dias</option><option value="30">Manter por 30 dias</option><option value="90">Manter por 90 dias</option><option value="180">Manter por 180 dias</option></select>' +
        '<select id="hfRetentionMax" aria-label="Máximo de arquivos"><option value="0">Sem limite de quantidade</option><option value="20">Manter últimos 20</option><option value="50">Manter últimos 50</option><option value="100">Manter últimos 100</option><option value="250">Manter últimos 250</option></select>' +
        '<button class="btn btn-ghost" id="btnHfApplyRetention" type="button">Aplicar limpeza</button>' +
      '</div>' +
      '<div class="hf-storage-status" id="hfStorageStatus">Conectando ao backup…</div>';
    grid.appendChild(card);

    var saved = safeJson(localStorage.getItem(RETENTION_KEY) || '{}', {});
    if (saved.days != null) doc.getElementById('hfRetentionDays').value = String(saved.days);
    if (saved.maxFiles != null) doc.getElementById('hfRetentionMax').value = String(saved.maxFiles);
    doc.getElementById('btnHfStorageRefresh').addEventListener('click', refreshUsage);
    doc.getElementById('btnHfApplyRetention').addEventListener('click', applyRetention);
    refreshUsage();
    return true;
  }

  function updateDocumentation() {
    if (!doc || doc.getElementById('docs-armazenamento')) return;
    var content = doc.getElementById('docsContent');
    if (!content) return;
    var section = doc.createElement('section');
    section.id = 'docs-armazenamento';
    section.innerHTML = '' +
      '<h2>Armazenamento e limpeza</h2>' +
      '<p>Em <code>Configurações gerais → Armazenamento</code>, consulte o espaço ocupado por imagens originais, exportações, galeria, músicas e configurações.</p>' +
      '<ul><li>Use <code>Limpar</code> para apagar uma categoria do backup deste navegador.</li><li>A política de retenção remove uploads e exportações antigos ou mantém somente a quantidade mais recente escolhida.</li><li>Os modelos 3D padrão são gerenciados somente pelo administrador.</li></ul>';
    var faq = doc.getElementById('docs-faq');
    if (faq && faq.parentNode) faq.parentNode.insertBefore(section, faq);
    else content.appendChild(section);
  }

  function initialize() {
    try { doc = frame && frame.contentDocument; } catch (_) { doc = null; }
    if (!doc) return;
    if (initializedDocument !== doc) {
      initializedDocument = doc;
      injectStyles();
    }
    injectDashboard();
    updateDocumentation();
  }

  if (frame) {
    frame.addEventListener('load', function () {
      setTimeout(initialize, 250);
      setTimeout(initialize, 1200);
      setTimeout(initialize, 2600);
    });
    setTimeout(initialize, 800);
  }
})();