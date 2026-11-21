import Foundation
import WebKit

/// Parser.js の解析結果
struct ParsedEpisode: Decodable {
    var title: String
    var preface: String
    var body: String
    var afterword: String
    var images: [String]
}

struct ParsedTocEntry: Decodable {
    var title: String
    var url: String?
    var chapter: String?
}

struct ParsedToc: Decodable {
    var title: String?
    var author: String?
    var authorUrl: String?
    var synopsis: String?
    var episodes: [ParsedTocEntry]
    var chapter: String?
    var next: String?
    var isSingle: Bool?
    var single: ParsedEpisode?
    var redirect: String?
}

/// 画面に出さないWebViewの中で Parser.js を動かしてHTMLを解析する。
/// （iPhoneに標準で入っているHTMLの解析機能を使うので、追加のライブラリが要らない）
@MainActor
final class HTMLParser: NSObject, WKNavigationDelegate {
    static let shared = HTMLParser()

    private var webView: WKWebView?
    private var ready = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    private func prepare() async -> WKWebView {
        if let wv = webView, ready { return wv }
        if webView == nil {
            let config = WKWebViewConfiguration()
            if let url = Bundle.main.url(forResource: "Parser", withExtension: "js"),
               let js = try? String(contentsOf: url, encoding: .utf8) {
                config.userContentController.addUserScript(
                    WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
            let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: 10, height: 10), configuration: config)
            wv.navigationDelegate = self
            wv.loadHTMLString("<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>", baseURL: nil)
            webView = wv
        }
        await withCheckedContinuation { waiters.append($0) }
        return webView!
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        ready = true
        let w = waiters
        waiters = []
        w.forEach { $0.resume() }
    }

    private func call<T: Decodable>(_ body: String, _ args: [String: Any]) async throws -> T {
        let wv = await prepare()
        let result = try await wv.callAsyncJavaScript(body, arguments: args, in: nil, contentWorld: .page)
        guard let json = result as? String, let data = json.data(using: .utf8) else {
            throw FetchError.notFound("ページを解析できませんでした")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func parseToc(site: String, html: String, url: URL, chapter: String?) async throws -> ParsedToc {
        try await call("return NR.parseToc(site, html, url, chapter)",
                       ["site": site, "html": html, "url": url.absoluteString, "chapter": chapter ?? NSNull()])
    }

    func parseEpisode(site: String, html: String, url: URL) async throws -> ParsedEpisode {
        try await call("return NR.parseEpisode(site, html, url)",
                       ["site": site, "html": html, "url": url.absoluteString])
    }

    func textToHtml(_ text: String) async throws -> String {
        let wv = await prepare()
        return (try await wv.callAsyncJavaScript("return NR.textToHtml(t)", arguments: ["t": text], in: nil, contentWorld: .page) as? String) ?? ""
    }
}
