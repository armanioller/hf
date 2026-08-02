const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || 'https://armanioller.github.io';
    const cors = {
      'Access-Control-Allow-Origin': origin === allowed ? origin : allowed,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (origin && origin !== allowed) return json({ error: 'Origem não permitida.' }, 403, cors);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return json({ ok: true, service: 'halftone-forge-cloud' }, 200, cors);
      }

      if (url.pathname === '/api/save' && request.method === 'POST') {
        const body = await readBody(request, 7_500_000);
        const clientId = normalizeClientId(body.clientId);
        const kind = String(body.kind || 'workspace');
        const root = `users/${clientId}`;

        if (kind === 'image') {
          const id = normalizeId(body.id || crypto.randomUUID());
          const base64 = String(body.base64 || '').replace(/\s/g, '');
          if (!base64 || base64.length > 7_000_000) throw httpError(413, 'Imagem ausente ou muito grande.');
          const path = `${root}/gallery/${id}.png`;
          await putGithubFile(env, path, base64, `Galeria: salva imagem ${id}`);
          return json({ ok: true, path }, 200, cors);
        }

        if (!['gallery', 'preferences', 'workspace', 'project'].includes(kind)) throw httpError(400, 'Tipo de salvamento inválido.');
        const filename = kind === 'project' ? 'project.hfp' : `${kind}.json`;
        const text = JSON.stringify(body.data ?? {}, null, 2);
        const path = `${root}/${filename}`;
        await putGithubFile(env, path, utf8ToBase64(text), `Sincroniza ${kind} de ${clientId}`);
        return json({ ok: true, path }, 200, cors);
      }

      if (url.pathname === '/api/load' && request.method === 'GET') {
        const clientId = normalizeClientId(url.searchParams.get('clientId'));
        const kind = String(url.searchParams.get('kind') || 'workspace');
        if (!['gallery', 'preferences', 'workspace', 'project'].includes(kind)) throw httpError(400, 'Tipo inválido.');
        const filename = kind === 'project' ? 'project.hfp' : `${kind}.json`;
        const file = await getGithubFile(env, `users/${clientId}/${filename}`);
        if (!file) return json({ ok: true, found: false }, 200, cors);
        return json({ ok: true, found: true, data: JSON.parse(base64ToUtf8(file.content)) }, 200, cors);
      }

      if (url.pathname === '/api/image' && request.method === 'GET') {
        const clientId = normalizeClientId(url.searchParams.get('clientId'));
        const id = normalizeId(url.searchParams.get('id'));
        const file = await getGithubFile(env, `users/${clientId}/gallery/${id}.png`);
        if (!file) return json({ error: 'Imagem não encontrada.' }, 404, cors);
        return new Response(base64ToBytes(file.content), {
          status: 200,
          headers: { ...cors, 'content-type': 'image/png', 'cache-control': 'private, max-age=60' }
        });
      }

      return json({ error: 'Rota não encontrada.' }, 404, cors);
    } catch (error) {
      return json({ error: error.message || 'Erro interno.' }, error.status || 500, cors);
    }
  }
};

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

async function github(env, path, options = {}) {
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
  const body = text ? JSON.parse(text) : null;
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
