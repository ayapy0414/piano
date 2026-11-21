// 取得元サイトへのHTTPアクセス。
// 同じホストへは間隔を空けてアクセスし、相手サーバーに負荷をかけないようにする。

const DEFAULT_UA =
  process.env.NAROU_READER_UA ||
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 NarouReader/0.1';

const MIN_INTERVAL_MS = Number(process.env.NAROU_READER_INTERVAL_MS ?? 1000);
const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 30000;

// ホストごとの年齢確認クッキー
const COOKIES = {
  'novel18.syosetu.com': 'over18=yes',
  'ncode.syosetu.com': 'over18=yes',
  'syosetu.org': 'over18=off',
};

const lastAccess = new Map();
const hostQueues = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

// 同一ホストへのリクエストを直列化し、最低間隔を守る
function throttle(host, fn) {
  const prev = hostQueues.get(host) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const wait = (lastAccess.get(host) || 0) + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await fn();
      } finally {
        lastAccess.set(host, Date.now());
      }
    });
  hostQueues.set(host, next);
  return next;
}

export async function fetchRaw(url, { referer, accept } = {}) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error(`対応していないURLです: ${url}`);
  return throttle(u.host, async () => {
    const headers = {
      'User-Agent': DEFAULT_UA,
      'Accept-Language': 'ja,en;q=0.8',
      Accept: accept || 'text/html,application/xhtml+xml,*/*;q=0.8',
    };
    if (referer) headers.Referer = referer;
    if (COOKIES[u.hostname]) headers.Cookie = COOKIES[u.hostname];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      let res;
      try {
        res = await fetch(u, { headers, redirect: 'follow', signal: ctrl.signal });
      } catch (e) {
        const why = e.name === 'AbortError' ? '時間切れ' : e.cause?.code || e.message;
        throw new Error(`${u.hostname} に接続できませんでした (${why})`);
      }
      if (!res.ok) throw new HttpError(res.status, url);
      const len = Number(res.headers.get('content-length') || 0);
      if (len > MAX_BYTES) throw new Error(`ファイルが大きすぎます (${len} bytes): ${url}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_BYTES) throw new Error(`ファイルが大きすぎます: ${url}`);
      return {
        url: res.url || url,
        status: res.status,
        contentType: (res.headers.get('content-type') || '').toLowerCase(),
        buffer,
      };
    } finally {
      clearTimeout(timer);
    }
  });
}

// HTMLの文字コードを判定してデコードする（青空文庫などのShift_JISに対応）
export function decodeHtml(buffer, contentType = '') {
  let charset = (contentType.match(/charset=([\w-]+)/i) || [])[1];
  if (!charset) {
    const head = buffer.subarray(0, 4096).toString('latin1');
    charset =
      (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] ||
      (head.match(/<\?xml[^>]+encoding=["']([\w-]+)/i) || [])[1];
  }
  charset = (charset || 'utf-8').toLowerCase();
  if (charset === 'x-sjis' || charset === 'sjis') charset = 'shift_jis';
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

export async function fetchText(url, opts) {
  const r = await fetchRaw(url, opts);
  return { ...r, html: decodeHtml(r.buffer, r.contentType) };
}

export const http = { raw: fetchRaw, text: fetchText };
