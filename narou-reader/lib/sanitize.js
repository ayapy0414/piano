// 取り込んだ本文HTMLを、表示に必要なタグだけ残して無害化する。
import * as cheerio from 'cheerio';

const ALLOWED = new Set([
  'p', 'br', 'ruby', 'rb', 'rt', 'rp', 'img', 'em', 'strong', 'b', 'i', 's', 'u',
  'sub', 'sup', 'hr', 'blockquote', 'h2', 'h3', 'h4', 'span',
]);
const DROP = new Set([
  'script', 'style', 'iframe', 'noscript', 'form', 'input', 'button', 'select', 'textarea',
  'svg', 'canvas', 'video', 'audio', 'object', 'embed', 'link', 'meta', 'nav', 'header',
  'footer', 'aside', 'template', 'title', 'head',
]);
const BLOCKISH = new Set([
  'div', 'section', 'article', 'li', 'dd', 'dt', 'h1', 'h5', 'h6', 'tr', 'pre', 'main', 'figure',
  'figcaption', 'td', 'th',
]);
const CLASS_KEEP = { em: ['emphasisDots'], img: ['gaiji'], span: ['tcy'] };

function hasBlockChild(node) {
  return (node.children || []).some(
    (c) => c.type === 'tag' && (BLOCKISH.has(c.name) || c.name === 'p' || c.name === 'blockquote')
  );
}

function resolveSrc(src, baseUrl) {
  if (!src) return null;
  src = src.trim();
  if (src.startsWith('data:image/')) return src;
  try {
    const u = new URL(src, baseUrl);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function cleanAttrs(node, baseUrl) {
  const name = node.name;
  const attrs = node.attribs || {};
  const out = {};
  if (name === 'img') {
    const src = resolveSrc(attrs['data-src'] || attrs['data-original'] || attrs.src, baseUrl);
    if (!src) return false;
    out.src = src;
    if (attrs.alt) out.alt = attrs.alt;
  }
  const keep = CLASS_KEEP[name];
  if (keep && attrs.class) {
    const cls = attrs.class.split(/\s+/).filter((c) => keep.includes(c));
    if (cls.length) out.class = cls.join(' ');
  }
  node.attribs = out;
  return true;
}

function walk($, node, baseUrl) {
  for (const child of [...(node.children || [])]) {
    if (child.type === 'text') continue;
    if (child.type !== 'tag') {
      // comment / script / style / directive / cdata
      $(child).remove();
      continue;
    }
    const name = child.name.toLowerCase();
    child.name = name;
    if (DROP.has(name)) {
      $(child).remove();
      continue;
    }
    walk($, child, baseUrl);
    if (ALLOWED.has(name)) {
      if (!cleanAttrs(child, baseUrl)) $(child).remove();
    } else if (BLOCKISH.has(name) && !hasBlockChild(child)) {
      child.name = 'p';
      child.attribs = {};
    } else {
      $(child).replaceWith(child.children || []);
    }
  }
}

const escapeHtml = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// 縦書きで横に倒れないよう、2桁の半角数字と「!?」「!!」を縦中横にする
const TCY_RE = /(?<![0-9A-Za-z.,])([0-9]{2}|[!?]{2})(?![0-9A-Za-z.,])/g;

function applyTcy($, node) {
  for (const child of [...(node.children || [])]) {
    if (child.type === 'tag') {
      if (child.name !== 'rt' && child.name !== 'rp') applyTcy($, child);
    } else if (child.type === 'text' && TCY_RE.test(child.data)) {
      TCY_RE.lastIndex = 0;
      const html = escapeHtml(child.data).replace(TCY_RE, '<span class="tcy">$1</span>');
      $(child).replaceWith(html);
    }
    TCY_RE.lastIndex = 0;
  }
}

export function sanitizeHtml(html, baseUrl) {
  if (!html) return '';
  const $ = cheerio.load(`<div id="__nr_root">${html}</div>`, null, false);
  const root = $('#__nr_root')[0];
  walk($, root, baseUrl);
  applyTcy($, root);
  return $(root).html().trim();
}

// プレーンテキストを段落HTMLに変換する
export function textToHtml(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>'))
    .join('\n');
}
