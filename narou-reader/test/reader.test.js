import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fx = (n) => fs.readFileSync(path.join(FX, n));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narou-reader-test-'));
process.env.NAROU_READER_DATA = tmp;

const { sanitizeHtml } = await import('../lib/sanitize.js');
const { decodeHtml } = await import('../lib/fetcher.js');
const narou = await import('../lib/sites/narou.js');
const kakuyomu = await import('../lib/sites/kakuyomu.js');
const hameln = await import('../lib/sites/hameln.js');
const aozora = await import('../lib/sites/aozora.js');
const generic = await import('../lib/sites/generic.js');
const { findSite } = await import('../lib/sites/index.js');
const importer = await import('../lib/importer.js');
const store = await import('../lib/store.js');

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// URL → フィクスチャ の偽HTTP
function fakeHttp(routes) {
  const raw = async (url) => {
    const r = routes[url];
    if (!r) throw Object.assign(new Error(`HTTP 404: ${url}`), { name: 'HttpError', status: 404 });
    const [file, type] = r;
    return { url, status: 200, contentType: type || 'text/html; charset=utf-8', buffer: Buffer.isBuffer(file) ? file : fx(file) };
  };
  return { raw, text: async (url) => { const r = await raw(url); return { ...r, html: decodeHtml(r.buffer, r.contentType) }; }, calls: routes };
}

test('サイト判定', () => {
  assert.equal(findSite('https://ncode.syosetu.com/n1234ab/5/').site.id, 'narou');
  assert.equal(findSite('https://novel18.syosetu.com/n1234ab/').site.id, 'narou');
  assert.equal(findSite('https://kakuyomu.jp/works/123/episodes/456').site.id, 'kakuyomu');
  assert.equal(findSite('https://syosetu.org/novel/1234/3.html').site.id, 'hameln');
  assert.equal(findSite('https://www.aozora.gr.jp/cards/000879/card127.html').site.id, 'aozora');
  assert.equal(findSite('https://example.com/a.html').site.id, 'web');
  assert.equal(findSite('https://ncode.syosetu.com/rank/').site.id, 'web');
});

test('無害化: script・属性を除去し、ルビ・画像・縦中横を残す', () => {
  const out = sanitizeHtml('<p onclick="x()">12時<ruby>漢<rt>かん</rt></ruby><script>bad()</script><a href="javascript:x"><img src="/a.png" onerror="x"></a><iframe src="x"></iframe>!?</p><div>blk</div>', 'https://ex.com/p/');
  assert.ok(!/script|onclick|onerror|iframe|javascript/.test(out), out);
  assert.match(out, /<ruby>漢<rt>かん<\/rt><\/ruby>/);
  assert.match(out, /<img src="https:\/\/ex.com\/a.png">/);
  assert.match(out, /<span class="tcy">12<\/span>時/);
  assert.match(out, /<span class="tcy">!\?<\/span>/);
  assert.match(out, /<p>blk<\/p>/);
  // 3桁以上の数字は縦中横にしない
  assert.doesNotMatch(sanitizeHtml('<p>100日</p>', 'https://ex.com/'), /tcy/);
});

test('なろう: 目次と本文', () => {
  const toc = narou.parseToc(fx('narou-toc.html').toString(), 'https://ncode.syosetu.com/n1234ab/');
  assert.equal(toc.meta.title, '異世界で縦書きを広める話');
  assert.equal(toc.meta.author, '山田太郎');
  assert.equal(toc.meta.authorUrl, 'https://mypage.syosetu.com/12345/');
  assert.equal(toc.episodes.length, 2);
  assert.deepEqual(toc.episodes[0], { title: '第1話　転生', url: 'https://ncode.syosetu.com/n1234ab/1/', chapter: '第一章　始まり' });
  assert.equal(toc.next, 'https://ncode.syosetu.com/n1234ab/?p=2');
  const ep = narou.parseEpisode(fx('narou-ep.html').toString(), 'https://ncode.syosetu.com/n1234ab/1/');
  assert.equal(ep.title, '第1話　転生');
  assert.match(ep.preface, /前書き/);
  assert.match(ep.afterword, /後書き/);
  assert.match(ep.body, /異世界/);
  assert.doesNotMatch(ep.body, /前書き|後書き/);
});

test('カクヨム: __NEXT_DATA__ から目次', () => {
  const t = kakuyomu.parseToc(fx('kakuyomu-work.html').toString(), '1177354054881165840', 'https://kakuyomu.jp/works/1177354054881165840');
  assert.equal(t.title, 'カクヨムの物語');
  assert.equal(t.author, 'カクヨム作家');
  assert.equal(t.authorUrl, 'https://kakuyomu.jp/users/kaku_user');
  assert.equal(t.episodes.length, 3);
  assert.equal(t.episodes[1].chapter, '第一章');
  assert.equal(t.episodes[2].url, 'https://kakuyomu.jp/works/1177354054881165840/episodes/333');
  const ep = kakuyomu.parseEpisode(fx('kakuyomu-ep.html').toString(), 'x');
  assert.equal(ep.title, '第1話');
  assert.match(sanitizeHtml(ep.body, 'https://kakuyomu.jp/'), /<em class="emphasisDots">/);
});

