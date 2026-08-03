(function () {
  'use strict';

  var API_BASE = 'https://cloudflare-worker.armanioller.workers.dev';
  var TOKEN_KEY = 'hfModelAdminTokenV2';
  var FAVORITES_KEY = 'halftoneForgeModelFavoritesV1';
  var DEFAULT_KEY = 'halftoneForgeDefaultModelV1';
  var AUTO_KEY = 'halftoneForgeAutoOpenDefaultModelV1';
  var frame = document.getElementById('hfAppFrame');
  var doc = null;
  var models = [];
  var adminModels = [];
  var installedDocument = null;
  var autoOpened = false;

  function safeJson(value, fallback) { try { return JSON.parse(value); } catch (_) { return fallback; } }
  function token() { return sessionStorage.getItem(TOKEN_KEY) || ''; }
  function isAdminUrl() { try { return new URL(location.href).searchParams.get('admin') === 'armanioller'; } catch (_) { return false; } }
  function auth(extra) { var headers = Object.assign({}, extra || {}); if (token()) headers.Authorization = 'Bearer ' + token(); return headers; }
  async function api(path, options) {
    var response = await fetch(API_BASE + path, options || {});
    var text = await response.text();
    var body = text ? safeJson(text, text) : null;
    if (!response.ok) throw new Error(body && body.error ? body.error : ('Servidor respondeu ' + response.status));
    return body;
  }
  function favorites() { var value = safeJson(localStorage.getItem(FAVORITES_KEY) || '[]', []); return Array.isArray(value) ? value : []; }
  function setFavorites(value) { try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(value)); } catch (_) {} }
  function toggleFavorite(id) { var list = favorites(); var i = list.indexOf(id); if (i >= 0) list.splice(i, 1); else list.push(id); setFavorites(list); renderPublic(); }
  function categoryLabel(value) { return { camiseta:'Camiseta',moletom:'Moletom',infantil:'Infantil',feminino:'Feminino',masculino:'Masculino',acessorios:'Acessórios',outros:'Outros' }[value] || 'Outros'; }
  function formatBytes(bytes) { var v = Number(bytes) || 0; return v < 1048576 ? (v / 1024).toFixed(0) + ' KB' : (v / 1048576).toFixed(2) + ' MB'; }
  function status(text, kind) { var el = doc && doc.getElementById('hfModelProStatus'); if (el) { el.className = 'hf-model-pro-status ' + (kind || ''); el.textContent = text || ''; } }
  function adminStatus(text, kind) { var el = doc && doc.getElementById('hfModelProAdminStatus'); if (el) { el.className = 'hf-model-pro-status ' + (kind || ''); el.textContent = text || ''; } }

  function injectStyles() {
    if (!doc || doc.getElementById('hfModelProStyle')) return;
    var style = doc.createElement('style');
    style.id = 'hfModelProStyle';
    style.textContent = [
      '.hf-model-pro-tools{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;margin-top:8px}',
      '.hf-model-pro-tools input,.hf-model-pro-tools select,.hf-model-pro-admin input,.hf-model-pro-admin select,.hf-model-pro-admin textarea{min-height:34px;padding:7px 8px;border:1px solid var(--line);border-radius:8px;background:#111218;color:var(--text);font-size:9.5px}',
      '.hf-model-pro-tools label{grid-column:1/-1;display:flex;align-items:center;gap:7px;color:var(--text-dim);font-size:9.5px}',
      '.hf-model-pro-list{display:flex;flex-direction:column;gap:8px;margin-top:8px}',
      '.hf-model-pro-empty{padding:11px;border:1px dashed var(--line);border-radius:9px;color:var(--text-dim);font-size:10px;line-height:1.45}',
      '.hf-model-pro-card{display:grid;grid-template-columns:68px minmax(0,1fr) auto;gap:9px;align-items:center;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.025)}',
      '.hf-model-pro-card.rec{border-color:rgba(46,214,161,.3);background:rgba(46,214,161,.025)}',
      '.hf-model-pro-thumb,.hf-model-pro-placeholder{width:68px;height:68px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:linear-gradient(135deg,#282a31,#14151a)}',
      '.hf-model-pro-thumb{object-fit:cover}.hf-model-pro-placeholder{display:grid;place-items:center;color:var(--text-dim);font:700 18px/1 var(--font-mono)}',
      '.hf-model-pro-head{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.hf-model-pro-name{font-size:11px;font-weight:700;color:#fff}',
      '.hf-model-pro-badge{padding:3px 5px;border-radius:999px;border:1px solid rgba(255,255,255,.11);color:var(--text-dim);font:700 7px/1 var(--font-mono);text-transform:uppercase}',
      '.hf-model-pro-badge.rec{color:#9ee8d0;border-color:rgba(46,214,161,.3)}',
      '.hf-model-pro-desc{margin-top:4px;color:var(--text-dim);font-size:9.5px;line-height:1.35}',
      '.hf-model-pro-meta{margin-top:4px;color:var(--text-dim);font:8px/1.3 var(--font-mono)}',
      '.hf-model-pro-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}.hf-model-pro-tag{padding:2px 5px;border-radius:999px;background:rgba(255,255,255,.05);color:#aaaab4;font-size:7.5px}',
      '.hf-model-pro-actions{display:flex;flex-direction:column;gap:5px}.hf-model-pro-actions .btn{padding:7px 8px;font-size:9px;white-space:nowrap}.hf-model-pro-actions .active{color:#ffd166;border-color:rgba(255,209,102,.42)}',
      '.hf-model-pro-default{display:flex;align-items:center;gap:7px;margin-top:8px;padding:8px;border:1px solid var(--line);border-radius:8px;color:var(--text-dim);font-size:9.5px}',
      '.hf-model-pro-status{margin-top:7px;color:var(--text-dim);font:9px/1.4 var(--font-mono)}.hf-model-pro-status.ok{color:var(--success)}.hf-model-pro-status.error{color:var(--danger)}',
      '.hf-model-pro-admin{margin-top:10px;padding-top:10px;border-top:1px solid var(--line);display:grid;gap:7px}.hf-model-pro-admin textarea{min-height:56px;resize:vertical}',
      '.hf-model-pro-pair{display:grid;grid-template-columns:1fr 1fr;gap:7px}.hf-model-pro-checks{display:grid;grid-template-columns:1fr 1fr;gap:7px}.hf-model-pro-checks label{display:flex;align-items:center;gap:6px;padding:8px;border:1px solid var(--line);border-radius:8px;color:var(--text-dim);font-size:9px}',
      '.hf-model-pro-buttons{display:flex;gap:6px;flex-wrap:wrap}',
      '@media(max-width:640px){.hf-model-pro-card{grid-template-columns:54px minmax(0,1fr)}.hf-model-pro-thumb,.hf-model-pro-placeholder{width:54px;height:54px}.hf-model-pro-actions{grid-column:1/-1;flex-direction:row}.hf-model-pro-pair,.hf-model-pro-checks{grid-template-columns:1fr}}'
    ].join('\n');
    doc.head.appendChild(style);
  }

  function dispatchModel(model, button) {
    if (!model) return;
    var old = button.textContent; button.disabled = true; button.textContent = 'Carregando…';
    status('Baixando ' + model.name + '…');
    fetch(API_BASE + '/api/model?id=' + encodeURIComponent(model.id)).then(function (response) {
      if (!response.ok) return response.json().then(function (body) { throw new Error(body.error || 'Falha ao baixar.'); });
      return response.blob();
    }).then(function (blob) {
      var file = new File([blob], model.filename || model.id + '.glb', { type:'model/gltf-binary', lastModified:Date.now() });
      var input = doc.getElementById('mockupModelInput');
      var transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles:true }));
      localStorage.setItem('halftoneForgeLastUsedModelV1', model.id);
      status('Modelo carregado: ' + model.name, 'ok');
    }).catch(function (error) { status('Erro: ' + error.message, 'error'); }).finally(function () { button.disabled = false; button.textContent = old; });
  }

  function filteredModels() {
    var search = String((doc.getElementById('hfModelProSearch') || {}).value || '').trim().toLowerCase();
    var category = String((doc.getElementById('hfModelProCategory') || {}).value || 'all');
    var favOnly = !!((doc.getElementById('hfModelProFavorites') || {}).checked);
    var favs = favorites();
    return models.filter(function (model) {
      if (category !== 'all' && model.category !== category) return false;
      if (favOnly && favs.indexOf(model.id) < 0) return false;
      var hay = [model.name,model.description,model.filename,model.category].concat(model.tags || []).join(' ').toLowerCase();
      return !search || hay.indexOf(search) >= 0;
    });
  }

  function renderPublic() {
    var list = doc && doc.getElementById('hfModelProList');
    if (!list) return;
    list.innerHTML = '';
    var items = filteredModels();
    if (!items.length) { var empty = doc.createElement('div'); empty.className = 'hf-model-pro-empty'; empty.textContent = models.length ? 'Nenhum modelo corresponde aos filtros.' : 'Nenhum modelo padrão publicado. O botão Carregar modelo GLB continua disponível.'; list.appendChild(empty); return; }
    var favs = favorites();
    var defaultId = localStorage.getItem(DEFAULT_KEY) || '';
    items.forEach(function (model) {
      var card = doc.createElement('article'); card.className = 'hf-model-pro-card' + (model.recommended ? ' rec' : '');
      var media = model.thumbnail ? doc.createElement('img') : doc.createElement('div');
      if (model.thumbnail) { media.className = 'hf-model-pro-thumb'; media.alt = 'Miniatura de ' + model.name; media.loading = 'lazy'; media.src = API_BASE + '/api/model-thumb?id=' + encodeURIComponent(model.id); }
      else { media.className = 'hf-model-pro-placeholder'; media.textContent = String(model.name || '3D').slice(0, 1).toUpperCase(); }
      var copy = doc.createElement('div');
      var head = doc.createElement('div'); head.className = 'hf-model-pro-head';
      var name = doc.createElement('span'); name.className = 'hf-model-pro-name'; name.textContent = model.name || model.id; head.appendChild(name);
      var cat = doc.createElement('span'); cat.className = 'hf-model-pro-badge'; cat.textContent = categoryLabel(model.category); head.appendChild(cat);
      if (model.recommended) { var rec = doc.createElement('span'); rec.className = 'hf-model-pro-badge rec'; rec.textContent = 'Recomendado'; head.appendChild(rec); }
      if (defaultId === model.id) { var def = doc.createElement('span'); def.className = 'hf-model-pro-badge'; def.textContent = 'Padrão'; head.appendChild(def); }
      copy.appendChild(head);
      var desc = doc.createElement('div'); desc.className = 'hf-model-pro-desc'; desc.textContent = model.description || 'Modelo 3D padrão do Halftone Forge.'; copy.appendChild(desc);
      var meta = doc.createElement('div'); meta.className = 'hf-model-pro-meta'; meta.textContent = (model.filename || model.id + '.glb') + ' · ' + formatBytes(model.sizeBytes); copy.appendChild(meta);
      if (model.tags && model.tags.length) { var tags = doc.createElement('div'); tags.className = 'hf-model-pro-tags'; model.tags.forEach(function (tag) { var el = doc.createElement('span'); el.className = 'hf-model-pro-tag'; el.textContent = tag; tags.appendChild(el); }); copy.appendChild(tags); }
      var actions = doc.createElement('div'); actions.className = 'hf-model-pro-actions';
      var use = doc.createElement('button'); use.className = 'btn btn-primary'; use.type = 'button'; use.textContent = 'Usar'; use.addEventListener('click', function () { dispatchModel(model, use); });
      var fav = doc.createElement('button'); fav.className = 'btn btn-ghost' + (favs.indexOf(model.id) >= 0 ? ' active' : ''); fav.type = 'button'; fav.textContent = favs.indexOf(model.id) >= 0 ? '★ Favorito' : '☆ Favoritar'; fav.addEventListener('click', function () { toggleFavorite(model.id); });
      var setDefault = doc.createElement('button'); setDefault.className = 'btn btn-ghost'; setDefault.type = 'button'; setDefault.textContent = defaultId === model.id ? 'Remover padrão' : 'Definir padrão'; setDefault.addEventListener('click', function () { if (localStorage.getItem(DEFAULT_KEY) === model.id) localStorage.removeItem(DEFAULT_KEY); else localStorage.setItem(DEFAULT_KEY, model.id); renderPublic(); });
      actions.appendChild(use); actions.appendChild(fav); actions.appendChild(setDefault);
      card.appendChild(media); card.appendChild(copy); card.appendChild(actions); list.appendChild(card);
    });
  }

  function refreshCategories() {
    var select = doc.getElementById('hfModelProCategory'); if (!select) return;
    var current = select.value || 'all'; var cats = [];
    models.forEach(function (model) { if (cats.indexOf(model.category) < 0) cats.push(model.category); });
    select.innerHTML = '<option value="all">Todas as categorias</option>' + cats.map(function (cat) { return '<option value="' + cat + '">' + categoryLabel(cat) + '</option>'; }).join('');
    select.value = cats.indexOf(current) >= 0 ? current : 'all';
  }

  function maybeOpenDefault() {
    if (autoOpened || localStorage.getItem(AUTO_KEY) !== 'true') return;
    var id = localStorage.getItem(DEFAULT_KEY); var model = models.find(function (item) { return item.id === id; });
    if (!model) return; autoOpened = true; var fake = { disabled:false, textContent:'Usar' }; dispatchModel(model, fake);
  }

  async function refreshPublic() {
    status('Atualizando biblioteca…');
    try { var result = await api('/api/models'); models = Array.isArray(result.models) ? result.models : []; refreshCategories(); renderPublic(); status(models.length + ' modelo(s) disponível(is).', 'ok'); maybeOpenDefault(); }
    catch (error) { models = []; renderPublic(); status('Falha ao carregar: ' + error.message, 'error'); }
  }

  function fileBase64(file) { return new Promise(function (resolve, reject) { var reader = new FileReader(); reader.onload = function () { var value = String(reader.result || ''); resolve(value.slice(value.indexOf(',') + 1)); }; reader.onerror = reject; reader.readAsDataURL(file); }); }
  function thumbnailBase64(file) { return new Promise(function (resolve, reject) { var url = URL.createObjectURL(file); var img = new Image(); img.onload = function () { var canvas = doc.createElement('canvas'); canvas.width = 600; canvas.height = 600; var ctx = canvas.getContext('2d'); ctx.fillStyle = '#16171c'; ctx.fillRect(0,0,600,600); var scale = Math.min(600 / img.naturalWidth, 600 / img.naturalHeight); var w = img.naturalWidth * scale, h = img.naturalHeight * scale; ctx.drawImage(img,(600-w)/2,(600-h)/2,w,h); URL.revokeObjectURL(url); resolve(canvas.toDataURL('image/png').split(',')[1]); }; img.onerror = reject; img.src = url; }); }

  function renderAdminState() { var login = doc.getElementById('hfModelProLogin'); var form = doc.getElementById('hfModelProForm'); if (login) login.hidden = !!token(); if (form) form.hidden = !token(); }
  async function loginAdmin() { var key = doc.getElementById('hfModelProKey').value; adminStatus('Entrando…'); try { var result = await api('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:key})}); sessionStorage.setItem(TOKEN_KEY,result.token); doc.getElementById('hfModelProKey').value=''; renderAdminState(); adminStatus('Sessão administrativa iniciada.', 'ok'); refreshAdmin(); } catch (error) { adminStatus(error.message,'error'); } }
  async function refreshAdmin() { if (!token()) return; try { var result = await api('/api/admin/models',{headers:auth()}); adminModels = Array.isArray(result.models) ? result.models : []; var select = doc.getElementById('hfModelProExisting'); select.innerHTML = '<option value="">Novo modelo</option>' + adminModels.map(function (m) { return '<option value="' + m.id + '">' + m.name + (m.hidden ? ' · oculto' : '') + '</option>'; }).join(''); } catch (error) { adminStatus(error.message,'error'); } }
  function fillAdmin(id) { var m = adminModels.find(function (item) { return item.id === id; }); doc.getElementById('hfModelProName').value = m ? m.name || '' : ''; doc.getElementById('hfModelProDescription').value = m ? m.description || '' : ''; doc.getElementById('hfModelProCategoryAdmin').value = m ? m.category || 'outros' : 'outros'; doc.getElementById('hfModelProTags').value = m ? (m.tags || []).join(', ') : ''; doc.getElementById('hfModelProRecommended').checked = !!(m && m.recommended); doc.getElementById('hfModelProHidden').checked = !!(m && m.hidden); doc.getElementById('hfModelProFile').value=''; doc.getElementById('hfModelProThumb').value=''; }
  async function saveAdmin() {
    var select = doc.getElementById('hfModelProExisting'); var existing = adminModels.find(function (m) { return m.id === select.value; }) || null; var file = doc.getElementById('hfModelProFile').files[0]; var thumb = doc.getElementById('hfModelProThumb').files[0];
    if (!existing && !file) return adminStatus('Selecione um GLB para o novo modelo.','error');
    var name = doc.getElementById('hfModelProName').value.trim() || (file ? file.name.replace(/\.glb$/i,'') : existing.name); var id = existing ? existing.id : name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,80);
    adminStatus('Salvando modelo…');
    try {
      var body = { id:id,name:name,description:doc.getElementById('hfModelProDescription').value.trim(),category:doc.getElementById('hfModelProCategoryAdmin').value,tags:doc.getElementById('hfModelProTags').value.split(',').map(function (v) { return v.trim(); }).filter(Boolean),recommended:doc.getElementById('hfModelProRecommended').checked,hidden:doc.getElementById('hfModelProHidden').checked,filename:file ? file.name : existing.filename,sizeBytes:file ? file.size : existing.sizeBytes,base64:file ? await fileBase64(file) : '',thumbnailBase64:thumb ? await thumbnailBase64(thumb) : '' };
      await api('/api/admin/model',{method:'POST',headers:auth({'Content-Type':'application/json'}),body:JSON.stringify(body)}); adminStatus('Modelo salvo.', 'ok'); select.value=''; fillAdmin(''); await Promise.all([refreshPublic(),refreshAdmin()]);
    } catch (error) { adminStatus(error.message,'error'); }
  }
  async function deleteAdmin() { var id = doc.getElementById('hfModelProExisting').value; var m = adminModels.find(function (item) { return item.id === id; }); if (!m) return adminStatus('Escolha um modelo.','error'); if (!confirm('Excluir definitivamente “' + m.name + '”?')) return; try { await api('/api/admin/model?id='+encodeURIComponent(id),{method:'DELETE',headers:auth()}); adminStatus('Modelo excluído.','ok'); fillAdmin(''); await Promise.all([refreshPublic(),refreshAdmin()]); } catch (error) { adminStatus(error.message,'error'); } }

  function buildAdmin() {
    if (!isAdminUrl()) return '';
    return '' +
      '<div class="hf-model-pro-admin"><div class="panel-label">Administrador · Armanioller</div>' +
      '<div id="hfModelProLogin"><input id="hfModelProKey" type="password" autocomplete="current-password" placeholder="Chave administrativa"><button class="btn btn-primary" id="btnHfModelProLogin" type="button" style="margin-top:7px">Entrar</button></div>' +
      '<div id="hfModelProForm" hidden><select id="hfModelProExisting"><option value="">Novo modelo</option></select><input id="hfModelProName" type="text" placeholder="Nome do modelo"><textarea id="hfModelProDescription" placeholder="Descrição"></textarea><div class="hf-model-pro-pair"><select id="hfModelProCategoryAdmin"><option value="camiseta">Camiseta</option><option value="moletom">Moletom</option><option value="infantil">Infantil</option><option value="feminino">Feminino</option><option value="masculino">Masculino</option><option value="acessorios">Acessórios</option><option value="outros">Outros</option></select><input id="hfModelProTags" type="text" placeholder="Tags separadas por vírgula"></div><div class="hf-model-pro-checks"><label><input id="hfModelProRecommended" type="checkbox"> Recomendado</label><label><input id="hfModelProHidden" type="checkbox"> Oculto</label></div><span class="mockup3d-panel-note">GLB para cadastro ou substituição</span><input id="hfModelProFile" type="file" accept=".glb,model/gltf-binary"><span class="mockup3d-panel-note">Miniatura PNG/JPG/WebP</span><input id="hfModelProThumb" type="file" accept="image/*"><div class="hf-model-pro-buttons"><button class="btn btn-primary" id="btnHfModelProSave" type="button">Salvar</button><button class="btn btn-ghost" id="btnHfModelProNew" type="button">Novo</button><button class="btn btn-ghost" id="btnHfModelProDelete" type="button">Excluir</button><button class="btn btn-ghost" id="btnHfModelProLogout" type="button">Sair</button></div></div><div class="hf-model-pro-status" id="hfModelProAdminStatus"></div></div>';
  }

  function install() {
    try { doc = frame.contentDocument; } catch (_) { doc = null; }
    if (!doc) return;
    injectStyles();
    var panel = doc.getElementById('hfModelLibraryPanel');
    if (!panel || panel.dataset.hfPro === '1') return;
    panel.dataset.hfPro = '1';
    panel.innerHTML = '' +
      '<div class="panel-label">Modelos padrão</div><div class="mockup3d-panel-note">Pesquise, favorite e defina uma peça padrão. O botão Carregar modelo GLB continua disponível para arquivos próprios.</div>' +
      '<div class="hf-model-pro-tools"><input id="hfModelProSearch" type="search" placeholder="Buscar modelo"><select id="hfModelProCategory"><option value="all">Todas as categorias</option></select><label><input id="hfModelProFavorites" type="checkbox"> Mostrar somente favoritos</label></div>' +
      '<label class="hf-model-pro-default"><input id="hfModelProAuto" type="checkbox"> Abrir automaticamente o modelo definido como padrão</label><div class="hf-model-pro-list" id="hfModelProList"></div><div class="hf-model-pro-status" id="hfModelProStatus">Conectando…</div>' + buildAdmin();
    doc.getElementById('hfModelProSearch').addEventListener('input',renderPublic); doc.getElementById('hfModelProCategory').addEventListener('change',renderPublic); doc.getElementById('hfModelProFavorites').addEventListener('change',renderPublic);
    var auto = doc.getElementById('hfModelProAuto'); auto.checked = localStorage.getItem(AUTO_KEY) === 'true'; auto.addEventListener('change',function () { localStorage.setItem(AUTO_KEY,this.checked?'true':'false'); });
    if (isAdminUrl()) { doc.getElementById('btnHfModelProLogin').addEventListener('click',loginAdmin); doc.getElementById('hfModelProExisting').addEventListener('change',function () { fillAdmin(this.value); }); doc.getElementById('btnHfModelProSave').addEventListener('click',saveAdmin); doc.getElementById('btnHfModelProNew').addEventListener('click',function () { doc.getElementById('hfModelProExisting').value=''; fillAdmin(''); }); doc.getElementById('btnHfModelProDelete').addEventListener('click',deleteAdmin); doc.getElementById('btnHfModelProLogout').addEventListener('click',function () { sessionStorage.removeItem(TOKEN_KEY); renderAdminState(); adminStatus('Sessão encerrada.'); }); renderAdminState(); if (token()) refreshAdmin(); }
    refreshPublic();
    var docsSection = doc.getElementById('docs-modelos-3d'); if (docsSection) docsSection.innerHTML = '<h2>Modelos 3D padrão</h2><p>A biblioteca permite buscar, filtrar por categoria, favoritar e definir um modelo padrão.</p><ul><li>Use <code>Usar</code> para carregar a peça.</li><li>Miniaturas, tags e selos facilitam a escolha.</li><li>O administrador pode cadastrar, substituir, editar, ocultar e excluir modelos.</li></ul><div class="docs-tip"><strong>Administração:</strong> o login gera uma sessão temporária de uma hora no Worker.</div>';
  }

  function initialize() { try { doc = frame && frame.contentDocument; } catch (_) { doc = null; } if (!doc) return; if (installedDocument !== doc) installedDocument = doc; install(); }
  if (frame) { frame.addEventListener('load',function () { setTimeout(initialize,700); setTimeout(initialize,1800); setTimeout(initialize,3200); }); setTimeout(initialize,1500); }
})();