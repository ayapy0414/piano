// なろう系リーダー フロントエンド
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

// ---------- 共通 ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 外部リンクは http(s) のみ許可する
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `エラー (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), isError ? 5000 : 2600);
}

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

const store = {
  get(key, def) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(key, v) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {}
  },
};

// ---------- 表示設定 ----------
const DEFAULTS = { mode: 'vertical', size: 18, font: 'mincho', lh: 1.9, theme: 'auto' };
let settings = { ...DEFAULTS, ...store.get('nr.settings', {}) };

function applyTheme() {
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = settings.theme;
}
applyTheme();

function saveSettings() {
  store.set('nr.settings', settings);
  applyTheme();
}

// ---------- ルーティング ----------
let cleanup = null;
let pollTimer = null;

function setTab(name) {
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
}

async function route() {
  const done = cleanup;
  cleanup = null;
  // 前の画面の後始末（読書位置の保存など）を待ってから描画する
  if (done) await Promise.race([done(), new Promise((r) => setTimeout(r, 1500))]);
  clearTimeout(pollTimer);
  document.body.classList.remove('reading');
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  try {
    if (parts[0] === 'files') await renderFiles();
    else if (parts[0] === 'work' && parts[1]) await renderWork(parts[1]);
    else if (parts[0] === 'read' && parts[1]) await renderReader(parts[1], Number(parts[2] || 0));
    else await renderLibrary();
  } catch (e) {
    view.innerHTML = `<div class="card empty">${esc(e.message)}<br><br><a class="btn" href="#/">本棚へ戻る</a></div>`;
  }
}
window.addEventListener('hashchange', route);

// ---------- 本棚（インポートした作品の一覧） ----------
async function renderLibrary() {
  setTab('library');
  document.title = 'なろう系リーダー';
  const [works, sites] = await Promise.all([api('/works'), api('/sites')]);
  view.innerHTML = `
    <section class="card import">
      <form id="import-form">
        <input type="url" name="url" required placeholder="作品・話のURLを貼り付け（例: https://ncode.syosetu.com/n0000aa/）" autocomplete="off">
        <button class="btn primary" type="submit" id="import-btn">取り込む</button>
      </form>
      <div class="opts">
        <label><input type="checkbox" name="all" id="import-all" ${store.get('nr.importAll', false) ? 'checked' : ''}> 全話の本文と画像もまとめて保存する</label>
      </div>
      <div class="opts">
        <span class="muted">対応サイト:</span>
        <div class="sites">${sites.map((s) => `<span class="badge" title="${esc(s.examples.join('\n'))}">${esc(s.name)}</span>`).join('')}</div>
      </div>
    </section>

    <h2 class="section">本棚 <span class="muted">（${works.length}作品）</span></h2>
    ${works.length ? `<div class="works">${works.map(workCard).join('')}</div>` : '<div class="card empty">まだ作品がありません。上の欄にURLを貼り付けて取り込んでください。</div>'}
  `;

  const form = $('#import-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#import-btn');
    const url = form.url.value.trim();
    const all = $('#import-all').checked;
    store.set('nr.importAll', all);
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 取り込み中…';
    try {
      const r = await api('/import', { method: 'POST', body: { url, downloadAll: all } });
      toast(r.isNew ? `「${r.work.title}」を取り込みました（全${r.work.episodes.length}話）` : `「${r.work.title}」を更新しました`);
      location.hash = `#/work/${encodeURIComponent(r.work.id)}`;
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = '取り込む';
    }
  });

  view.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const w = works.find((x) => x.id === b.dataset.del);
      if (!confirm(`「${w.title}」と保存したファイルを削除しますか？`)) return;
      await api(`/works/${encodeURIComponent(w.id)}`, { method: 'DELETE' });
      toast('削除しました');
      route();
    })
  );

  if (works.some((w) => w.job?.running)) pollTimer = setTimeout(route, 2000);
}

