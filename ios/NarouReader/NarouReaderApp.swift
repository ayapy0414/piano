import SwiftUI

@main
struct NarouReaderApp: App {
    @StateObject private var library: Library
    @StateObject private var importer: Importer
    @StateObject private var app = AppState()

    init() {
        let lib = Library()
        _library = StateObject(wrappedValue: lib)
        _importer = StateObject(wrappedValue: Importer(library: lib))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(library)
                .environmentObject(importer)
                .environmentObject(app)
                .tint(Color(red: 0.54, green: 0.31, blue: 0.14))
        }
    }
}

/// タブの切り替えや画面遷移をまとめて持つ
@MainActor
final class AppState: ObservableObject {
    enum Tab: Hashable { case library, browser, files }

    @Published var tab: Tab = .library
    @Published var libraryPath: [Route] = []
    /// ブラウザで開いてほしいURL（元のページへ戻るときに使う）
    @Published var browserRequest: URL?

    func openInBrowser(_ s: String?) {
        guard let s, let url = URL(string: s) else { return }
        browserRequest = url
        tab = .browser
    }

    func openWork(_ id: String) {
        libraryPath = [.work(id)]
        tab = .library
    }

    func read(_ id: String, _ index: Int) {
        libraryPath = [.work(id), .reader(id, index)]
        tab = .library
    }
}

struct RootView: View {
    @EnvironmentObject var app: AppState

    var body: some View {
        TabView(selection: $app.tab) {
            LibraryView()
                .tabItem { Label("本棚", systemImage: "books.vertical") }
                .tag(AppState.Tab.library)
            BrowserView()
                .tabItem { Label("ブラウザ", systemImage: "safari") }
                .tag(AppState.Tab.browser)
            FilesView()
                .tabItem { Label("ファイル", systemImage: "folder") }
                .tag(AppState.Tab.files)
        }
    }
}

extension Date {
    var shortText: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ja_JP")
        f.dateFormat = "yyyy/MM/dd HH:mm"
        return f.string(from: self)
    }
}

extension Int {
    var byteText: String {
        ByteCountFormatter.string(fromByteCount: Int64(self), countStyle: .file)
    }
}
