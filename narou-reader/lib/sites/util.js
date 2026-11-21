// サイト解析の共通ヘルパー

// 空白を整理する。multiline=true なら改行を残す
export function clean(s, multiline = false) {
  if (!s) return '';
  // 全角スペース（　）はタイトルの一部なので残し、半角の空白だけ整理する
  s = s.replace(/\r\n?/g, '\n').replace(/[ \t\f\v\u00a0]+/g, ' ');
  if (!multiline) return s.replace(/[ \n]+/g, ' ').replace(/^ +| +$/g, '');
  return s
    .split('\n')
    .map((l) => l.replace(/^ +| +$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

export function firstText($, selectors) {
  for (const s of selectors) {
    const t = clean($(s).first().text());
    if (t) return t;
  }
  return '';
}

export function metaContent($, prop) {
  return clean($(`meta[property="${prop}"], meta[name="${prop}"]`).attr('content') || '');
}

export function absUrl(href, base) {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

// HTML断片を改行付きのテキストにする
export function htmlToText(html) {
  const s = (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
  return clean(s, true);
}
