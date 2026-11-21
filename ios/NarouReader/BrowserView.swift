import SwiftUI
import WebKit

/// アプリ内ブラウザ。小説のページを開くと「本棚に追加」が出る。
@MainActor
final class BrowserModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView
    @Published var url: URL?
    @Published var title = ""
    @Published var canGoBack = false
    @Published var canGoForward = false
    @Published var loading = false
    @Published var progress = 0.0
    private var observers: [NSKeyValueObservation] = []

    override init() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        observers = [
            webView.observe(\.url) { [weak self] wv, _ in Task { @MainActor in self?.url = wv.url } },
            webView.observe(\.title) { [weak self] wv, _ in Task { @MainActor in self?.title = wv.title ?? "" } },
            webView.observe(\.canGoBack) { [weak self] wv, _ in Task { @MainActor in self?.canGoBack = wv.canGoBack } },
            webView.observe(\.canGoForward) { [weak self] wv, _ in Task { @MainActor in self?.canGoForward = wv.canGoForward } },
            webView.observe(\.isLoading) { [weak self] wv, _ in Task { @MainActor in self?.loading = wv.isLoading } },
            webView.observe(\.estimatedProgress) { [weak self] wv, _ in Task { @MainActor in self?.progress = wv.estimatedProgress } },
        ]
    }

    func load(_ url: URL) {
        webView.load(URLRequest(url: url))
    }

    /// 入力された文字をURLにする（URLでなければ検索）
    func go(_ text: String) {
        let s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return }
        if s.contains("."), !s.contains(" "), let u = URL(string: s.lowercased().hasPrefix("http") ? s : "https://" + s) {
            load(u)
        } else {
            var c = URLComponents(string: "https://www.google.com/search")!
            c.queryItems = [URLQueryItem(name: "q", value: s)]
            load(c.url!)
        }
    }

    // target="_blank" のリンクも同じ画面で開く
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
        return nil
    }
}

struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct BrowserView: View {
    @EnvironmentObject var library: Library
    @EnvironmentObject var importer: Importer
    @EnvironmentObject var app: AppState
    @StateObject private var model = BrowserModel()

    @State private var address = ""
    @FocusState private var editing: Bool
    @State private var adding = false
    @State private var message: String?

    private var match: SiteMatch? { model.url.flatMap(Sites.detect) }

    var body: some View {
        VStack(spacing: 0) {
            addressBar
            ZStack(alignment: .bottom) {
                WebViewContainer(webView: model.webView)
                    .opacity(model.url == nil ? 0 : 1)
                if model.url == nil { startPage }
                if let m = match, m.isNovelSite { addBanner(m) }
            }
            toolbar
        }
        .onAppear(perform: consumeRequest)
        .onChange(of: app.browserRequest) { _ in consumeRequest() }
        .onChange(of: model.url) { u in if !editing { address = u?.absoluteString ?? "" } }
        .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("OK", role: .cancel) {}
        }
    }

    private func consumeRequest() {
        if let u = app.browserRequest {
            app.browserRequest = nil
            model.load(u)
        }
    }

    private var addressBar: some View {
        VStack(spacing: 0) {
            HStack {
                TextField("URLまたは検索", text: $address)
                    .keyboardType(.webSearch)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($editing)
                    .submitLabel(.go)
                    .onSubmit { model.go(address); editing = false }
                    .padding(.horizontal, 10).padding(.vertical, 8)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
                if model.loading {
                    Button { model.webView.stopLoading() } label: { Image(systemName: "xmark") }
                } else {
                    Button { model.webView.reload() } label: { Image(systemName: "arrow.clockwise") }
                        .disabled(model.url == nil)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            ProgressView(value: model.progress)
                .opacity(model.loading ? 1 : 0)
                .frame(height: 2)
        }
        .background(.bar)
    }

    private var startPage: some View {
        List {
            Section("小説サイト") {
                ForEach(Sites.shortcuts) { s in
                    Button(s.name) { model.load(URL(string: s.url)!) }
                }
            }
            Section {
                Text("作品の目次や本文のページを開くと、下に「本棚に追加」ボタンが出ます。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func addBanner(_ m: SiteMatch) -> some View {
        let existing = library.work(m.workId)
        return HStack(spacing: 12) {
            Image(systemName: existing == nil ? "books.vertical" : "checkmark.circle.fill")
                .font(.title3)
                .foregroundStyle(existing == nil ? Color.accentColor : .green)
            VStack(alignment: .leading, spacing: 2) {
                Text(existing == nil ? "\(m.siteName)の作品です" : "本棚にあります")
                    .font(.subheadline.bold())
                Text(existing?.title ?? "本棚に追加すると、オフラインでも縦書きで読めます")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if adding {
                ProgressView()
            } else if let w = existing {
                Button("読む") { app.read(w.id, readIndex(w)) }
                    .buttonStyle(.borderedProminent)
            } else {
                Button("本棚に追加") { add() }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
        .padding(10)
    }

    /// 本文ページを開いているときは、その話から読む
    private func readIndex(_ w: Work) -> Int {
        if let u = model.url?.absoluteString,
           let e = w.episodes.first(where: { $0.url.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == u.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }) {
            return e.index
        }
        return w.lastRead?.index ?? 0
    }

    private func add() {
        guard let u = model.url else { return }
        adding = true
        Task {
            defer { adding = false }
            do {
                let r = try await importer.importURL(u.absoluteString)
                message = "「\(r.work.title)」を本棚に追加しました（全\(r.work.episodes.count)話）"
            } catch {
                message = error.localizedDescription
            }
        }
    }

    private var toolbar: some View {
        HStack {
            Button { model.webView.goBack() } label: { Image(systemName: "chevron.backward") }
                .disabled(!model.canGoBack)
            Spacer()
            Button { model.webView.goForward() } label: { Image(systemName: "chevron.forward") }
                .disabled(!model.canGoForward)
            Spacer()
            Menu {
                if let u = model.url {
                    Button { addAny(u) } label: { Label("このページを本棚に追加", systemImage: "plus") }
                    Button { UIApplication.shared.open(u) } label: { Label("Safariで開く", systemImage: "safari") }
                    Button { UIPasteboard.general.url = u } label: { Label("URLをコピー", systemImage: "doc.on.doc") }
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .disabled(model.url == nil)
            Spacer()
            Button {
                model.webView.stopLoading()
                model.url = nil
                address = ""
            } label: { Image(systemName: "house") }
        }
        .font(.title3)
        .padding(.horizontal, 24).padding(.vertical, 10)
        .background(.bar)
    }

    /// 小説サイト以外のページも1話として取り込める
    private func addAny(_ u: URL) {
        adding = true
        Task {
            defer { adding = false }
            do {
                let r = try await importer.importURL(u.absoluteString)
                message = "「\(r.work.title)」を本棚に追加しました"
            } catch {
                message = error.localizedDescription
            }
        }
    }
}
