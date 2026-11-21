// ハーメルン (syosetu.org)
import * as cheerio from 'cheerio';
import { absUrl, clean, htmlToText, metaContent } from './util.js';

function parse(u) {
  const m = u.pathname.match(/^\/novel\/(\d+)(?:\/(\d+)\.html)?/);
  if (!m) return null;
  return { key: m[1], workUrl: `https://syosetu.org/novel/${m[1]}/`, episode: m[2] ? Number(m[2]) : null };
}

function titleFromHead($) {
  // 例: 「話タイトル - 作品タイトル - ハーメルン」
  return clean($('title').text()).split(/\s+-\s+/)[0];
}

export function parseEpisode(html, url) {
  const $ = cheerio.load(html);
  const styled = $('#maind span')
    .filter((_, e) => /font-size:\s*120%/.test($(e).attr('style') || ''))
    .first();
  return {
    title: clean(styled.text()) || titleFromHead($),
    preface: $('#maegaki').html() || '',
    body: $('#honbun').html() || '',
    afterword: $('#atogaki').html() || '',
    url,
  };
}

export function parseToc(html, workUrl) {
  const $ = cheerio.load(html);
  const info = $('#maind .ss').first();
  const authorEl = $('[itemprop="author"]').first();
  // あらすじは作品情報ブロックの最初の<hr>以降
  let synopsis = '';
  const parts = (info.html() || '').split(/<hr[^>]*>/i);
  if (parts.length > 1) synopsis = htmlToText(parts[1]);
  if (!synopsis) {
    const ss = $('#maind .ss').eq(1);
    if (!ss.find('table').length) synopsis = clean(ss.text(), true);
  }
  const episodes = [];
  let chapter = null;
  $('#maind table tr').each((_, tr) => {
    const $tr = $(tr);
    const colspan = $tr.find('td[colspan]');
    if (colspan.length && !$tr.find('a[href]').length) {
      chapter = clean(colspan.text());
      return;
    }
    const a = $tr.find('a[href]').filter((_, e) => /(^|\/)\d+\.html$/.test($(e).attr('href'))).first();
    if (a.length) episodes.push({ title: clean(a.text()), url: absUrl(a.attr('href'), workUrl), chapter });
  });
  return {
    title: clean($('[itemprop="name"]').first().text()) || metaContent($, 'og:title') || titleFromHead($),
    author: clean(authorEl.text()),
    authorUrl: absUrl(authorEl.find('a').attr('href') || authorEl.closest('a').attr('href'), workUrl),
    synopsis,
    episodes,
    isSingle: !episodes.length && $('#honbun').length > 0,
  };
}

export default {
  id: 'hameln',
  name: 'ハーメルン',
  examples: ['https://syosetu.org/novel/000000/'],
  match: (u) => u.hostname === 'syosetu.org' && !!parse(u),
  async fetchWork(u, http) {
    const { key, workUrl } = parse(u);
    const { html } = await http.text(workUrl);
    const toc = parseToc(html, workUrl);
    if (toc.isSingle) {
      const ep = parseEpisode(html, workUrl);
      return { key, url: workUrl, ...toc, episodes: [{ title: toc.title, url: workUrl }], prefetched: { 0: ep } };
    }
    return { key, url: workUrl, ...toc };
  },
  async fetchEpisode(url, http) {
    const { html, url: finalUrl } = await http.text(url);
    return parseEpisode(html, finalUrl);
  },
};
