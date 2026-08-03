const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const RATE_BUCKETS = new Map();
const ADMIN_ATTEMPTS = new Map();

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || 'https://armanioller.github.io';
    const cors = {
      'Access-Control-Allow-Origin': origin === allowed ? origin : allowed,
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, Authorization',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (origin && origin !== allowed) return json({ error: 'Origem não permitida.' }, 403, cors);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return json({ ok: true, service: 'halftone-forge-cloud', version: 3 }, 200, cors);
      }

      enforceRate(request, 'global', 220, 10 * 60_000);

      if (url.pathname === '/api/admin/login' && request.method === 'POST') {
        const body = await readBody(request, 20_000);
        const result = await adminLogin(request, env, String(body.key || ''));
        return json(result, 200, cors);
      }

      if (url.pathname === '/api/models' && request.method === 'GET') {
        const manifest = await readModelManifest(env);
        const models = manifest.models.filter((item) => !item.hidden);
        return json({ ok: true, models }, 200, cors);
      }

      if (url.pathname === '/api/admin/models' && request.method === 'GET') {
        await requireAdmin(request, env);
        const manifest = await readModelManifest(env);
        return json({ ok: true, models: manifest.models }, 200, cors);
      }

      if (url.pathname === '/api/model' && request.method === 'GET') {
        const id = normalizeId(url.searchParams.get('id'));
        const manifest = await readModelManifest(env);
        const model = manifest.models.find((item) => item.id === id && !item.hidden);
        if (!model) return json({ error: 'Modelo não encontrado.' }, 404, cors);
        const bytes = await getGithubBytes(env, `models/${id}.glb`);
        if (!bytes) return json({ error: 'Arquivo do modelo não encontrado.' }, 404, cors);
        return new Response(bytes, {
          status: 200,
          headers: {
            ...cors,
            'content-type': 'model/gltf-binary',
            'content-disposition': `inline; filename="${normalizeFilename(model.filename, `${id}.glb`)}"`,
            'cache-control': 'public, max-age=300'
          }
        });
      }

      if (url.pathname === '/api/model-thumb' && request.method === 'GET') {
        const id = normalizeId(url.searchParams.get('id'));
        const manifest = await readModelManifest(env);
        const model = manifest.models.find((item) => item.id === id && !item.hidden && item.thumbnail);
        if (!model) return new Response(null, { status: 404, headers: cors });
        const bytes = await getGithubBytes(env, `models-thumbs/${id}.png`);
        if (!bytes) return new Response(null, { status: 404, headers: cors });
        return new Response(bytes, {
          status: 200,
          headers: { ...cors, 'content-type': 'image/png', 'cache-control': 'public, max-age=900' }
        });
      }

      if (url.pathname === '/api/admin/model' && request.method === 'POST') {
        await requireAdmin(request, env);
        enforceRate(request, 'admin-model', 25, 60 * 60_000);
        const body = await readBody(request, 64_000_000);
        const id = normalizeId(body.id || crypto.randomUUID());
        const manifest = await readModelManifest(env);
        const existingIndex = manifest.models.findIndex((item) => item.id === id);
        const existing = existingIndex >= 0 ? manifest.models[existingIndex] : null;
        const base64 = String(body.base64 || '').replace(/\s/g, '');
        const thumbBase64 = String(body.thumbnailBase64 || '').replace(/\s/g, '');

        if (!existing && !base64) throw httpError(400, 'Selecione um arquivo GLB para o novo modelo.');
        if (base64 && base64.length > 45_000_000) throw httpError(413, 'Modelo maior que o limite permitido.');
        if (thumbBase64 && thumbBase64.length > 5_000_000) throw httpError(413, 'Miniatura maior que o limite permitido.');

        const filename = normalizeFilename(body.filename || existing?.filename, `${id}.glb`);
        if (!/\.glb$/i.test(filename)) throw httpError(400, 'Somente arquivos GLB são aceitos.');
        if (base64) await putGithubFile(env, `models/${id}.glb`, base64, `Modelo 3D: publica ${filename}`);
        if (thumbBase64) await putGithubFile(env, `models-thumbs/${id}.png`, thumbBase64, `Modelo 3D: miniatura ${id}`);

        const entry = {
          id,
          name: String(body.name || existing?.name || filename.replace(/\.glb$/i, '')).trim().slice(0, 100),
          description: String(body.description ?? existing?.description ?? '').trim().slice(0, 400),
          filename,
          sizeBytes: Number(body.sizeBytes) || existing?.sizeBytes || Math.floor(base64.length * 0.75),
          category: normalizeCategory(body.category || existing?.category || 'outros'),
          tags: normalizeTags(body.tags || existing?.tags || []),
          recommended: Boolean(body.recommended),
          hidden: Boolean(body.hidden),
          thumbnail: Boolean(thumbBase64 || existing?.thumbnail),
          updatedAt: new Date().toISOString()
        };
        if (existingIndex >= 0) manifest.models[existingIndex] = entry;
        else manifest.models.push(entry);
        sortModels(manifest.models);
        await saveModelManifest(env, manifest, `Modelos 3D: atualiza catálogo com ${entry.name}`);
        return json({ ok: true, model: entry }, 200, cors);
      }

      if (url.pathname === '/api/admin/model' && request.method === 'DELETE') {
        await requireAdmin(request, env);
        const id = normalizeId(url.searchParams.get('id'));
        const manifest = await readModelManifest(env);
        const item = manifest.models.find((model) => model.id === id);
        if (!item) return json({ ok: true, deleted: false }, 200, cors);
        await deleteGithubFile(env, `models/${id}.glb`);
        if (item.thumbnail) await deleteGithubFile(env, `models-thumbs/${id}.png`);
        manifest.models = manifest.models.filter((model) => model.id !== id);
        await saveModelManifest(env, manifest, `Modelos 3D: remove ${item.name || id}`);
        return json({ ok: true, deleted: true }, 200, cors);
      }

      if (url.pathname === '/api/storage' && request.method === 'GET') {
        const clientId = normalizeClientId(url.searchParams.get('clientId'));
        return json(await summarizeStorage(env, clientId), 200, cors);
      }

      if (url.pathname === '/api/storage/clear' && request.method === 'POST') {
        const body = await readBody(request, 20_000);
        const clientId = normalizeClientId(body.clientId);
        const category = String(body.category || '');
        const deleted = await clearStorageCategory(env, clientId, category);
        return json({ ok: true, deleted }, 200, cors);
      }

      if (url.pathname === '/api/storage/cleanup' && request.method === 'POST') {
        const body = await readBody(request, 20_000);
        const clientId = normalizeClientId(body.clientId);
        const days = Math.max(0, Math.min(3650, Number(body.days) || 0));
        const maxFiles = Math.max(0, Math.min(5000, Number(body.maxFiles) || 0));
        const deleted = await cleanupStorage(env, clientId, days, maxFiles);
        return json({ ok: true, deleted }, 200, cors);
      }

      if (url.pathname === '/api/save' && request.method === 'POST') {
        enforceRate(request, 'save', 100, 10 * 60_000);
        const body = await readBody(request, 50_000_000);
        const clientId = normalizeClientId(body.clientId);
        const kind = String(body.kind || 'workspace');
        const root = `users/${clientId}`;

        if (['image', 'audio', 'source', 'export'].includes(kind)) {
          const id = normalizeId(body.id || crypto.randomUUID());
          const base64 = String(body.base64 || '').replace(/\s/g, '');
          const limits = { image: 7_000_000, audio: 22_000_000, source: 45_000_000, export: 45_000_000 };
          if (!base64 || base64.length > limits[kind]) throw httpError(413, 'Arquivo ausente ou muito grande.');
          let folder;
          let filename;
          if (kind === 'audio') {
            folder = 'music';
            filename = `${id}.bin`;
          } else if (kind === 'image') {
            folder = 'gallery';
            filename = `${id}.png`;
          } else {
            folder = kind === 'source' ? 'uploads' : 'exports';
            const fallback = kind === 'source' ? 'imagem-carregada.bin' : 'arquivo-exportado.bin';
            filename = `${id}-${normalizeFilename(body.filename, fallback)}`;
          }
          const path = `${root}/${folder}/${filename}`;
          const label = kind === 'audio' ? 'Música' : kind === 'image' ? 'Galeria' : kind === 'source' ? 'Upload original' : 'Exportação';
          await putGithubFile(env, path, base64, `${label}: salva ${filename}`);
          return json({ ok: true, path }, 200, cors);
        }

        if (!['gallery', 'preferences', 'workspace', 'project', 'music'].includes(kind)) throw httpError(400, 'Tipo de salvamento inválido.');
        const filename = kind === 'project' ? 'project.hfp' : `${kind}.json`;
        const text = JSON.stringify(body.data ?? {}, null, 2);
        const path = `${root}/${filename}`;
        await putGithubFile(env, path, utf8ToBase64(text), `Sincroniza ${kind} de ${clientId}`);
        return json({ ok: true, path }, 200, cors);
      }

      if (url.pathname === '/api/load' && request.method === 'GET') {
        const clientId = normalizeClientId(url.searchParams.get('clientId'));
        const kind = String(url.searchParams.get('kind') || 'workspace');
        if (!['gallery', 'preferences', 'workspace', 'project', 'music'].includes(kind)) throw httpError(400, 'Tipo inválido.');
        const filename = kind === 'project' ? 'project.hfp' : `${kind}.json`;
        const file = await getGithubFile(env, `users/${clientId}/${filename}`);
        if (!file) return json({ ok: true, found: false }, 200, cors);
        return json({ ok: true, found: true, data: JSON.parse(base64ToUtf8(file.content)) }, 200, cors);
      }

      if ((url.pathname === '/api/image' || url.pathname === '/api/audio') && request.method === 'GET') {
        const clientId = normalizeClientId(url.searchParams.get('clientId'));
        const id = normalizeId(url.searchParams.get('id'));
        const audio = url.pathname === '/api/audio';
        const path = audio ? `users/${clientId}/music/${id}.bin` : `users/${clientId}/gallery/${id}.png`;
        const bytes = await getGithubBytes(env, path);
        if (!bytes) return json({ error: audio ? 'Áudio não encontrado.' : 'Imagem não encontrada.' }, 404, cors);
        return new Response(bytes, {
          status: 200,
          headers: { ...cors, 'content-type': audio ? 'application/octet-stream' : 'image/png', 'cache-control': 'private, max-age=60' }
        });
      }

      return json({ error: 'Rota não encontrada.' }, 404, cors);
    } catch (error) {
      return json({ error: error.message || 'Erro interno.' }, error.status || 500, cors);
    }
  }
};

