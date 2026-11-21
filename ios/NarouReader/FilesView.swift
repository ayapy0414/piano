import SwiftUI

/// 取り込んだファイルの一覧（目次・本文・画像）
struct FilesView: View {
    @EnvironmentObject var library: Library
    @EnvironmentObject var app: AppState

    @State private var files: [StoredFile] = []
    @State private var workFilter = ""
    @State private var kindFilter: StoredFile.Kind?
    @State private var query = ""
    @State private var preview: StoredFile?

    private var filtered: [StoredFile] {
        files.filter { f in
            (workFilter.isEmpty || f.workId == workFilter) &&
            (kindFilter == nil || f.kind == kindFilter) &&
            (query.isEmpty || "\(f.label) \(f.path) \(f.workTitle)".localizedCaseInsensitiveContains(query))
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("作品", selection: $workFilter) {
                        Text("すべての作品").tag("")
                        ForEach(library.works) { w in Text(w.title).tag(w.id) }
                    }
                    Picker("種類", selection: $kindFilter) {
                        Text("すべて").tag(StoredFile.Kind?.none)
                        ForEach(StoredFile.Kind.allCases) { k in Text(k.rawValue).tag(Optional(k)) }
                    }
                } footer: {
                    Text("\(filtered.count)件・\(filtered.reduce(0) { $0 + $1.size }.byteText)")
                }

                Section {
                    if filtered.isEmpty {
                        Text("ファイルがありません").foregroundStyle(.secondary)
                    }
                    ForEach(filtered) { f in
                        Button { open(f) } label: { FileRow(file: f) }
                            .buttonStyle(.plain)
                            .contextMenu {
                                if let s = f.sourceUrl {
                                    Button { app.openInBrowser(s) } label: { Label("元のページを開く", systemImage: "safari") }
                                    Button { UIPasteboard.general.string = s } label: { Label("元のURLをコピー", systemImage: "doc.on.doc") }
                                }
                                Button { app.openWork(f.workId) } label: { Label("作品の目次へ", systemImage: "list.bullet") }
                            }
                            .swipeActions(edge: .trailing) {
                                if let s = f.sourceUrl {
                                    Button { app.openInBrowser(s) } label: { Label("元のページ", systemImage: "safari") }
                                        .tint(.blue)
                                }
                            }
                    }
                }
            }
            .searchable(text: $query, prompt: "名前で絞り込み")
            .navigationTitle("ファイル一覧")
            .refreshable { files = library.listFiles() }
            .onAppear { files = library.listFiles() }
            .onChange(of: library.works) { _ in files = library.listFiles() }
            .sheet(item: $preview) { f in ImagePreview(file: f, openSource: { s in preview = nil; app.openInBrowser(s) }) }
        }
    }

    private func open(_ f: StoredFile) {
        switch f.kind {
        case .episode: app.read(f.workId, f.episodeIndex ?? 0)
        case .image: preview = f
        default: app.openWork(f.workId)
        }
    }
}

struct FileRow: View {
    let file: StoredFile

    var body: some View {
        HStack(spacing: 12) {
            thumbnail
                .frame(width: 44, height: 44)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 6))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                Text(file.label).lineLimit(1)
                Text(file.workTitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                HStack(spacing: 8) {
                    Text(file.kind.rawValue)
                    Text(file.size.byteText)
                    Text(file.modified.shortText)
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
                if let s = file.sourceUrl {
                    Text(s).font(.caption2).foregroundStyle(Color.accentColor).lineLimit(1).truncationMode(.middle)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder private var thumbnail: some View {
        switch file.kind {
        case .image:
            if let img = UIImage(contentsOfFile: file.localURL.path) {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                Image(systemName: "photo").foregroundStyle(.secondary)
            }
        case .episode: Image(systemName: "doc.text").foregroundStyle(.secondary)
        case .toc: Image(systemName: "list.bullet.rectangle").foregroundStyle(.secondary)
        case .other: Image(systemName: "doc").foregroundStyle(.secondary)
        }
    }
}

struct ImagePreview: View {
    let file: StoredFile
    var openSource: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView([.horizontal, .vertical]) {
                if let img = UIImage(contentsOfFile: file.localURL.path) {
                    Image(uiImage: img).resizable().scaledToFit()
                        .frame(maxWidth: UIScreen.main.bounds.width)
                } else {
                    Text("この画像は表示できません（SVGなど）").foregroundStyle(.secondary).padding()
                }
            }
            .navigationTitle(file.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("閉じる") { dismiss() } }
                if let s = file.sourceUrl {
                    ToolbarItem(placement: .primaryAction) {
                        Button { openSource(s) } label: { Label("元のページ", systemImage: "safari") }
                    }
                }
            }
        }
    }
}
