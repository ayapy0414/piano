import SwiftUI
import WebKit

/// 本文表示用WebViewと、その中のページ（reader.html）とのやりとり
@MainActor
final class ReaderController: NSObject, ObservableObject, WKScriptMessageHandler {
    let webView: WKWebView
    @Published var ready = false
    var onMessage: (([String: Any]) -> Void)?

    override init() {
        let config = WKWebViewConfiguration()
        let proxy = WeakHandler()
        config.userContentController.add(proxy, name: "reader")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        super.init()
        proxy.target = self
    }

    func load(pageURL: URL, readAccess: URL) {
        webView.loadFileURL(pageURL, allowingReadAccessTo: readAccess)
    }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if body["type"] as? String == "ready" { ready = true }
        onMessage?(body)
    }

    /// JavaScriptの関数に、値をJSONにして渡す
    func call(_ fn: String, _ arg: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: arg, options: .fragmentsAllowed),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("\(fn)(\(json))", completionHandler: nil)
    }

    func showMessage(_ text: String) {
        call("NRReader.showMessage", text)
    }

    /// WebViewがメッセージ受け手を強く参照し続けないようにする
    @MainActor
    private final class WeakHandler: NSObject, WKScriptMessageHandler {
        weak var target: WKScriptMessageHandler?
        func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
            target?.userContentController(uc, didReceive: message)
        }
    }
}

struct ReaderView: View {
    let workId: String
    let startIndex: Int

    @EnvironmentObject var library: Library
    @EnvironmentObject var importer: Importer
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss

    @StateObject private var controller = ReaderController()

    // 表示設定（アプリ全体で共通）
    @AppStorage("reader.mode") private var mode = "vertical"        // vertical / horizontal
    @AppStorage("reader.fontSize") private var fontSize = 18.0
    @AppStorage("reader.lineHeight") private var lineHeight = 1.9
    @AppStorage("reader.font") private var font = "mincho"          // mincho / gothic
    @AppStorage("reader.theme") private var theme = "auto"          // auto / white / sepia / dark

    @State private var index = 0
    @State private var showBars = true
    @State private var showSettings = false
    @State private var loading = false
    @State private var started = false

    private var work: Work? { library.work(workId) }

    var body: some View {
        ZStack {
            WebViewContainer(webView: controller.webView)
                .ignoresSafeArea()
            if showBars { bars }
        }
        .background(Color(.systemBackground))
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .statusBarHidden(!showBars)
        .animation(.easeInOut(duration: 0.2), value: showBars)
        .sheet(isPresented: $showSettings) {
            ReaderSettingsView(mode: $mode, fontSize: $fontSize, lineHeight: $lineHeight, font: $font, theme: $theme,
                               sourceUrl: currentEpisode?.url,
                               openSource: { u in showSettings = false; app.openInBrowser(u) },
                               refetch: { showSettings = false; Task { await show(index, force: true) } })
                .presentationDetents([.medium, .large])
        }
        .onAppear(perform: start)
        .onChange(of: controller.ready) { r in if r { applySettings(); Task { await show(index) } } }
        .onChange(of: settingsKey) { _ in applySettings() }
    }

    private var currentEpisode: Episode? {
        guard let w = work, index >= 0, index < w.episodes.count else { return nil }
        return w.episodes[index]
    }

    private func start() {
        guard !started else { return }
        started = true
        index = startIndex
        controller.onMessage = handle
        controller.load(pageURL: library.readerPageURL, readAccess: library.root)
    }

    private var settingsKey: String { "\(mode)|\(fontSize)|\(lineHeight)|\(font)|\(theme)" }

    private func applySettings() {
        controller.call("NRReader.applySettings", [
            "mode": mode, "fontSize": fontSize, "lineHeight": lineHeight, "font": font, "theme": theme,
            "insetTop": 56, "insetBottom": 56,
        ] as [String: Any])
    }

    private func handle(_ msg: [String: Any]) {
        switch msg["type"] as? String {
        case "position":
            if let r = msg["ratio"] as? Double { library.setLastRead(workId, index: index, ratio: r) }
        case "next":
            go(index + 1, ratio: 0)
        case "prev":
            go(index - 1, ratio: 0)
        case "prevEnd":
            go(index - 1, ratio: 1)
        case "toc":
            dismiss()
        case "tap":
            showBars.toggle()
        case "open":
            app.openInBrowser(msg["url"] as? String)
        default:
            break
        }
    }

    private func go(_ i: Int, ratio: Double) {
        guard let w = work, i >= 0, i < w.episodes.count else { return }
        Task { await show(i, ratio: ratio) }
    }