function requestIp(request) {
  return String(request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown').split(',')[0].trim();
}

function enforceRate(request, scope, limit, windowMs) {
  const now = Date.now();
  const key = `${scope}:${requestIp(request)}`;
  let bucket = RATE_BUCKETS.get(key);
  if (!bucket || now >= bucket.resetAt) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  RATE_BUCKETS.set(key, bucket);
  if (bucket.count > limit) throw httpError(429, 'Muitas solicitações. Aguarde alguns minutos e tente novamente.');
  if (RATE_BUCKETS.size > 2000) {
    for (const [entryKey, entry] of RATE_BUCKETS) if (now >= entry.resetAt) RATE_BUCKETS.delete(entryKey);
  }
}

async function adminLogin(request, env, key) {
  if (!env.ADMIN_KEY) throw httpError(503, 'ADMIN_KEY não configurado no Worker.');
  const ip = requestIp(request);
  const now = Date.now();
  let attempt = ADMIN_ATTEMPTS.get(ip);
  if (!attempt || now >= attempt.resetAt) attempt = { count: 0, resetAt: now + 15 * 60_000 };
  if (attempt.count >= 8) throw httpError(429, 'Muitas tentativas administrativas. Aguarde 15 minutos.');
  if (!constantTimeEqual(key, String(env.ADMIN_KEY))) {
    attempt.count += 1;
    ADMIN_ATTEMPTS.set(ip, attempt);
    throw httpError(401, 'Chave administrativa inválida.');
  }
  ADMIN_ATTEMPTS.delete(ip);
  const expiresAt = now + 60 * 60_000;
  return { ok: true, token: await signAdminToken(env, { scope: 'models', exp: expiresAt }), expiresAt };
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_KEY) throw httpError(503, 'ADMIN_KEY não configurado no Worker.');
  const authorization = String(request.headers.get('Authorization') || '');
  if (authorization.startsWith('Bearer ')) {
    const valid = await verifyAdminToken(env, authorization.slice(7));
    if (valid) return;
  }
  const provided = String(request.headers.get('X-Admin-Key') || '');
  if (provided && constantTimeEqual(provided, String(env.ADMIN_KEY))) return;
  throw httpError(401, 'Sessão administrativa inválida ou expirada.');
}

function constantTimeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) diff |= (left.charCodeAt(i % Math.max(1, left.length)) || 0) ^ (right.charCodeAt(i % Math.max(1, right.length)) || 0);
  return diff === 0;
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - normalized.length % 4) % 4);
  return base64ToBytes(normalized + padding);
}

async function hmac(env, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(env.ADMIN_KEY)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

async function signAdminToken(env, payload) {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = base64UrlEncode(await hmac(env, body));
  return `${body}.${signature}`;
}

async function verifyAdminToken(env, token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return false;
    const expected = base64UrlEncode(await hmac(env, parts[0]));
    if (!constantTimeEqual(parts[1], expected)) return false;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    return payload.scope === 'models' && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function normalizeCategory(value) {
  const allowed = ['camiseta', 'moletom', 'infantil', 'feminino', 'masculino', 'acessorios', 'outros'];
  const category = String(value || 'outros').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return allowed.includes(category) ? category : 'outros';
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return source.map((tag) => String(tag).trim().slice(0, 30)).filter(Boolean).slice(0, 12);
}

function sortModels(models) {
  models.sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)) || String(a.name).localeCompare(String(b.name), 'pt-BR'));
}

async function readModelManifest(env) {
  const file = await getGithubFile(env, 'models.json');
  if (!file || Array.isArray(file)) return { schema: 'halftone-forge-models', version: 2, models: [] };
  try {
    const parsed = JSON.parse(base64ToUtf8(file.content));
    const models = Array.isArray(parsed.models) ? parsed.models.map((item) => ({
      ...item,
      category: normalizeCategory(item.category || 'outros'),
      tags: normalizeTags(item.tags || []),
      recommended: Boolean(item.recommended),
      hidden: Boolean(item.hidden),
      thumbnail: Boolean(item.thumbnail)
    })) : [];
    sortModels(models);
    return { schema: 'halftone-forge-models', version: 2, models };
  } catch {
    return { schema: 'halftone-forge-models', version: 2, models: [] };
  }
}

