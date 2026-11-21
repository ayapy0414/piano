// URLから作品を取り込み、各話の本文と画像を保存する。
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { http as defaultHttp } from './fetcher.js';
import { sanitizeHtml } from './sanitize.js';
import { findSite, getSite } from './sites/index.js';
import * as store from './store.js';

let http = defaultHttp;
// テスト用に通信部分を差し替えられるようにする
export const setHttp = (h) => (http = h || defaultHttp);

const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
};

const now = () => new Date().toISOString();

// 本文中の<img>をダウンロードしてローカルのURLに書き換える
async function localizeImages(workId, html, pageUrl, episodeIndex, imagesMeta) {
  if (!html || !/<img/i.test(html)) return { html, count: 0 };
  const $ = cheerio.load(`<div id="__r">${html}</div>`, null, false);
  let count = 0;
  for (const img of $('img').toArray()) {
    const src = $(img).attr('src');
    if (!src || src.startsWith('data:')) continue;
    const hash = createHash('sha1').update(src).digest('hex').slice(0, 20);
    try {
      let file = Object.keys(imagesMeta).find((f) => f.startsWith(hash + '.'));
      if (!file) {
        const r = await http.raw(src, { referer: pageUrl, accept: 'image/*,*/*;q=0.5' });
        const type = r.contentType.split(';')[0].trim();
        const ext = EXT[type];
        if (!ext) throw new Error(`画像ではありません (${type || '不明'})`);
        file = `${hash}.${ext}`;
        await fs.mkdir(store.imageDir(workId), { recursive: true });
        await fs.writeFile(path.join(store.imageDir(workId), file), r.buffer);
        imagesMeta[file] = { url: src, episode: episodeIndex, size: r.buffer.length, savedAt: now() };
      }
      $(img).attr('src', `/media/${workId}/${file}`);
      count++;
    } catch (e) {
      $(img).replaceWith(
        `<span class="img-missing">［画像を取得できませんでした: ${src.replace(/[<>&"]/g, '')}］</span>`
      );
    }
  }
  return { html: $('#__r').html(), count };
}

// 取得した1話分を無害化・画像保存して書き込む
async function storeEpisode(work, index, raw) {
  const ep = work.episodes[index];
  const base = raw.url || ep.url;
  const out = {
    index,
    title: raw.title || ep.title,
    url: ep.url,
    fetchedAt: now(),
  };
  let images = 0;
  for (const part of ['preface', 'body', 'afterword']) {
    const clean = sanitizeHtml(raw[part] || '', base);
    const r = await localizeImages(work.id, clean, base, index, work.images);
    out[part] = r.html;
    images += r.count;
  }
  if (!out.body) throw new Error('本文が見つかりませんでした（ページの構造が変わった可能性があります）');
  await store.saveEpisode(work.id, index, out);
  ep.fetchedAt = out.fetchedAt;
  ep.imageCount = images;
  return out;
}

function mergeEpisodes(oldEps = [], newEps) {
  const byUrl = new Map(oldEps.map((e) => [e.url, e]));
  return newEps.map((e, i) => {
    const old = byUrl.get(e.url);
    return {
      index: i,
      title: e.title,
      chapter: e.chapter || null,
      url: e.url,
      fetchedAt: old && old.index === i ? old.fetchedAt : null,
      imageCount: old && old.index === i ? old.imageCount || 0 : 0,
    };
  });
}

export async function importUrl(url) {
  let parsed;
  try {
    parsed = findSite(url.trim());
  } catch {
    throw new Error('URLの形式が正しくありません');
  }
  const { site, u } = parsed;
  const data = await site.fetchWork(u, http);
  if (!data.episodes?.length) throw new Error('目次（話の一覧）が見つかりませんでした');
  const id = `${site.id}-${data.key}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

  return store.withLock(id, async () => {
    const existing = await store.getWork(id);
    const work = {
      id,
      site: site.id,
      siteName: site.name,
      sourceUrl: data.url,
      title: data.title || '(無題)',
      author: data.author || '',
      authorUrl: data.authorUrl || null,
      synopsis: data.synopsis || '',
      importedAt: existing?.importedAt || now(),
      updatedAt: now(),
      lastRead: existing?.lastRead ?? null,
      images: existing?.images || {},
      episodes: mergeEpisodes(existing?.episodes, data.episodes),
    };
    // 目次と一緒に取得できた本文（短編など）は保存しておく
    for (const [i, raw] of Object.entries(data.prefetched || {})) {
      await storeEpisode(work, Number(i), raw);
    }
    await store.saveWork(work);
    return { work, isNew: !existing, added: work.episodes.length - (existing?.episodes.length || 0) };
  });
}

export async function refreshWork(id) {
  const work = await store.getWork(id);
  if (!work) throw new Error('作品が見つかりません');
  return importUrl(work.sourceUrl);
}

const inflight = new Map();

export async function loadEpisode(id, index, { force = false } = {}) {
  index = Number(index);
  if (!force) {
    const cached = await store.getEpisode(id, index);
    if (cached) return cached;
  }
  const key = `${id}/${index}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const work = await store.getWork(id);
    if (!work) throw new Error('作品が見つかりません');
    const ep = work.episodes[index];
    if (!ep) throw new Error('その話は存在しません');
    const site = getSite(work.site);
    const raw = await site.fetchEpisode(ep.url, http);
    return store.withLock(id, async () => {
      const fresh = await store.getWork(id);
      const out = await storeEpisode(fresh, index, raw);
      await store.saveWork(fresh);
      return out;
    });
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

// ---- 全話の一括取得（バックグラウンド） ----
const jobs = new Map();

export function getJob(id) {
  return jobs.get(id) || null;
}

export function startDownloadAll(id, { force = false } = {}) {
  const current = jobs.get(id);
  if (current?.running) return current;
  const job = { running: true, total: 0, done: 0, failed: [], startedAt: now(), finishedAt: null, cancel: false };
  jobs.set(id, job);
  (async () => {
    try {
      const work = await store.getWork(id);
      const targets = work.episodes.filter((e) => force || !e.fetchedAt).map((e) => e.index);
      job.total = targets.length;
      for (const i of targets) {
        if (job.cancel) break;
        try {
          await loadEpisode(id, i, { force });
        } catch (e) {
          job.failed.push({ index: i, error: e.message });
        }
        job.done++;
      }
    } catch (e) {
      job.error = e.message;
    } finally {
      job.running = false;
      job.finishedAt = now();
    }
  })();
  return job;
}

export function cancelJob(id) {
  const job = jobs.get(id);
  if (job) job.cancel = true;
  return job;
}
