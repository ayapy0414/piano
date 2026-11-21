import SwiftUI

/// 作品ページ（あらすじと目次）
struct WorkView: View {
    let workId: String
    @EnvironmentObject var library: Library
    @EnvironmentObject var importer: Importer
    @EnvironmentObject var app: AppState

    @State private var expanded = false
    @State private var refreshing = false
    @State private var message: String?

    var body: some View {
        if let w = library.work(workId) {
            content(w)
        } else {
            Text("作品が見つかりません").foregroundStyle(.secondary)
        }
    }

    /// 章ごとにまとめた目次
    private func sections(_ w: Work) -> [(chapter: String?, episodes: [Episode])] {
        var out: [(String?, [Episode])] = []
        for e in w.episodes {
            if let last = out.last, last.0 == e.chapter {
                out[out.count - 1].1.append(e)
            } else {
                out.append((e.chapter, [e]))
            }
        }
        return out.map { (chapter: $0.0, episodes: $0.1) }
    }

    private func content(_ w: Work) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(w.siteName).font(.caption).foregroundStyle(.secondary)
                    Text(w.title).font(.title3.bold())
                    if let a = w.authorUrl {
                        Button(w.author) { app.openInBrowser(a) }.font(.subheadline)
                    } else {
                        Text(w.author).font(.subheadline).foregroundStyle(.secondary)
                    }
                    if !w.synopsis.isEmpty {
                        Text(w.synopsis)
                            .font(.footnote)
                            .lineLimit(expanded ? nil : 4)
                            .onTapGesture { withAnimation { expanded.toggle() } }
                    }
                    Text("全\(w.episodes.count)話・保存済み\(w.savedCount)話・画像\(w.images.count)枚・更新 \(w.updatedAt.shortText)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)

                Button {
                    app.libraryPath.append(.reader(w.id, w.lastRead?.index ?? 0))
                } label: {
                    Label(w.lastRead.map { "続きから読む（第\($0.index + 1)話）" } ?? "最初から読む", systemImage: "book")
                }
                Button {
                    app.openInBrowser(w.sourceUrl)
                } label: {
                    Label("元のページを開く", systemImage: "safari")
                }
                Button {
                    Task { await refresh() }
                } label: {
                    HStack {
                        Label("目次を更新", systemImage: "arrow.clockwise")
                        if refreshing { Spacer(); ProgressView() }
                    }
                }
                .disabled(refreshing)
                downloadRow(w)
            }

            ForEach(Array(sections(w).enumerated()), id: \.offset) { _, sec in
                Section(sec.chapter ?? "") {
                    ForEach(sec.episodes) { e in
                        NavigationLink(value: Route.reader(w.id, e.index)) {
                            HStack(alignment: .firstTextBaseline) {
                                Text("\(e.index + 1)")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                                    .frame(minWidth: 28, alignment: .leading)
                                Text(e.title)
                                    .fontWeight(w.lastRead?.index == e.index ? .bold : .regular)
                                Spacer()
                                if e.imageCount > 0 {
                                    Image(systemName: "photo").font(.caption2).foregroundStyle(.secondary)
                                }
                                Circle()
                                    .fill(e.isSaved ? Color.green : Color.secondary.opacity(0.3))
                                    .frame(width: 7, height: 7)
                            }
                        }
                        .contextMenu {
                            Button { app.openInBrowser(e.url) } label: { Label("この話を元のページで開く", systemImage: "safari") }
                        }
                    }
                }
            }
        }
        .navigationTitle(w.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { app.openInBrowser(w.sourceUrl) } label: { Image(systemName: "safari") }
                    .accessibilityLabel("元のページ")
            }
        }
        .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("OK", role: .cancel) {}
        }
    }

    @ViewBuilder
    private func downloadRow(_ w: Work) -> some View {
        let job = importer.jobs[w.id]
        if let job, job.running {
            VStack(alignment: .leading) {
                HStack {
                    Text("保存中… \(job.done) / \(job.total)")
                    Spacer()
                    Button("中止") { importer.cancel(w.id) }
                }
                ProgressView(value: Double(job.done), total: Double(max(job.total, 1)))
            }
        } else {
            Button {
                importer.downloadAll(w.id)
            } label: {
                Label(w.savedCount == w.episodes.count ? "全話保存済み" : "未保存の\(w.episodes.count - w.savedCount)話を保存",
                      systemImage: "arrow.down.circle")
            }
            .disabled(w.savedCount == w.episodes.count)
            if let job, !job.failed.isEmpty {
                Text("取得できなかった話: \(job.failed.prefix(8).map { "第\($0 + 1)話" }.joined(separator: "、"))\(job.failed.count > 8 ? "…" : "")")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    private func refresh() async {
        refreshing = true
        defer { refreshing = false }
        do {
            let r = try await importer.refresh(workId)
            message = r.added > 0 ? "新しい話が\(r.added)件あります" : "目次を更新しました"
        } catch {
            message = error.localizedDescription
        }
    }
}