async function saveModelManifest(env, manifest, message) {
  const data = { schema: 'halftone-forge-models', version: 2, models: manifest.models || [] };
  await putGithubFile(env, 'models.json', utf8ToBase64(JSON.stringify(data, null, 2)), message);
}

async function summarizeStorage(env, clientId) {
  const root = `users/${clientId}`;
  const categories = {
    uploads: await directoryStats(env, `${root}/uploads`),
    exports: await directoryStats(env, `${root}/exports`),
    gallery: await combinedStats(env, [`${root}/gallery`], [`${root}/gallery.json`]),
    music: await combinedStats(env, [`${root}/music`], [`${root}/music.json`]),
    settings: await combinedStats(env, [], [`${root}/preferences.json`, `${root}/workspace.json`, `${root}/project.hfp`]),
    models: await combinedStats(env, ['models', 'models-thumbs'], ['models.json'])
  };
  let totalBytes = 0;
  let totalFiles = 0;
  for (const value of Object.values(categories)) { totalBytes += value.bytes; totalFiles += value.files; }
  return { ok: true, clientId, categories, totalBytes, totalFiles };
}

async function directoryEntries(env, path) {
  const result = await getGithubFile(env, path);
  return Array.isArray(result) ? result.filter((entry) => entry.type === 'file') : [];
}

async function directoryStats(env, path) {
  const entries = await directoryEntries(env, path);
  return { files: entries.length, bytes: entries.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0) };
}

async function combinedStats(env, directories, files) {
  let count = 0;
  let bytes = 0;
  for (const path of directories) {
    const stats = await directoryStats(env, path);
    count += stats.files;
    bytes += stats.bytes;
  }
  for (const path of files) {
    const file = await getGithubFile(env, path);
    if (file && !Array.isArray(file)) { count += 1; bytes += Number(file.size) || 0; }
  }
  return { files: count, bytes };
}

