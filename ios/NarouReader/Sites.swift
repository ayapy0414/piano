import Foundation

/// URLから小説サイトを判定する
struct SiteMatch {
    let site: String       // narou / kakuyomu / hameln / aozora / web
    let siteName: String
    let key: String        // サイト内の作品ID
    let workURL: URL       // 目次ページ（作品トップ）のURL

    var workId: String {
        let allowed = Set("abcdefghijklmnopqrstuvwxyz0123456789-_")
        let raw = "\(site)-\(key)".lowercased()
        return String(raw.map { (c: Character) -> Character in allowed.contains(c) ? c : "_" })
    }
    var isNovelSite: Bool { site != "web" }
}

enum Sites {
    static let names: [String: String] = [
        "narou": "小説家になろう",
        "kakuyomu": "カクヨム",
        "hameln": "ハーメルン",
        "aozora": "青空文庫",
        "web": "Webページ",
    ]

    /// ブラウザのスタート画面に出すサイト
    struct Shortcut: Identifiable {
        let name: String
        let url: String
        var id: String { url }
    }

    static let shortcuts: [Shortcut] = [
        Shortcut(name: "小説家になろう", url: "https://yomou.syosetu.com/"),
        Shortcut(name: "カクヨム", url: "https://kakuyomu.jp/"),
        Shortcut(name: "ハーメルン", url: "https://syosetu.org/"),
        Shortcut(name: "青空文庫", url: "https://www.aozora.gr.jp/"),
    ]

    static func detect(_ url: URL) -> SiteMatch? {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = url.host?.lowercased() else { return nil }
        let path = url.path

        if host == "ncode.syosetu.com" || host == "novel18.syosetu.com",
           let m = match(#"^/(n\d+[a-z]+)(/|$)"#, path, caseInsensitive: true) {
            let key = m[1].lowercased()
            return make("narou", key, "https://\(host)/\(key)/")
        }
        if host == "kakuyomu.jp", let m = match(#"^/works/(\d+)"#, path) {
            return make("kakuyomu", m[1], "https://kakuyomu.jp/works/\(m[1])")
        }
        if host == "syosetu.org", let m = match(#"^/novel/(\d+)"#, path) {
            return make("hameln", m[1], "https://syosetu.org/novel/\(m[1])/")
        }
        if host == "www.aozora.gr.jp" || host == "aozora.gr.jp",
           let m = match(#"^/cards/\d+/(?:files/)?([^/]+)\.html?$"#, path) {
            return make("aozora", m[1], url.absoluteString)
        }
        return make("web", stableHash(url.absoluteString), url.absoluteString)
    }

    private static func make(_ site: String, _ key: String, _ work: String) -> SiteMatch? {
        guard let u = URL(string: work) else { return nil }
        return SiteMatch(site: site, siteName: names[site] ?? site, key: key, workURL: u)
    }

    private static func match(_ pattern: String, _ s: String, caseInsensitive: Bool = false) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : []),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<m.numberOfRanges).map { i in
            Range(m.range(at: i), in: s).map { String(s[$0]) } ?? ""
        }
    }

    /// 起動ごとに変わらないハッシュ（FNV-1a）
    static func stableHash(_ s: String) -> String {
        var h: UInt64 = 0xcbf29ce484222325
        for b in s.utf8 {
            h ^= UInt64(b)
            h = h &* 0x100000001b3
        }
        return String(format: "%016llx", h)
    }
}