    /// 1話分を読み込んで表示する（保存していなければ取得して保存する）
    private func show(_ i: Int, ratio: Double? = nil, force: Bool = false) async {
        guard let count = work?.episodes.count, i >= 0, i < count else { return }
        index = i
        loading = true
        defer { loading = false }
        if !force, library.episode(workId, i) == nil {
            controller.showMessage("読み込み中…")
        }
        do {
            let c = try await importer.loadEpisode(workId, i, force: force)
            guard index == i, let w2 = library.work(workId) else { return }
            let restore = ratio ?? (w2.lastRead?.index == i ? w2.lastRead!.ratio : 0)
            let payload: [String: Any] = [
                "title": c.title, "chapter": w2.episodes[i].chapter ?? "",
                "preface": c.preface, "body": c.body, "afterword": c.afterword,
                "sourceUrl": c.url, "siteName": w2.siteName,
                "hasNext": i < w2.episodes.count - 1, "hasPrev": i > 0, "ratio": restore,
            ]
            controller.call("NRReader.render", payload)
            library.setLastRead(workId, index: i, ratio: restore)
            // 次の話を先に保存しておく
            if i + 1 < w2.episodes.count, !w2.episodes[i + 1].isSaved {
                Task {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    _ = try? await importer.loadEpisode(workId, i + 1)
                }
            }
        } catch {
            controller.showMessage("\(error.localizedDescription)\n（上のメニューの「元のページ」から開けます）")
        }
    }

    private var bars: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button { dismiss() } label: { Image(systemName: "list.bullet") }
                    .accessibilityLabel("目次")
                VStack(alignment: .leading, spacing: 0) {
                    Text(currentEpisode?.title ?? "").font(.subheadline.bold()).lineLimit(1)
                    Text(work?.title ?? "").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                if loading { ProgressView() }
                Button { app.openInBrowser(currentEpisode?.url) } label: { Image(systemName: "safari") }
                    .accessibilityLabel("元のページ")
                Button { showSettings = true } label: { Image(systemName: "textformat.size") }
                    .accessibilityLabel("表示設定")
            }
            .font(.title3)
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(.bar)
            Spacer()
            HStack {
                Button { go(index - 1, ratio: 0) } label: { Label("前の話", systemImage: "chevron.backward") }
                    .disabled(index <= 0)
                Spacer()
                Text("\(index + 1) / \(work?.episodes.count ?? 0)")
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
                Spacer()
                Button { go(index + 1, ratio: 0) } label: { Label("次の話", systemImage: "chevron.forward") }
                    .labelStyle(TrailingIconLabelStyle())
                    .disabled(index >= (work?.episodes.count ?? 1) - 1)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(.bar)
        }
        .transition(.opacity)
    }
}

struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) { configuration.title; configuration.icon }
    }
}

struct ReaderSettingsView: View {
    @Binding var mode: String
    @Binding var fontSize: Double
    @Binding var lineHeight: Double
    @Binding var font: String
    @Binding var theme: String
    var sourceUrl: String?
    var openSource: (String) -> Void
    var refetch: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Picker("方向", selection: $mode) {
                    Text("縦書き").tag("vertical")
                    Text("横書き").tag("horizontal")
                }
                .pickerStyle(.segmented)
                Picker("書体", selection: $font) {
                    Text("明朝").tag("mincho")
                    Text("ゴシック").tag("gothic")
                }
                .pickerStyle(.segmented)
                Picker("背景", selection: $theme) {
                    Text("自動").tag("auto")
                    Text("白").tag("white")
                    Text("紙").tag("sepia")
                    Text("黒").tag("dark")
                }
                .pickerStyle(.segmented)
                VStack(alignment: .leading) {
                    Text("文字サイズ \(Int(fontSize))")
                    Slider(value: $fontSize, in: 12...32, step: 1)
                }
                VStack(alignment: .leading) {
                    Text("行間 \(String(format: "%.1f", lineHeight))")
                    Slider(value: $lineHeight, in: 1.4...2.6, step: 0.1)
                }
                Section {
                    if let u = sourceUrl {
                        Button { openSource(u) } label: { Label("この話を元のページで開く", systemImage: "safari") }
                    }
                    Button { refetch() } label: { Label("この話を取得し直す", systemImage: "arrow.clockwise") }
                }
                Section {
                    Text("縦書き: 画面の左側をタップで次のページ、右側で前のページ。横書き: 下側で次、上側で前。中央をタップでメニューの表示／非表示。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("表示設定")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