function workCard(w) {
  const pct = w.episodeCount ? Math.round((w.cachedCount / w.episodeCount) * 100) : 0;
  const cont = w.lastRead ? w.lastRead.index : 0;
  const job = w.job?.running ? `<span class="badge"><span class="spinner" style="width:10px;height:10px"></span> 取得中 ${w.job.done}/${w.job.total}</span>` : '';
  return `
    <article class="card work">
      <span class="meta"><span class="badge">${esc(w.siteName)}</span>${job}</span>
      <h3><a href="#/work/${encodeURIComponent(w.id)}">${esc(w.title)}</a></h3>
      <div class="meta">${esc(w.author)}</div>
      <div class="meta">全${w.episodeCount}話 · 保存済み ${w.cachedCount}話 · 画像 ${w.imageCount}枚</div>
      <div class="progress" title="保存済み ${pct}%"><i style="width:${pct}%"></i></div>
      <div class="meta">${w.lastRead ? `最後に読んだ: 第${w.lastRead.index + 1}話 · ${fmtDate(w.lastRead.at)}` : `取り込み: ${fmtDate(w.importedAt)}`}</div>
      <div class="actions">
        <a class="btn small primary" href="#/read/${encodeURIComponent(w.id)}/${cont}">${w.lastRead ? '続きから読む' : '読む'}</a>
        <a class="btn small" href="#/work/${encodeURIComponent(w.id)}">目次</a>
        <a class="btn small ext" href="${esc(safeUrl(w.sourceUrl))}" target="_blank" rel="noopener noreferrer">元ページ</a>
        <button class="btn small danger" data-del="${esc(w.id)}">削除</button>
      </div>
    </article>`;
}

// ---------- ファイル一覧 ----------
const KIND_LABEL = { toc: '目次', episode: '本文', image: '画像', other: 'その他' };

