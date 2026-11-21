// 青空文庫 (XHTML版)。図書カードのURLでも本文ファイルのURLでも可。
import * as cheerio from 'cheerio';
import { absUrl, clean, firstText } from './util.js';

const HOSTS = ['www.aozora.gr.jp', 'aozora.gr.jp'];

export function parseText(html, url) {
  const $ = cheerio.load(html);
  return {
    title: firstText($, ['h1.title', 'title']),
    author: firstText($, ['h2.author', '.author']),
    episode: {
      title: firstText($, ['h1.title', 'title']),
      preface: '',
      body: $('.main_text').first().html() || $('body').html() || '',
      afterword: $('.bibliographical_information').first().html() || '',
      url,
    },
  };
}

export function findXhtmlLink(html, cardUrl) {
  const $ = cheerio.load(html);
  const a = $('a[href]')
    .filter((_, e) => /files\/[^/]+\.html?$/.test($(e).attr('href')))
    .first();
  return a.length ? absUrl(a.attr('href'), cardUrl) : null;
}

export default {
  id: 'aozora',
  name: '青空文庫',
  examples: ['https://www.aozora.gr.jp/cards/000148/card789.html'],
  match: (u) => HOSTS.includes(u.hostname) && /^\/cards\/\d+\/(card\d+\.html|files\/[^/]+\.html?)$/.test(u.pathname),
  async fetchWork(u, http) {
    let textUrl = u.href;
    let cardUrl = null;
    if (/card\d+\.html$/.test(u.pathname)) {
      cardUrl = u.href;
      const { html } = await http.text(u.href);
      textUrl = findXhtmlLink(html, u.href);
      if (!textUrl) throw new Error('図書カードにXHTML版の本文が見つかりませんでした');
    }
    const { html, url } = await http.text(textUrl);
    const r = parseText(html, url);
    const key = new URL(url).pathname.match(/files\/([^/.]+)/)[1].replace(/[^\w-]/g, '_');
    return {
      key,
      url: cardUrl || url,
      title: r.title,
      author: r.author,
      authorUrl: null,
      synopsis: '',
      episodes: [{ title: r.title, url }],
      prefetched: { 0: r.episode },
    };
  },
  async fetchEpisode(url, http) {
    const { html, url: finalUrl } = await http.text(url);
    return parseText(html, finalUrl).episode;
  },
};
