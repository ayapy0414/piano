// 取り込んだ作品をディスク上に保存する。
//   data/works/<作品ID>/work.json         作品情報と目次
//   data/works/<作品ID>/episodes/<n>.json 各話の本文
//   data/works/<作品ID>/images/<hash>.<ext> 本文中の画像
import fs from 'node:fs/promises';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.NAROU_READER_DATA || path.join(process.cwd(), 'data'));
const WORKS_DIR = path.join(DATA_DIR, 'works');

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/i;
export const isValidId = (id) => ID_RE.test(id);

function workDir(id) {
  if (!isValidId(id)) throw new Error(`不正な作品IDです: ${id}`);
  return path.join(WORKS_DIR, id);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 1));
  await fs.rename(tmp, file);
}

// 作品ごとの書き込みを直列化する
const locks = new Map();
export function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(id, next);
  next.finally(() => locks.get(id) === next && locks.delete(id)).catch(() => {});
  return next;
}

export const getWork = (id) => readJson(path.join(workDir(id), 'work.json'));
export const saveWork = (work) => writeJson(path.join(workDir(work.id), 'work.json'), work);

export async function listWorks() {
  let names = [];
  try {
    names = await fs.readdir(WORKS_DIR);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const works = [];
  for (const n of names) {
    if (!isValidId(n)) continue;
    const w = await getWork(n).catch(() => null);
    if (w) works.push(w);
  }
  return works;
}

export async function deleteWork(id) {
  await fs.rm(workDir(id), { recursive: true, force: true });
}

const episodeFile = (id, index) => path.join(workDir(id), 'episodes', `${Number(index)}.json`);
export const getEpisode = (id, index) => readJson(episodeFile(id, index));
export const saveEpisode = (id, index, ep) => writeJson(episodeFile(id, index), ep);

export function imageDir(id) {
  return path.join(workDir(id), 'images');
}

export function imagePath(id, file) {
  if (!/^[a-f0-9]{8,64}\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file)) return null;
  return path.join(imageDir(id), file);
}

// 作品フォルダ内のファイル一覧（種類・サイズ・更新日時）
export async function listFiles(id) {
  const dir = workDir(id);
  const out = [];
  async function scan(sub) {
    let entries = [];
    try {
      entries = await fs.readdir(path.join(dir, sub), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) await scan(rel);
      else if (!e.name.endsWith('.tmp')) {
        const st = await fs.stat(path.join(dir, rel));
        out.push({ path: rel, size: st.size, mtime: st.mtime.toISOString() });
      }
    }
  }
  await scan('');
  return out;
}
