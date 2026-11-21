// なろう系リーダー: 小説サイトのHTML解析（アプリ内の見えないWebViewで動く）
// Swift側から NR.parseToc / NR.parseEpisode を呼び、JSON文字列を受け取る。
(function () {
  'use strict';

  // ---------- 共通 ----------
  function clean(s, multiline) {
    if (!s) return '';
    // 全角スペース（　）はタイトルの一部なので残し、半角の空白だけ整理する
    s = s.replace(/\r\n?/g, '\n').replace(/[ \t\f\v ]+/g, ' ');
    if (!multiline) return s.replace(/[ \n]+/g, ' ').replace(/^ +| +$/g, '');
    return s.split('\n').map(function (l) { return l.replace(/^ +| +$/g, ''); })
      .join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  }
  function doc(html) { return new DOMParser().parseFromString(html, 'text/html'); }
  function q(d, sel) { try { return d.querySelector(sel); } catch (e) { return null; } }
  function qa(d, sel) { try { return Array.prototype.slice.call(d.querySelectorAll(sel)); } catch (e) { return []; } }
  function text(el) { return el ? clean(el.textContent) : ''; }
  function firstText(d, sels) {
    for (var i = 0; i < sels.length; i++) { var t = text(q(d, sels[i])); if (t) return t; }
    return '';
  }
  function meta(d, prop) {
    var el = q(d, 'meta[property="' + prop + '"], meta[name="' + prop + '"]');
    return el ? clean(el.getAttribute('content') || '') : '';
  }
  function abs(href, base) {
    if (!href) return null;
    try { return new URL(href, base).href; } catch (e) { return null; }
  }
  function htmlToText(html) {
    var d = doc('<div>' + (html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n') + '</div>');
    return clean(d.body.textContent, true);
  }
  function innerAll(els) { return els.map(function (e) { return e.innerHTML; }).join('\n'); }

  // ---------- 本文の無害化 ----------
  var ALLOWED = toSet('p br ruby rb rt rp img em strong b i s u sub sup hr blockquote h2 h3 h4 span');
  var DROP = toSet('script style iframe noscript form input button select textarea svg canvas video audio object embed link meta nav header footer aside template title head');
  var BLOCKISH = toSet('div section article li dd dt h1 h5 h6 tr pre main figure figcaption td th');
  var CLASS_KEEP = { em: ['emphasisDots'], img: ['gaiji'], span: ['tcy'] };
  function toSet(s) { var o = {}; s.split(' ').forEach(function (k) { o[k] = true; }); return o; }

  function hasBlockChild(el) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      var n = c.localName;
      if (BLOCKISH[n] || n === 'p' || n === 'blockquote') return true;
    }
    return false;
  }

  function cleanAttrs(el, base, images) {
    var name = el.localName;
    var keep = {};
    if (name === 'img') {
      var src = el.getAttribute('data-src') || el.getAttribute('data-original') || el.getAttribute('src');
      src = src && src.trim();
      if (!src) return false;
      if (!/^data:image\//.test(src)) {
        src = abs(src, base);
        if (!src || !/^https?:/.test(src)) return false;
        var idx = images.indexOf(src);
        if (idx < 0) { idx = images.length; images.push(src); }
        // 画像はアプリ側で保存してから差し替える
        keep.src = 'nrimg:' + idx;
      } else keep.src = src;
      if (el.getAttribute('alt')) keep.alt = el.getAttribute('alt');
    }
    var cls = CLASS_KEEP[name];
    if (cls && el.getAttribute('class')) {
      var c = el.getAttribute('class').split(/\s+/).filter(function (x) { return cls.indexOf(x) >= 0; });
      if (c.length) keep['class'] = c.join(' ');
    }
    while (el.attributes.length) el.removeAttribute(el.attributes[0].name);
    Object.keys(keep).forEach(function (k) { el.setAttribute(k, keep[k]); });
    return true;
  }

  function rename(el, tag) {
    var n = el.ownerDocument.createElement(tag);
    while (el.firstChild) n.appendChild(el.firstChild);
    el.parentNode.replaceChild(n, el);
    return n;
  }
  function unwrap(el) {
    var p = el.parentNode;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
  }

  function walk(node, base, images) {
    var children = Array.prototype.slice.call(node.childNodes);
    children.forEach(function (c) {
      if (c.nodeType === 3) return;
      if (c.nodeType !== 1) { c.parentNode.removeChild(c); return; }
      var name = c.localName;
      if (DROP[name]) { c.parentNode.removeChild(c); return; }
      walk(c, base, images);
      if (ALLOWED[name]) {
        if (!cleanAttrs(c, base, images)) c.parentNode.removeChild(c);
      } else if (BLOCKISH[name] && !hasBlockChild(c)) rename(c, 'p');
      else unwrap(c);
    });
  }

  // 縦書きで横に倒れないよう、2桁の半角数字と「!?」「!!」を縦中横にする
  var TCY = /(^|[^0-9A-Za-z.,])([0-9]{2}|[!?]{2})(?![0-9A-Za-z.,])/g;
  function applyTcy(node) {
    Array.prototype.slice.call(node.childNodes).forEach(function (c) {
      if (c.nodeType === 1) {
        if (c.localName !== 'rt' && c.localName !== 'rp') applyTcy(c);
        return;
      }
      if (c.nodeType !== 3) return;
      var s = c.data;
      TCY.lastIndex = 0;
      if (!TCY.test(s)) return;
      TCY.lastIndex = 0;
      var frag = c.ownerDocument.createDocumentFragment();
      var last = 0, m;
      while ((m = TCY.exec(s))) {
        var start = m.index + m[1].length;
        frag.appendChild(c.ownerDocument.createTextNode(s.slice(last, start)));
        var sp = c.ownerDocument.createElement('span');
        sp.className = 'tcy';
        sp.textContent = m[2];
        frag.appendChild(sp);
        last = start + m[2].length;
      }
      frag.appendChild(c.ownerDocument.createTextNode(s.slice(last)));
      c.parentNode.replaceChild(frag, c);
    });
  }

  function sanitize(html, base, images) {
    if (!html) return '';
    var d = doc('<div id="__nr">' + html + '</div>');
    var root = d.getElementById('__nr');
    walk(root, base, images);
    applyTcy(root);
    return root.innerHTML.trim();
  }

  function finishEpisode(ep, url) {
    var images = [];
    var base = ep.url || url;
    return {
      title: ep.title || '',
      preface: sanitize(ep.preface, base, images),
      body: sanitize(ep.body, base, images),
      afterword: sanitize(ep.afterword, base, images),
      images: images,
    };
  }

  // ---------- 小説家になろう ----------
  var narou = {
    episode: function (d, url) {
      var pick = function (sels) {
        for (var i = 0; i < sels.length; i++) { var els = qa(d, sels[i]); if (els.length) return innerAll(els); }
        return '';
      };
      return {
        title: firstText(d, ['.p-novel__title--rensai', '.p-novel__subtitle-episode', '.novel_subtitle']) ||
          firstText(d, ['.p-novel__title', '.novel_title']),
        preface: pick(['.p-novel__text--preface', '#novel_p']),
        body: pick(['.p-novel__body .js-novel-text:not(.p-novel__text--preface):not(.p-novel__text--afterword)', '#novel_honbun']),
        afterword: pick(['.p-novel__text--afterword', '#novel_a']),
        url: url,
      };
    },
    toc: function (d, url, chapter) {
      var authorEl = q(d, '.p-novel__author a, .novel_writername a');
      var synEl = q(d, '#novel_ex, .p-novel__summary');
      var info = {
        title: firstText(d, ['.p-novel__title', '.novel_title']) || meta(d, 'og:title'),
        author: clean(firstText(d, ['.p-novel__author', '.novel_writername']).replace(/^作者[：:]/, '')),
        authorUrl: authorEl ? abs(authorEl.getAttribute('href'), url) : null,
        synopsis: synEl ? htmlToText(synEl.innerHTML) : '',
      };
      var episodes = [];
      var list = q(d, '.p-eplist') || q(d, '.index_box');
      if (list) {
        Array.prototype.forEach.call(list.children, function (el) {
          if (el.classList.contains('p-eplist__chapter-title') || el.classList.contains('chapter_title')) chapter = text(el);
          else if (el.classList.contains('p-eplist__sublist') || el.classList.contains('novel_sublist2')) {
            var a = q(el, 'a.p-eplist__subtitle') || q(el, 'a');
            if (a && a.getAttribute('href')) episodes.push({ title: text(a), url: abs(a.getAttribute('href'), url), chapter: chapter });
          }
        });
      }
      var next = q(d, 'a.c-pager__item--next');
      info.episodes = episodes;
      info.chapter = chapter;
      info.next = next ? abs(next.getAttribute('href'), url) : null;
      info.isSingle = !episodes.length && !!q(d, '.p-novel__body, #novel_honbun');
      return info;
    },
  };

  // ---------- カクヨム ----------
  var kakuyomu = {
    episode: function (d, url) {
      var body = q(d, '.widget-episodeBody');
      return {
        title: firstText(d, ['.widget-episodeTitle', '.episodeTitle']) || meta(d, 'og:title'),
        preface: '', body: body ? body.innerHTML : '', afterword: '', url: url,
      };
    },
    toc: function (d, url) {
      var key = (url.match(/works\/(\d+)/) || [])[1];
      var workUrl = 'https://kakuyomu.jp/works/' + key;
      var info = null;
      var script = q(d, 'script#__NEXT_DATA__');
      if (script) {
        try {
          var state = JSON.parse(script.textContent).props.pageProps.__APOLLO_STATE__;
          var deref = function (v) { return v && v.__ref ? state[v.__ref] : v; };
          var work = state['Work:' + key];
          if (work) {
            var author = deref(work.author) || {};
            var episodes = [];
            (work.tableOfContents || work.tableOfContentsV2 || []).forEach(function (entry) {
              var sec = deref(entry);
              if (!sec) return;
              var chap = deref(sec.chapter);
              var chapter = chap && chap.title ? clean(chap.title) : null;
              (sec.episodeUnions || sec.episodes || []).forEach(function (r) {
                var ep = deref(r);
                if (ep && ep.id) episodes.push({ title: clean(ep.title), url: workUrl + '/episodes/' + ep.id, chapter: chapter });
              });
            });
            info = {
              title: clean(work.title),
              author: clean(author.activityName || author.name || ''),
              authorUrl: author.name ? 'https://kakuyomu.jp/users/' + author.name : null,
              synopsis: clean([work.catchphrase, work.introduction].filter(Boolean).join('\n\n'), true),
              episodes: episodes,
            };
          }
        } catch (e) { /* フォールバックへ */ }
      }
      if (!info || !info.episodes.length) {
        var seen = {};
        var eps = [];
        qa(d, 'a[href*="/works/' + key + '/episodes/"]').forEach(function (a) {
          var id = (abs(a.getAttribute('href'), url) || '').match(/episodes\/(\d+)/);
          if (!id || seen[id[1]]) return;
          seen[id[1]] = true;
          eps.push({ title: text(a) || ('エピソード' + (eps.length + 1)), url: workUrl + '/episodes/' + id[1], chapter: null });
        });
        info = {
          title: (info && info.title) || firstText(d, ['#workTitle', 'h1']) || meta(d, 'og:title'),
          author: (info && info.author) || firstText(d, ['#workAuthor-activityName']),
          authorUrl: (info && info.authorUrl) || null,
          synopsis: (info && info.synopsis) || meta(d, 'og:description'),
          episodes: eps,
        };
      }
      info.next = null;
      info.isSingle = false;
      return info;
    },
  };

  // ---------- ハーメルン ----------
  function hamelnHeadTitle(d) { return clean((q(d, 'title') || {}).textContent || '').split(/\s+-\s+/)[0]; }
  var hameln = {
    episode: function (d, url) {
      var styled = qa(d, '#maind span').filter(function (e) { return /font-size:\s*120%/.test(e.getAttribute('style') || ''); })[0];
      var get = function (id) { var e = d.getElementById(id); return e ? e.innerHTML : ''; };
      return { title: text(styled) || hamelnHeadTitle(d), preface: get('maegaki'), body: get('honbun'), afterword: get('atogaki'), url: url };
    },
    toc: function (d, url) {
      var info = q(d, '#maind .ss');
      var authorEl = q(d, '[itemprop="author"]');
      var synopsis = '';
      var parts = ((info && info.innerHTML) || '').split(/<hr[^>]*>/i);
      if (parts.length > 1) synopsis = htmlToText(parts[1]);
      var episodes = [];
      var chapter = null;
      qa(d, '#maind table tr').forEach(function (tr) {
        var link = qa(tr, 'a[href]').filter(function (a) { return /(^|\/)\d+\.html$/.test(a.getAttribute('href')); })[0];
        var colspan = q(tr, 'td[colspan]');
        if (colspan && !link) { chapter = text(colspan); return; }
        if (link) episodes.push({ title: text(link), url: abs(link.getAttribute('href'), url), chapter: chapter });
      });
      var authorA = authorEl && (q(authorEl, 'a') || authorEl.closest('a'));
      return {
        title: text(q(d, '[itemprop="name"]')) || meta(d, 'og:title') || hamelnHeadTitle(d),
        author: text(authorEl),
        authorUrl: authorA ? abs(authorA.getAttribute('href'), url) : null,
        synopsis: synopsis,
        episodes: episodes,
        next: null,
        isSingle: !episodes.length && !!d.getElementById('honbun'),
      };
    },
  };

  // ---------- 青空文庫 ----------
  var aozora = {
    episode: function (d, url) {
      var main = q(d, '.main_text');
      var bib = q(d, '.bibliographical_information');
      return {
        title: firstText(d, ['h1.title', 'title']),
        preface: '', body: main ? main.innerHTML : d.body.innerHTML,
        afterword: bib ? bib.innerHTML : '', url: url,
      };
    },
    toc: function (d, url) {
      // 図書カードのページなら、XHTML版本文へのリンクを返す
      if (/card\d+\.html$/.test(url)) {
        var a = qa(d, 'a[href]').filter(function (e) { return /files\/[^/]+\.html?$/.test(e.getAttribute('href')); })[0];
        return { redirect: a ? abs(a.getAttribute('href'), url) : null, episodes: [] };
      }
      return {
        title: firstText(d, ['h1.title', 'title']),
        author: firstText(d, ['h2.author', '.author']),
        authorUrl: null, synopsis: '', next: null, isSingle: true, episodes: [],
      };
    },
  };

  // ---------- その他のWebページ ----------
  var CANDIDATES = ['[itemprop="articleBody"]', 'article .entry-content', '.entry-content', '.post-content',
    '.article-body', 'article', 'main', '#main', '#content', '.content'];
  var web = {
    episode: function (d, url) {
      qa(d, 'script, style, nav, header, footer, aside, form, iframe, noscript').forEach(function (e) { e.remove(); });
      var body = null;
      for (var i = 0; i < CANDIDATES.length && !body; i++) {
        var el = q(d, CANDIDATES[i]);
        if (el && clean(el.textContent).length > 200) body = el;
      }
      if (!body) {
        var best = 0;
        qa(d, 'div, section, td').forEach(function (el) {
          var len = qa(el, ':scope > p, :scope > br').length * 40;
          Array.prototype.forEach.call(el.childNodes, function (n) { if (n.nodeType === 3) len += n.data.trim().length; });
          if (len > best) { best = len; body = el; }
        });
      }
      body = body || d.body;
      var title = meta(d, 'og:title') || firstText(d, ['h1', 'title']) || url;
      return { title: title, preface: '', body: body ? body.innerHTML : '', afterword: '', url: url };
    },
    toc: function (d, url) {
      var title = meta(d, 'og:title') || firstText(d, ['h1', 'title']) || url;
      return {
        title: title,
        author: meta(d, 'author') || meta(d, 'article:author') || new URL(url).hostname,
        authorUrl: null,
        synopsis: meta(d, 'og:description') || meta(d, 'description'),
        episodes: [], next: null, isSingle: true,
      };
    },
  };

  var SITES = { narou: narou, kakuyomu: kakuyomu, hameln: hameln, aozora: aozora, web: web };

  window.NR = {
    // 目次ページの解析。短編（isSingle）のときは本文も一緒に返す
    parseToc: function (site, html, url, chapter) {
      var s = SITES[site] || web;
      var d = doc(html);
      var r = s.toc(d, url, chapter || null);
      if (r.isSingle) r.single = finishEpisode(s.episode(doc(html), url), url);
      return JSON.stringify(r);
    },
    parseEpisode: function (site, html, url) {
      var s = SITES[site] || web;
      return JSON.stringify(finishEpisode(s.episode(doc(html), url), url));
    },
    textToHtml: function (t) {
      var esc = function (x) { return x.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
      return t.replace(/\r\n?/g, '\n').split('\n').map(function (l) { return l.trim() ? '<p>' + esc(l) + '</p>' : '<p><br></p>'; }).join('\n');
    },
  };
})();