async function clearStorageCategory(env, clientId, category) {
  const root = `users/${clientId}`;
  const map = {
    uploads: { dirs: [`${root}/uploads`], files: [] },
    exports: { dirs: [`${root}/exports`], files: [] },
    gallery: { dirs: [`${root}/gallery`], files: [`${root}/gallery.json`] },
    music: { dirs: [`${root}/music`], files: [`${root}/music.json`] },
    settings: { dirs: [], files: [`${root}/preferences.json`, `${root}/workspace.json`, `${root}/project.hfp`] }
  };
  const target = map[category];
  if (!target) throw httpError(400, 'Categoria inválida ou protegida.');
  let deleted = 0;
  for (const dir of target.dirs) {
    const entries = await directoryEntries(env, dir);
    for (const entry of entries) if (await deleteGithubFile(env, entry.path)) deleted += 1;
  }
  for (const path of target.files) if (await deleteGithubFile(env, path)) deleted += 1;
  return deleted;
}

function timestampFromName(name) {
  const match = String(name || '').match(/_(\d{13})_/);
  return match ? Number(match[1]) : 0;
}

async function cleanupStorage(env, clientId, days, maxFiles) {
  const root = `users/${clientId}`;
  const cutoff = days > 0 ? Date.now() - days * 86400000 : 0;
  let deleted = 0;
  for (const folder of ['uploads', 'exports']) {
    const entries = await directoryEntries(env, `${root}/${folder}`);
    entries.sort((a, b) => timestampFromName(b.name) - timestampFromName(a.name));
    for (let i = 0; i < entries.length; i++) {
      const timestamp = timestampFromName(entries[i].name);
      const tooOld = cutoff > 0 && timestamp > 0 && timestamp < cutoff;
      const overLimit = maxFiles > 0 && i >= maxFiles;
      if ((tooOld || overLimit) && await deleteGithubFile(env, entries[i].path)) deleted += 1;
    }
  }
  return deleted;
}

async function readBody(request, maxBytes) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw httpError(413, 'Conteúdo muito grande.');
  const text = await request.text();
  if (text.length > maxBytes) throw httpError(413, 'Conteúdo muito grande.');
  try { return JSON.parse(text || '{}'); } catch { throw httpError(400, 'JSON inválido.'); }
}

function normalizeClientId(value) {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(id)) throw httpError(400, 'Identificador inválido.');
  return id;
}

function normalizeId(value) {
  const id = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  if (!id) throw httpError(400, 'ID inválido.');
  return id;
}

function normalizeFilename(value, fallback) {
  let name = String(value || fallback || 'arquivo.bin').split(/[\\/]/).pop();
  name = name.replace(/[^a-zA-Z0-9._ -]+/g, '_').replace(/\s+/g, '-').replace(/^\.+/, '').slice(0, 160);
  return name || String(fallback || 'arquivo.bin');
}

async function github(env, path, options = {}) {
  if (!env.GITHUB_TOKEN) throw httpError(503, 'GITHUB_TOKEN não configurado no Worker.');
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'halftone-forge-cloud',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    if (response.status === 404) return null;
    throw httpError(response.status, body?.message || `GitHub respondeu ${response.status}`);
  }
  return body;
}

async function getGithubFile(env, path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return github(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encoded}?ref=main`);
}

async function getGithubBytes(env, path) {
  if (!env.GITHUB_TOKEN) throw httpError(503, 'GITHUB_TOKEN não configurado no Worker.');
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encoded}?ref=main`, {
    headers: {
      'Accept': 'application/vnd.github.raw',
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'halftone-forge-cloud'
    }
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    let message = `GitHub respondeu ${response.status}`;
    try { const body = await response.json(); if (body?.message) message = body.message; } catch {}
    throw httpError(response.status, message);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function putGithubFile(env, path, content, message) {
  const existing = await getGithubFile(env, path);
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const payload = { message, content, branch: 'main' };
  if (existing?.sha) payload.sha = existing.sha;
  return github(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encoded}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function deleteGithubFile(env, path) {
  const existing = await getGithubFile(env, path);
  if (!existing || Array.isArray(existing) || !existing.sha) return false;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  await github(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encoded}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: `Remove ${path}`, sha: existing.sha, branch: 'main' })
  });
  return true;
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToUtf8(base64) {
  return new TextDecoder().decode(base64ToBytes(base64));
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
