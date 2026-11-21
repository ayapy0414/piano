// 小説家になろう / ノクターン・ムーンライト (novel18)
import * as cheerio from 'cheerio';
import { absUrl, clean, firstText, htmlToText, metaContent } from './util.js';

const HOSTS = ['ncode.syosetu.com', 'novel18.syosetu.com'];

function parse(u) {
  const m = u.pathname.match(/^\/(n\d+[a-z]+)(?:\/(\d+))?/i);
  if (!m) return null;
  const key = m[1].toLowerCase();
  return { key, workUrl: `${u.protocol}//${u.host}/${key}/`, episode: m[2] ? Number(m[2]) : null };
}

export function parseEpisode(html, url) {
  const $ = cheerio.load(html);
  const title =
    firstText($, ['.p-novel__title--rensai', '.p-novel__subtitle-episode', '.novel_subtitle']) ||
    firstText($, ['.p-novel__title', '.novel_title']);
  const pick = (sels) => {
    for (const s of sels) {
      const el = $(s);
      if (el.length) return el.map((_, e) => $(e).html()).get().join('\n');
    }
    return '';
  };
  const body = pick([
    '.p-novel__body .js-novel-text:not(.p-novel__text--preface):not(.p-novel__text--afterword)',
    '#novel_honbun',
  ]);
  return {
    title,
    preface: pick(['.p-novel__text--preface', '#novel_p']),
    body,
    afterword: pick(['.p-novel__text--afterword', '#novel_a']),
    url,
  };
}

// 目次ページ1枚を解析する。chapterは前ページから引き継ぐ。
export function parseToc(html, pageUrl, chapter = null) {
  const $ = cheerio.load(html);
  const meta = {
    title: firstText($, ['.p-novel__title', '.novel_title']) || metaContent($, 'og:title'),
    author: clean(firstText($, ['.p-novel__author', '.novel_writername']).replace(/^作者[：:]/, '')),
    authorUrl: absUrl($('.p-novel__author a, .novel_writername a').first().attr('href'), pageUrl),
    synopsis: htmlToText($('#novel_ex, .p-novel__summary').first().html()),
  };
  const episodes = [];
  if ($('.p-eplist').length) {
    $('.p-eplist').children().each((_, el) => {
      const $el = $(el);
      if ($el.hasClass('p-eplist__chapter-title')) chapter = clean($el.text());
      else if ($el.hasClass('p-eplist__sublist')) {
        const a = $el.find('a.p-eplist__subtitle, a').first();
        if (a.attr('href')) episodes.push({ title: clean(a.text()), url: new URL(a.attr('href'), pageUrl).href, chapter });
      }
    });
  } else if ($('.index_box').length) {
    $('.index_box').children().each((_, el) => {
      const $el = $(el);
      if ($el.hasClass('chapter_title')) chapter = clean($el.text());
      else if ($el.is('dl.novel_sublist2')) {
        const a = $el.find('a').first();
        if (a.attr('href')) episodes.push({ title: clean(a.text()), url: new URL(a.attr('href'), pageUrl).href, chapter });
      }
    });
  }
  const nextHref = $('a.c-pager__item--next').attr('href');
  const isSingle = !episodes.length && $('.p-novel__body, #novel_honbun').length > 0;
  return { meta, episodes, chapter, next: nextHref ? new URL(nextHref, pageUrl).href : null, isSingle };
}

export default {
  id: 'narou',
  name: '小説家になろう',
  examples: ['https://ncode.syosetu.com/n0000aa/'],
  match: (u) => HOSTS.includes(u.hostname) && !!parse(u),
  async fetchWork(u, http) {
    const { key, workUrl } = parse(u);
    let pageUrl = workUrl;
    let meta = null;
    let chapter = null;
    const episodes = [];
    for (let page = 1; pageUrl && page <= 300; page++) {
      const { html } = await http.text(pageUrl);
      const toc = parseToc(html, pageUrl, chapter);
      if (!meta) meta = toc.meta;
      if (toc.isSingle && page === 1) {
        const ep = parseEpisode(html, workUrl);
        return { key, url: workUrl, ...meta, episodes: [{ title: meta.title, url: workUrl }], prefetched: { 0: ep } };
      }
      episodes.push(...toc.episodes);
      chapter = toc.chapter;
      pageUrl = toc.episodes.length ? toc.next : null;
    }
    return { key, url: workUrl, ...meta, episodes };
  },
  async fetchEpisode(url, http) {
    const { html, url: finalUrl } = await http.text(url);
    return parseEpisode(html, finalUrl);
  },
};
