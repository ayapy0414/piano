// なろう系リーダー: ローカルで動くWeb小説リーダーのサーバー
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as importer from './lib/importer.js';
import * as store from './lib/store.js';
import { sites } from './lib/sites/index.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.json': 'application/json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1e6) throw Object.assign(new Error('リクエストが大きすぎます'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSONの形式が正しくありません'), { status: 400 });
  }
}

function summarize(w) {
  const cached = w.episodes.filter((e) => e.fetchedAt).length;
  return {
    id: w.id, site: w.site, siteName: w.siteName, title: w.title, author: w.author,
    sourceUrl: w.sourceUrl, episodeCount: w.episodes.length, cachedCount: cached,
    imageCount: Object.keys(w.images || {}).length, importedAt: w.importedAt,
    updatedAt: w.updatedAt, lastRead: w.lastRead, job: importer.getJob(w.id),
  };
}

function workDetail(w) {
  const { images, ...rest } = w;
  return { ...rest, imageCount: Object.keys(images || {}).length, job: importer.getJob(w.id) };
}

// 作品フォルダ内のファイルに、元URLや話タイトルを添えて返す
const KIND_ORDER = { toc: 0, episode: 1, image: 2, other: 3 };

async function describeFiles(w) {
  const files = await store.listFiles(w.id);
  return files.map((f) => {
    const ep = f.path.match(/^episodes\/(\d+)\.json$/);
    const img = f.path.match(/^images\/(.+)$/);
    if (f.path === 'work.json') return { ...f, kind: 'toc', label: '作品情報・目次', sourceUrl: w.sourceUrl };
    if (ep) {
      const e = w.episodes[Number(ep[1])];
      return { ...f, kind: 'episode', index: Number(ep[1]), label: e?.title || `第${Number(ep[1]) + 1}話`, sourceUrl: e?.url };
    }
    if (img) {
      const m = w.images?.[img[1]];
      return { ...f, kind: 'image', label: img[1], sourceUrl: m?.url, episode: m?.episode, localUrl: `/media/${w.id}/${img[1]}` };
    }
    return { ...f, kind: 'other', label: f.path };
  }).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.index ?? 0) - (b.index ?? 0) || a.path.localeCompare(b.path));
}

async function loadWorkOr404(id) {
  if (!store.isValidId(id)) throw Object.assign(new Error('作品が見つかりません'), { status: 404 });
  const w = await store.getWork(id);
  if (!w) throw Object.assign(new Error('作品が見つかりません'), { status: 404 });
  return w;
}

async function api(req, res, parts) {
  const method = req.method;
  // /api/sites
  if (parts[0] === 'sites' && method === 'GET') {
    return send(res, 200, sites.map((s) => ({ id: s.id, name: s.name, examples: s.examples })));
  }
  // /api/import
  if (parts[0] === 'import' && method === 'POST') {
    const { url, downloadAll } = await readBody(req);
    if (!url || typeof url !== 'string') throw Object.assign(new Error('URLを入力してください'), { status: 400 });
    const r = await importer.importUrl(url);
    if (downloadAll) importer.startDownloadAll(r.work.id);
    return send(res, 200, { work: workDetail(r.work), isNew: r.isNew, added: r.added });
  }
  // /api/files 全作品のファイル一覧
  if (parts[0] === 'files' && method === 'GET') {
    const works = await store.listWorks();
    const out = [];
    for (const w of works) {
      for (const f of await describeFiles(w)) out.push({ ...f, workId: w.id, workTitle: w.title, site: w.siteName });
    }
    return send(res, 200, out);
  }
  if (parts[0] !== 'works') return send(res, 404, { error: 'not found' });

  if (parts.length === 1 && method === 'GET') {
    const works = await store.listWorks();
    works.sort((a, b) => (b.lastRead?.at || b.updatedAt).localeCompare(a.lastRead?.at || a.updatedAt));
    return send(res, 200, works.map(summarize));
  }
  const id = parts[1];
  const w = await loadWorkOr404(id);
  const sub = parts[2];

  if (!sub && method === 'GET') return send(res, 200, workDetail(w));
  if (!sub && method === 'DELETE') {
    importer.cancelJob(id);
    await store.deleteWork(id);
    return send(res, 200, { ok: true });
  }
  if (sub === 'refresh' && method === 'POST') {
    const r = await importer.refreshWork(id);
    return send(res, 200, { work: workDetail(r.work), added: r.added });
  }
  if (sub === 'download' && method === 'POST') {
    const { force } = await readBody(req);
    return send(res, 200, importer.startDownloadAll(id, { force: !!force }));
  }
  if (sub === 'download' && method === 'DELETE') return send(res, 200, importer.cancelJob(id) || {});
  if (sub === 'files' && method === 'GET') return send(res, 200, await describeFiles(w));
  if (sub === 'progress' && method === 'POST') {
    const { index, ratio } = await readBody(req);
    if (!Number.isInteger(index) || !w.episodes[index]) throw Object.assign(new Error('不正な話番号'), { status: 400 });
    await store.withLock(id, async () => {
      const fresh = await store.getWork(id);
      fresh.lastRead = { index, ratio: Math.max(0, Math.min(1, Number(ratio) || 0)), at: new Date().toISOString() };
      await store.saveWork(fresh);
    });
    return send(res, 200, { ok: true });
  }
  if (sub === 'episodes' && parts[3] !== undefined && method === 'GET') {
    const index = Number(parts[3]);
    if (!Number.isInteger(index) || !w.episodes[index]) throw Object.assign(new Error('その話は存在しません'), { status: 404 });
    const force = new URL(req.url, 'http://x').searchParams.get('refetch') === '1';
    const ep = await importer.loadEpisode(id, index, { force });
    const meta = w.episodes[index];
    return send(res, 200, { ...ep, chapter: meta.chapter, total: w.episodes.length });
  }
  return send(res, 404, { error: 'not found' });
}

async function serveFile(res, file, cache = false) {
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': cache ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...SECURITY_HEADERS,
    });
    res.end(data);
  } catch {
    send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (parts[0] === 'api') return await api(req, res, parts.slice(1));
    if (parts[0] === 'media' && parts.length === 3) {
      if (!store.isValidId(parts[1])) return send(res, 404, 'Not Found', 'text/plain');
      const file = store.imagePath(parts[1], parts[2]);
      return file ? serveFile(res, file, true) : send(res, 404, 'Not Found', 'text/plain');
    }
    const rel = pathname === '/' ? 'index.html' : path.normalize(pathname).replace(/^([/\\])+/, '');
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    return serveFile(res, file);
  } catch (e) {
    const status = e.name === 'HttpError' ? 502 : e.status || 500;
    if (status >= 500) console.error(e);
    send(res, status, { error: e.message || String(e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`なろう系リーダー: http://${HOST}:${PORT}/`);
  console.log(`データ保存先: ${store.DATA_DIR}`);
});
