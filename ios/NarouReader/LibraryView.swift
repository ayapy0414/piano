import SwiftUI

/// 本棚（取り込んだ作品の一覧）
struct LibraryView: View {
    @EnvironmentObject var library: Library
    @EnvironmentObject var importer: Importer
    @EnvironmentObject var app: AppState

    @State private var urlText = ""
    @State private var busy = false
    @State private var message: String?
    @State private var deleting: Work?

    var body: some View {
        NavigationStack(path: $app.libraryPath) {
            List {
                Section {
                    HStack {
                        TextField("作品のURLを貼り付け", text: $urlText)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.go)
                            .onSubmit(add)
                        if busy {
                            ProgressView()
                        } else {
                            Button("追加", action: add).disabled(urlText.isEmpty)
                        }
                    }
                    Button {
                        app.tab = .browser
                    } label: {
                        Label("ブラウザで小説を探して追加", systemImage: "safari")
                    }
                } footer: {
                    Text("小説家になろう・カクヨム・ハーメルン・青空文庫に対応。その他のページや画像のURLも取り込めます。")
                }

                Section("本棚（\(library.works.count)作品）") {
                    if library.works.isEmpty {
                        Text("まだ作品がありません").foregroundStyle(.secondary)
                    }
                    ForEach(library.works) { w in
                        NavigationLink(value: Route.work(w.id)) {
                            WorkRow(work: w, job: importer.jobs[w.id])
                        }
                        .swipeActions {
                            Button(role: .destructive) { deleting = w } label: { Label("削除", systemImage: "trash") }
                        }
                        .contextMenu {
                            Button { app.read(w.id, w.lastRead?.index ?? 0) } label: { Label("続きから読む", systemImage: "book") }
                            Button { app.openInBrowser(w.sourceUrl) } label: { Label("元のページを開く", systemImage: "safari") }
                            Button(role: .destructive) { deleting = w } label: { Label("削除", systemImage: "trash") }
                        }
                    }
                }
            }
            .navigationTitle("なろう系リーダー")
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .work(let id): WorkView(workId: id)
                case .reader(let id, let index): ReaderView(workId: id, startIndex: index)
                }
            }
            .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("OK", role: .cancel) {}
            }
            .confirmationDialog("「\(deleting?.title ?? "")」と保存したファイルを削除しますか？",
                                isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                                titleVisibility: .visible) {
                Button("削除", role: .destructive) {
                    if let w = deleting {
                        importer.cancel(w.id)
                        library.delete(w.id)
                    }
                    deleting = nil
                }
            }
        }
    }

    private func add() {
        let text = urlText
        guard !text.isEmpty, !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let r = try await importer.importURL(text)
                urlText = ""
                app.openWork(r.work.id)
            } catch {
                message = error.localizedDescription
            }
        }
    }
}

struct WorkRow: View {
    let work: Work
    let job: Importer.Job?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(work.siteName)
                    .font(.caption2)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.quaternary, in: Capsule())
                if let job, job.running {
                    ProgressView().controlSize(.mini)
                    Text("保存中 \(job.done)/\(job.total)").font(.caption2).foregroundStyle(.secondary)
                }
            }
            Text(work.title).font(.headline).lineLimit(2)
            Text(work.author).font(.subheadline).foregroundStyle(.secondary)
            HStack {
                Text("全\(work.episodes.count)話・保存\(work.savedCount)話・画像\(work.images.count)枚")
                Spacer()
                if let r = work.lastRead {
                    Text("第\(r.index + 1)話まで")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            ProgressView(value: Double(work.savedCount), total: Double(max(work.episodes.count, 1)))
                .tint(.secondary)
        }
        .padding(.vertical, 4)
    }
}
