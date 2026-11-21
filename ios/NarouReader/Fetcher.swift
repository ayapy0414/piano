import Foundation

enum FetchError: LocalizedError {
    case http(Int, URL)
    case tooLarge
    case notFound(String)

    var errorDescription: String? {
        switch self {
        case .http(let code, let url): return "ページを取得できませんでした（\(code)）: \(url.host ?? "")"
        case .tooLarge: return "ファイルが大きすぎます"
        case .notFound(let what): return what
        }
    }
}

/// 小説サイトへのアクセス。相手のサーバーに負担をかけないよう、同じサイトへは1秒以上空ける。
actor Fetcher {
    static let shared = Fetcher()

    private var nextSlot: [String: Date] = [:]
    private let interval: TimeInterval = 1.0
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.httpAdditionalHeaders = [
            "Accept-Language": "ja,en;q=0.8",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        ]
        session = URLSession(configuration: config)
        Fetcher.installAgeCookies()
    }

    /// 年齢確認ページを飛ばすためのクッキー（なろうR18・ハーメルン）
    private static func installAgeCookies() {
        let list: [(String, String, String)] = [
            (".syosetu.com", "over18", "yes"),
            ("syosetu.org", "over18", "off"),
        ]
        for (domain, name, value) in list {
            if let c = HTTPCookie(properties: [.domain: domain, .path: "/", .name: name, .value: value, .secure: "TRUE"]) {
                HTTPCookieStorage.shared.setCookie(c)
            }
        }
    }

    func data(_ url: URL, referer: String? = nil) async throws -> (Data, HTTPURLResponse) {
        // 順番待ち（予約してから待つので、同時に呼ばれても間隔が守られる）
        let host = url.host ?? ""
        let now = Date()
        let slot = max(now, nextSlot[host] ?? .distantPast)
        nextSlot[host] = slot.addingTimeInterval(interval)
        let wait = slot.timeIntervalSince(now)
        if wait > 0 { try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) }

        var req = URLRequest(url: url)
        if let referer { req.setValue(referer, forHTTPHeaderField: "Referer") }
        let (data, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw FetchError.http(0, url) }
        guard (200..<300).contains(http.statusCode) else { throw FetchError.http(http.statusCode, url) }
        if data.count > 20 * 1024 * 1024 { throw FetchError.tooLarge }
        return (data, http)
    }

    /// HTMLを取得して文字コードを判定する（青空文庫などの Shift_JIS に対応）
    func html(_ url: URL) async throws -> (html: String, url: URL, contentType: String) {
        let (data, resp) = try await data(url)
        let type = (resp.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        return (Fetcher.decode(data, response: resp), resp.url ?? url, type)
    }

    static func decode(_ data: Data, response: HTTPURLResponse?) -> String {
        var charset = response?.textEncodingName?.lowercased()
        if charset == nil {
            let head = String(decoding: data.prefix(4096), as: UTF8.self).lowercased()
            if let r = head.range(of: #"charset=["']?([a-z0-9_-]+)"#, options: .regularExpression) {
                charset = String(head[r]).replacingOccurrences(of: #"charset=["']?"#, with: "", options: .regularExpression)
            } else if let r = head.range(of: #"encoding=["']([a-z0-9_-]+)"#, options: .regularExpression) {
                charset = String(head[r]).replacingOccurrences(of: #"encoding=["']"#, with: "", options: .regularExpression)
            }
        }
        let enc: String.Encoding
        switch charset ?? "utf-8" {
        case "shift_jis", "shift-jis", "sjis", "x-sjis", "windows-31j", "cp932", "ms932": enc = .shiftJIS
        case "euc-jp", "x-euc-jp": enc = .japaneseEUC
        case "iso-2022-jp": enc = .iso2022JP
        default: enc = .utf8
        }
        return String(data: data, encoding: enc) ?? String(decoding: data, as: UTF8.self)
    }
}
