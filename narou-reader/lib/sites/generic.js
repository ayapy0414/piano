// 汎用: 対応サイト以外のページ（ブログ・個人サイト等）や画像URLを1話の作品として取り込む
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { decodeHtml } from '../fetcher.js';
import { textToHtml } from '../sanitize.js';
import { clean, firstText, metaContent } from './util.js';

const CANDIDATES = [
  '[itemprop="articleBody"]', 'article .entry-content', '.entry-content', '.post-content',
  '.article-body', 'article', 'main', '#main', '#content', '.content',
];

function largestTextBlock($) {
  let best = null;
  let bestLen = 0;
  $('div, section, td').each((_, el) => {
    const $el = $(el);
    // 直下の段落・テキストの量で評価する
    const len = $el.children('p, br').length * 40 +
      $el.contents().filter((_, n) => n.type === 'text').text().trim().length;
    if (len > bestLen) {
      bestLen = len;
      best = $el;
    }
  });
  return best;
}

export function parsePage(html, url) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, aside, form, iframe, noscript').remove();
  let body = null;
  for (const s of CANDIDATES) {
    const el = $(s).first();
    if (el.length && clean(el.text()).length > 200) {
      body = el;
      break;
    }
  }
  body = body || largestTextBlock($) || $('body');
  const title = metaContent($, 'og:title') || firstText($, ['h1', 'title']) || url;
  return {
    title,
    author: metaContent($, 'author') || metaContent($, 'article:author'),
    synopsis: metaContent($, 'og:description') || metaContent($, 'description'),
    episode: { title, preface: '', body: body.html() || '', afterword: '', url },
  };
}

const keyOf = (url) => createHash('sha1').update(url).digest('hex').slice(0, 12);
const fileName = (u) => decodeURIComponent(u.pathname.split('/').pop() || '') || u.hostname;

// レスポンスの種類（画像・テキスト・HTML）に応じて1話分の内容を作る
function pageFromResponse(r) {
  const u = new URL(r.url);
  if (r.contentType.startsWith('image/')) {
    const name = fileName(u);
    const body = `<p><img src="${r.url.replace(/"/g, '%22')}" alt=""></p>`;
    return { title: name, author: u.hostname, synopsis: '', episode: { title: name, preface: '', body, afterword: '', url: r.url } };
  }
  if (r.contentType && !/html|xml|text\/plain/.test(r.contentType)) {
    throw new Error(`取り込めない形式です (${r.contentType})`);
  }
  const text = decodeHtml(r.buffer, r.contentType);
  if (r.contentType.startsWith('text/plain')) {
    const name = fileName(u);
    return { title: name, author: u.hostname, synopsis: '', episode: { title: name, preface: '', body: textToHtml(text), afterword: '', url: r.url } };
  }
  return parsePage(text, r.url);
}

export default {
  id: 'web',
  name: 'その他のWebページ / 画像',
  examples: ['https://example.com/story.html', 'https://example.com/image.png'],
  match: () => true,
  async fetchWork(u, http) {
    const r = await http.raw(u.href);
    const page = pageFromResponse(r);
    return {
      key: keyOf(r.url), url: u.href, title: page.title, author: page.author || u.hostname,
      authorUrl: null, synopsis: page.synopsis, episodes: [{ title: page.title, url: r.url }],
      prefetched: { 0: page.episode },
    };
  },
  async fetchEpisode(url, http) {
    return pageFromResponse(await http.raw(url)).episode;
  },
};