async function renderFiles() {
  setTab('files');
  document.title = 'ファイル一覧 - なろう系リーダー';
  const files = await api('/files');
  const works = [...new Map(files.map((f) => [f.workId, f.workTitle])).entries()];
  const total = files.reduce((s, f) => s + f.size, 0);
  const st = store.get('nr.fileFilter', { work: '', kind: '', q: '' });

  view.innerHTML = `
    <h2 class="section">インポートしたファイル <span class="muted">（${files.length}件 · ${fmtSize(total)}）</span></h2>
    <div class="filters">
      <select id="f-work"><option value="">すべての作品</option>${works.map(([id, t]) => `<option value="${esc(id)}">${esc(t)}</option>`).join('')}</select>
      <select id="f-kind"><option value="">すべての種類</option>${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input id="f-q" type="search" placeholder="名前で絞り込み">
      <span class="muted" id="f-count"></span>
    </div>
    <div class="card table-wrap">
      <table class="files">
        <thead><tr><th>種類</th><th></th><th>名前</th><th class="hide-sm">作品</th><th class="num">サイズ</th><th class="hide-sm">保存日時</th><th>元のリンク</th></tr></thead>
        <tbody id="f-body"></tbody>
      </table>
    </div>`;

  const fw = $('#f-work'), fk = $('#f-kind'), fq = $('#f-q');
  fw.value = works.some(([id]) => id === st.work) ? st.work : '';
  fk.value = st.kind;
  fq.value = st.q;

  const draw = () => {
    const q = fq.value.trim().toLowerCase();
    store.set('nr.fileFilter', { work: fw.value, kind: fk.value, q: fq.value });
    const rows = files.filter(
      (f) => (!fw.value || f.workId === fw.value) && (!fk.value || f.kind === fk.value) &&
        (!q || `${f.label} ${f.path} ${f.workTitle}`.toLowerCase().includes(q))
    );
    $('#f-count').textContent = `${rows.length}件表示`;
    $('#f-body').innerHTML = rows.length
      ? rows.map((f) => {
          const open =
            f.kind === 'episode' ? `#/read/${encodeURIComponent(f.workId)}/${f.index}` :
            f.kind === 'image' ? f.localUrl : `#/work/${encodeURIComponent(f.workId)}`;
          const thumb = f.kind === 'image' ? `<img class="thumb" src="${esc(f.localUrl)}" alt="" loading="lazy">` : '';
          return `<tr>
            <td><span class="kind">${KIND_LABEL[f.kind]}</span></td>
            <td>${thumb}</td>
            <td><a href="${esc(open)}" ${f.kind === 'image' ? 'target="_blank"' : ''}>${esc(f.label)}</a><div class="muted" style="font-size:12px">${esc(f.path)}</div></td>
            <td class="hide-sm">${esc(f.workTitle)}</td>
            <td class="num">${fmtSize(f.size)}</td>
            <td class="hide-sm" style="white-space:nowrap">${fmtDate(f.mtime)}</td>
            <td>${f.sourceUrl ? `<a class="ext" href="${esc(safeUrl(f.sourceUrl))}" target="_blank" rel="noopener noreferrer">開く</a>` : ''}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="7" class="empty">ファイルがありません</td></tr>`;
  };
  [fw, fk].forEach((el) => el.addEventListener('change', draw));
  fq.addEventListener('input', draw);
  draw();
}

// ---------- 作品ページ（目次） ----------
async function renderWork(id) {
  setTab('library');
  const w = await api(`/works/${encodeURIComponent(id)}`);
  document.title = `${w.title} - なろう系リーダー`;
  const cached = w.episodes.filter((e) => e.fetchedAt).length;
  const job = w.job;
  let lastChapter = null;
  const toc = w.episodes
    .map((e) => {
      let h = '';
      if (e.chapter && e.chapter !== lastChapter) h += `<div class="chapter">${esc(e.chapter)}</div>`;
      lastChapter = e.chapter;
      const cur = w.lastRead?.index === e.index ? ' current' : '';
      return `${h}<a class="ep${cur}" href="#/read/${encodeURIComponent(w.id)}/${e.index}">
        <span class="no">${e.index + 1}</span><span class="t">${esc(e.title)}</span>
        <span class="st">${e.imageCount ? `🖼${e.imageCount} ` : ''}<span class="dot${e.fetchedAt ? ' on' : ''}" title="${e.fetchedAt ? '保存済み ' + fmtDate(e.fetchedAt) : '未保存'}"></span></span></a>`;
    })
    .join('');

  const jobLine = job
    ? job.running
      ? `<p><span class="spinner"></span> 全話を取得中… ${job.done} / ${job.total} <button class="btn small" id="cancel-dl">中止</button></p>`
      : job.failed?.length
        ? `<p class="muted">取得完了（失敗 ${job.failed.length}件: ${job.failed.slice(0, 5).map((f) => `第${f.index + 1}話`).join('、')}${job.failed.length > 5 ? '…' : ''}）</p>`
        : ''
    : '';

  view.innerHTML = `
    <section class="card work-head">
      <span class="badge">${esc(w.siteName)}</span>
      <h1>${esc(w.title)}</h1>
      <div class="muted">${w.authorUrl ? `<a class="ext" href="${esc(safeUrl(w.authorUrl))}" target="_blank" rel="noopener noreferrer">${esc(w.author)}</a>` : esc(w.author)}</div>
      ${w.synopsis ? `<p class="synopsis clamp" id="syn">${esc(w.synopsis)}</p>` : ''}
      <p class="muted" style="font-size:13px;margin:10px 0 0">全${w.episodes.length}話 · 保存済み ${cached}話 · 画像 ${w.imageCount}枚 · 目次更新 ${fmtDate(w.updatedAt)}</p>
      ${jobLine}
      <div class="actions">
        <a class="btn primary" href="#/read/${encodeURIComponent(w.id)}/${w.lastRead?.index ?? 0}">${w.lastRead ? `続きから（第${w.lastRead.index + 1}話）` : '最初から読む'}</a>
        <a class="btn ext" href="${esc(safeUrl(w.sourceUrl))}" target="_blank" rel="noopener noreferrer">元のページ</a>
        <button class="btn" id="refresh">目次を更新</button>
        <button class="btn" id="dl" ${job?.running || cached === w.episodes.length ? 'disabled' : ''}>未保存の${w.episodes.length - cached}話を保存</button>
      </div>
    </section>
    <section class="card toc">${toc}</section>`;

  $('#syn')?.addEventListener('click', (e) => e.currentTarget.classList.toggle('clamp'));
  $('#refresh').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api(`/works/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
      toast(r.added > 0 ? `新しい話が${r.added}件あります` : '目次を更新しました');
      route();
    } catch (err) {
      toast(err.message, true);
      e.currentTarget.disabled = false;
    }
  });
  $('#dl').addEventListener('click', async () => {
    await api(`/works/${encodeURIComponent(id)}/download`, { method: 'POST', body: {} });
    route();
  });
  $('#cancel-dl')?.addEventListener('click', async () => {
    await api(`/works/${encodeURIComponent(id)}/download`, { method: 'DELETE' });
    toast('中止しました');
  });
  if (job?.running) pollTimer = setTimeout(route, 2000);
}

// ---------- 閲覧画面（縦書き / 横書き） ----------
async function renderReader(id, index) {
  document.body.classList.add('reading');
  const w = await api(`/works/${encodeURIComponent(id)}`);
  if (!w.episodes[index]) index = 0;
  const meta = w.episodes[index];
  document.title = `${meta.title} - ${w.title}`;
  const restore = w.lastRead?.index === index ? w.lastRead.ratio : 0;

  view.innerHTML = `
    <div class="reader-shell" id="shell">
      <div class="rbar top">
        <a class="btn small" href="#/work/${encodeURIComponent(id)}" title="目次へ">目次</a>
        <div class="title">${esc(meta.title)}<small class="hide-sm">${esc(w.title)}</small></div>
        <a class="btn small ext hide-sm" id="src-link" href="${esc(safeUrl(meta.url))}" target="_blank" rel="noopener noreferrer">元のページ</a>
        <button class="btn small" id="open-settings" aria-label="表示設定">Aa</button>
      </div>
      <div class="reader" id="reader" tabindex="0"><div class="page" id="page"><div class="loading-page"><span class="spinner"></span> 読み込み中…</div></div></div>
      <div class="rbar bottom">
        <button class="btn small" id="prev-ep" ${index <= 0 ? 'disabled' : ''}>前の話</button>
        <span class="pos" id="pos">${index + 1} / ${w.episodes.length}</span>
        <button class="btn small" id="next-ep" ${index >= w.episodes.length - 1 ? 'disabled' : ''}>次の話</button>
      </div>
      <div class="card settings" id="settings">
        <div class="row"><span>方向</span><span class="seg" data-key="mode"><button data-v="vertical">縦書き</button><button data-v="horizontal">横書き</button></span></div>
        <div class="row"><span>書体</span><span class="seg" data-key="font"><button data-v="mincho">明朝</button><button data-v="gothic">ゴシック</button></span></div>
        <div class="row"><span>背景</span><span class="seg" data-key="theme"><button data-v="auto">自動</button><button data-v="light">白</button><button data-v="sepia">紙</button><button data-v="dark">黒</button></span></div>
        <div class="row"><label for="s-size">文字サイズ <span id="s-size-v"></span></label><input type="range" id="s-size" min="12" max="32" step="1"></div>
        <div class="row"><label for="s-lh">行間 <span id="s-lh-v"></span></label><input type="range" id="s-lh" min="1.4" max="2.6" step="0.1"></div>
        <div class="row"><a class="ext" href="${esc(safeUrl(meta.url))}" target="_blank" rel="noopener noreferrer">この話を元のサイトで開く</a></div>
        <div class="row"><button class="btn small" id="refetch">この話を再取得</button></div>
      </div>
    </div>`;

  const shell = $('#shell'), reader = $('#reader'), page = $('#page'), panel = $('#settings');
  const go = (i) => (location.hash = `#/read/${encodeURIComponent(id)}/${i}`);
  const isV = () => settings.mode === 'vertical';

  function applyReaderStyle() {
    reader.className = `reader ${settings.mode}`;
    reader.style.setProperty('--reader-size', `${settings.size}px`);
    reader.style.setProperty('--reader-lh', settings.lh);
    reader.style.setProperty('--reader-font', settings.font === 'gothic' ? 'var(--gothic)' : 'var(--mincho)');
    panel.querySelectorAll('.seg').forEach((seg) =>
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', settings[seg.dataset.key] === b.dataset.v))
    );
    $('#s-size').value = settings.size;
    $('#s-size-v').textContent = `${settings.size}px`;
    $('#s-lh').value = settings.lh;
    $('#s-lh-v').textContent = Number(settings.lh).toFixed(1);
  }

  // 読み進めた割合（0〜1）。縦書きは右から左へ進む。
  const maxScroll = () => (isV() ? reader.scrollWidth - reader.clientWidth : reader.scrollHeight - reader.clientHeight);
  const getRatio = () => {
    const m = maxScroll();
    if (m <= 0) return 0;
    return Math.min(1, Math.abs(isV() ? reader.scrollLeft : reader.scrollTop) / m);
  };
  const setRatio = (r) => {
    const m = maxScroll();
    if (isV()) reader.scrollLeft = -r * m;
    else reader.scrollTop = r * m;
  };

  applyReaderStyle();

  panel.querySelectorAll('.seg').forEach((seg) =>
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const r = getRatio();
      settings[seg.dataset.key] = b.dataset.v;
      saveSettings();
      applyReaderStyle();
      requestAnimationFrame(() => setRatio(r));
    })
  );
  const onRange = (key, el) =>
    el.addEventListener('input', () => {
      const r = getRatio();
      settings[key] = Number(el.value);
      saveSettings();
      applyReaderStyle();
      setRatio(r);
    });
  onRange('size', $('#s-size'));
  onRange('lh', $('#s-lh'));
  $('#open-settings').addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('open');
  });
  $('#prev-ep').addEventListener('click', () => go(index - 1));
  $('#next-ep').addEventListener('click', () => go(index + 1));

  // 本文の読み込み
  let ep;
  async function load(refetch = false) {
    page.innerHTML = '<div class="loading-page"><span class="spinner"></span> 読み込み中…</div>';
    try {
      ep = await api(`/works/${encodeURIComponent(id)}/episodes/${index}${refetch ? '?refetch=1' : ''}`);
    } catch (e) {
      page.innerHTML = `<div class="loading-page">${esc(e.message)}　<a href="${esc(safeUrl(meta.url))}" target="_blank" rel="noopener noreferrer">元のページを開く</a></div>`;
      return;
    }
    const hasNext = index < w.episodes.length - 1;
    page.innerHTML = `
      ${ep.chapter ? `<p class="ep-chapter">${esc(ep.chapter)}</p>` : ''}
      <h1 class="ep-title">${esc(ep.title)}</h1>
      ${ep.preface ? `<div class="preface">${ep.preface}</div>` : ''}
      <div class="body">${ep.body}</div>
      ${ep.afterword ? `<div class="afterword">${ep.afterword}</div>` : ''}
      <p class="ep-source">出典: <a class="ext" href="${esc(safeUrl(ep.url))}" target="_blank" rel="noopener noreferrer">${esc(w.siteName)}「${esc(w.title)}」${esc(ep.title)}</a></p>
      <nav class="ep-end">
        ${index > 0 ? `<a class="btn" href="#/read/${encodeURIComponent(id)}/${index - 1}">前の話</a>` : ''}
        <a class="btn" href="#/work/${encodeURIComponent(id)}">目次</a>
        ${hasNext ? `<a class="btn primary" href="#/read/${encodeURIComponent(id)}/${index + 1}">次の話へ</a>` : '<span class="muted">最新話です</span>'}
      </nav>`;
    // 画像の読み込み後にも位置を合わせる
    requestAnimationFrame(() => {
      setRatio(restore);
      savePos();
    });
    page.querySelectorAll('img').forEach((img) => img.addEventListener('load', () => !moved && setRatio(restore), { once: true }));
    reader.focus({ preventScroll: true });
    // 次の話を先読みして保存しておく
    if (hasNext && !w.episodes[index + 1].fetchedAt) {
      setTimeout(() => api(`/works/${encodeURIComponent(id)}/episodes/${index + 1}`).catch(() => {}), 1500);
    }
  }
  $('#refetch').addEventListener('click', () => {
    panel.classList.remove('open');
    load(true).then(() => toast('再取得しました'));
  });

  // 読書位置の保存
  let moved = false;
  let saveTimer = null;
  const flushPos = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    // keepalive: 画面遷移やタブを閉じた後でも送信を完了させる
    return fetch(`/api/works/${encodeURIComponent(id)}/progress`, {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index, ratio: getRatio() }),
    }).catch(() => {});
  };
  const savePos = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushPos, 600);
  };
  const onHide = () => saveTimer && flushPos();
  window.addEventListener('pagehide', onHide);
  reader.addEventListener('scroll', () => {
    moved = true;
    savePos();
  }, { passive: true });

  // ページ送り
  const pageBy = (dir) => {
    const atEnd = getRatio() >= 0.995 || maxScroll() <= 0;
    const atStart = getRatio() <= 0.005;
    if (dir > 0 && atEnd) return index < w.episodes.length - 1 && go(index + 1);
    if (dir < 0 && atStart) return index > 0 && go(index - 1);
    if (isV()) reader.scrollBy({ left: -dir * reader.clientWidth * 0.92, behavior: 'smooth' });
    else reader.scrollBy({ top: dir * reader.clientHeight * 0.9, behavior: 'smooth' });
  };

  // 縦書き時はマウスホイールの上下を左右スクロールに変換する
  const onWheel = (e) => {
    if (!isV() || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? reader.clientWidth : 1;
    reader.scrollLeft -= e.deltaY * unit;
  };
  reader.addEventListener('wheel', onWheel, { passive: false });

  const onKey = (e) => {
    if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (isV()) {
      if (k === 'ArrowLeft' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { e.preventDefault(); pageBy(1); }
      else if (k === 'ArrowRight' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { e.preventDefault(); pageBy(-1); }
    } else if ((k === ' ' || k === 'PageDown') && getRatio() >= 0.995) {
      e.preventDefault(); pageBy(1);
    }
    if (k === 'n') go(Math.min(index + 1, w.episodes.length - 1));
    else if (k === 'p' && index > 0) go(index - 1);
    else if (k === 'Escape') panel.classList.contains('open') ? panel.classList.remove('open') : (location.hash = `#/work/${encodeURIComponent(id)}`);
  };
  document.addEventListener('keydown', onKey);

  // タップ: 縦書きは左端で次ページ・右端で前ページ。中央でメニューの表示切替。
  reader.addEventListener('click', (e) => {
    if (e.target.closest('a, button, img')) return;
    if (panel.classList.contains('open')) return panel.classList.remove('open');
    if (getSelection().toString()) return;
    const x = e.clientX / window.innerWidth;
    if (isV() && x < 0.3) pageBy(1);
    else if (isV() && x > 0.7) pageBy(-1);
    else shell.classList.toggle('hide-ui');
  });
  const closePanel = (e) => {
    if (!panel.contains(e.target) && e.target.id !== 'open-settings') panel.classList.remove('open');
  };
  document.addEventListener('click', closePanel);

  cleanup = () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', closePanel);
    window.removeEventListener('pagehide', onHide);
    if (saveTimer) return flushPos();
  };

  await load();
}

route();