test('ハーメルン: 目次と本文', () => {
  const t = hameln.parseToc(fx('hameln-toc.html').toString(), 'https://syosetu.org/novel/1234/');
  assert.equal(t.title, 'ハーメルンの物語');
  assert.equal(t.author, 'ハメ作者');
  assert.equal(t.authorUrl, 'https://syosetu.org/user/999/');
  assert.match(t.synopsis, /これはあらすじ。\n二行目。/);
  assert.deepEqual(t.episodes.map((e) => [e.title, e.chapter, e.url]), [
    ['第一話', '第一部', 'https://syosetu.org/novel/1234/1.html'],
    ['第二話', '第一部', 'https://syosetu.org/novel/1234/2.html'],
  ]);
  const ep = hameln.parseEpisode(fx('hameln-ep.html').toString(), 'x');
  assert.equal(ep.title, '第一話');
  assert.match(ep.body, /本文一行目/);
  assert.match(ep.preface, /前書き/);
});

test('青空文庫: Shift_JIS の本文と外字画像', () => {
  const buf = fx('aozora.html');
  const html = decodeHtml(buf, 'text/html');
  const r = aozora.parseText(html, 'https://www.aozora.gr.jp/cards/000879/files/127_15260.html');
  assert.equal(r.title, '羅生門');
  assert.equal(r.author, '芥川龍之介');
  const body = sanitizeHtml(r.episode.body, 'https://www.aozora.gr.jp/cards/000879/files/127_15260.html');
  assert.match(body, /<img src="https:\/\/www.aozora.gr.jp\/gaiji\/1-02\/1-02-22.png" alt="※" class="gaiji">/);
  assert.match(body, /<rb>下人<\/rb>/);
});

test('汎用ページ: 本文抽出', () => {
  const r = generic.parsePage(fx('generic.html').toString(), 'https://blog.example/post/1');
  assert.equal(r.title, '個人サイトの短編');
  assert.match(r.episode.body, /二段落目/);
  assert.doesNotMatch(r.episode.body, /メニュー|フッター/);
});

test('取り込み: なろう作品（目次2ページ・本文・挿絵の保存）', async () => {
  importer.setHttp(fakeHttp({
    'https://ncode.syosetu.com/n1234ab/': ['narou-toc.html'],
    'https://ncode.syosetu.com/n1234ab/?p=2': ['narou-toc-2.html'],
    'https://ncode.syosetu.com/n1234ab/1/': ['narou-ep.html'],
    'https://12345.mitemin.net/userpageimage/viewimagebig/icode/i000/': [PNG, 'image/png'],
  }));
  const r = await importer.importUrl('https://ncode.syosetu.com/n1234ab/1/');
  assert.equal(r.work.id, 'narou-n1234ab');
  assert.equal(r.work.episodes.length, 4);
  assert.equal(r.work.episodes[3].chapter, '第二章　王都');
  assert.equal(r.work.episodes[2].chapter, '第一章　始まり');

  const ep = await importer.loadEpisode('narou-n1234ab', 0);
  assert.match(ep.body, /<img src="\/media\/narou-n1234ab\/[a-f0-9]{20}\.png"/);
  assert.doesNotMatch(ep.body, /script|onclick/);
  const work = await store.getWork('narou-n1234ab');
  assert.ok(work.episodes[0].fetchedAt);
  assert.equal(work.episodes[0].imageCount, 1);
  const [file, meta] = Object.entries(work.images)[0];
  assert.equal(meta.url, 'https://12345.mitemin.net/userpageimage/viewimagebig/icode/i000/');
  assert.ok(fs.existsSync(store.imagePath('narou-n1234ab', file)));

  const files = await store.listFiles('narou-n1234ab');
  assert.deepEqual(files.map((f) => f.path).sort(), ['episodes/0.json', `images/${file}`, 'work.json']);

  // 一括取得: 取得できない話は失敗として記録される
  const job = importer.startDownloadAll('narou-n1234ab');
  while (job.running) await new Promise((r) => setTimeout(r, 10));
  assert.equal(job.total, 3);
  assert.equal(job.failed.length, 3);

  // 再取り込みしても保存状態は保たれる
  const again = await importer.importUrl('https://ncode.syosetu.com/n1234ab/');
  assert.equal(again.isNew, false);
  assert.ok(again.work.episodes[0].fetchedAt);
});

test('取り込み: 画像URLを直接', async () => {
  importer.setHttp(fakeHttp({ 'https://img.example/pics/cover.png': [PNG, 'image/png'] }));
  const r = await importer.importUrl('https://img.example/pics/cover.png');
  assert.equal(r.work.title, 'cover.png');
  const ep = await store.getEpisode(r.work.id, 0);
  assert.match(ep.body, /\/media\/web-[a-f0-9]+\/[a-f0-9]+\.png/);
});

test('ストア: 不正なIDやファイル名を拒否', () => {
  assert.equal(store.isValidId('../etc'), false);
  assert.equal(store.imagePath('narou-n1', '../work.json'), null);
});
