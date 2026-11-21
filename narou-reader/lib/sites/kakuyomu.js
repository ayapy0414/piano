// カクヨム
import * as cheerio from 'cheerio';
import { absUrl, clean, firstText, metaContent } from './util.js';

function parse(u) {
  const m = u.pathname.match(/^\/works\/(\d+)(?:\/episodes\/(\d+))?/);
  if (!m) return null;
  return { key: m[1], workUrl: `https://kakuyomu.jp/works/${m[1]}`, episode: m[2] || null };
}

// Next.js の __NEXT_DATA__ に入っている Apollo キャッシュから目次を組み立てる
function fromNextData($, key, workUrl) {
  const raw = $('script#__NEXT_DATA__').html();
  if (!raw) return null;
  let state;
  try {
    state = JSON.parse(raw)?.props?.pageProps?.__APOLLO_STATE__;
  } catch {
    return null;
  }
  if (!state) return null;
  const deref = (v) => (v && v.__ref ? state[v.__ref] : v);
  const work = state[`Work:${key}`];
  if (!work) return null;
  const author = deref(work.author) || {};
  const episodes = [];
  const toc = work.tableOfContents || work.tableOfContentsV2 || [];
  for (const entry of toc) {
    const sec = deref(entry);
    if (!sec) continue;
    const chap = deref(sec.chapter);
    const chapter = chap?.title ? clean(chap.title) : null;
    for (const epRef of sec.episodeUnions || sec.episodes || []) {
      const ep = deref(epRef);
      if (!ep?.id) continue;
      episodes.push({ title: clean(ep.title), url: `${workUrl}/episodes/${ep.id}`, chapter });
    }
  }
  return {
    title: clean(work.title),
    author: clean(author.activityName || author.name || ''),
    authorUrl: author.name ? `https://kakuyomu.jp/users/${author.name}` : null,
    synopsis: clean([work.catchphrase, work.introduction].filter(Boolean).join('\n\n'), true),
    episodes,
  };
}

export function parseToc(html, key, workUrl) {
  const $ = cheerio.load(html);
  const data = fromNextData($, key, workUrl);
  if (data && data.episodes.length) return data;
  // フォールバック: ページ内のエピソードリンクを拾う
  const seen = new Set();
  const episodes = [];
  $(`a[href*="/works/${key}/episodes/"]`).each((_, a) => {
    const href = absUrl($(a).attr('href'), workUrl);
    const id = href && href.match(/episodes\/(\d+)/)?.[1];
    if (!id || seen.has(id)) return;
    seen.add(id);
    episodes.push({ title: clean($(a).text()) || `エピソード${episodes.length + 1}`, url: `${workUrl}/episodes/${id}`, chapter: null });
  });
  return {
    title: data?.title || firstText($, ['#workTitle', 'h1']) || metaContent($, 'og:title'),
    author: data?.author || firstText($, ['#workAuthor-activityName']),
    authorUrl: data?.authorUrl || null,
    synopsis: data?.synopsis || metaContent($, 'og:description'),
    episodes,
  };
}

export function parseEpisode(html, url) {
  const $ = cheerio.load(html);
  return {
    title: firstText($, ['.widget-episodeTitle', '.episodeTitle']) || metaContent($, 'og:title'),
    preface: '',
    body: $('.widget-episodeBody').first().html() || '',
    afterword: '',
    url,
  };
}

export default {
  id: 'kakuyomu',
  name: 'カクヨム',
  examples: ['https://kakuyomu.jp/works/0000000000000000000'],
  match: (u) => u.hostname === 'kakuyomu.jp' && !!parse(u),
  async fetchWork(u, http) {
    const { key, workUrl } = parse(u);
    const { html } = await http.text(workUrl);
    return { key, url: workUrl, ...parseToc(html, key, workUrl) };
  },
  async fetchEpisode(url, http) {
    const { html, url: finalUrl } = await http.text(url);
    return parseEpisode(html, finalUrl);
  },
};
