import Foundation

/// 取り込んだ作品をアプリ内（書類フォルダ）に保存する。
///   works/<作品ID>/work.json          作品情報・目次・読書位置
///   works/<作品ID>/episodes/<n>.json  各話の本文
///   works/<作品ID>/images/<hash>.png  本文中の画像
///   works/reader.html                 縦書き表示用のページ
@MainActor
final class Library: ObservableObject {
    @Published private(set) var works: [Work] = []

    let root: URL
    private let fm = FileManager.default
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return e
    }()
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        root = docs.appendingPathComponent("works", isDirectory: true)
        try? fm.createDirectory(at: root, withIntermediateDirectories: true)
        installReaderPage()
        reload()
    }

    // MARK: - 作品

    func reload() {
        let dirs = (try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        works = dirs.compactMap { dir in
            guard let data = try? Data(contentsOf: dir.appendingPathComponent("work.json")) else { return nil }
            return try? decoder.decode(Work.self, from: data)
        }
        sort()
    }

    private func sort() {
        works.sort { $0.sortDate > $1.sortDate }
    }

    func work(_ id: String) -> Work? {
        works.first { $0.id == id }
    }

    func save(_ work: Work) {
        let dir = workDir(work.id)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        if let data = try? encoder.encode(work) {
            try? data.write(to: dir.appendingPathComponent("work.json"), options: .atomic)
        }
        if let i = works.firstIndex(where: { $0.id == work.id }) {
            works[i] = work
        } else {
            works.append(work)
        }
        sort()
    }

    func delete(_ id: String) {
        try? fm.removeItem(at: workDir(id))
        works.removeAll { $0.id == id }
    }

    func setLastRead(_ id: String, index: Int, ratio: Double) {
        guard var w = work(id) else { return }
        w.lastRead = LastRead(index: index, ratio: max(0, min(1, ratio)), at: Date())
        save(w)
    }

    // MARK: - 本文・画像

    func workDir(_ id: String) -> URL {
        root.appendingPathComponent(id, isDirectory: true)
    }

    func imagesDir(_ id: String) -> URL {
        workDir(id).appendingPathComponent("images", isDirectory: true)
    }

    private func episodeURL(_ id: String, _ index: Int) -> URL {
        workDir(id).appendingPathComponent("episodes/\(index).json")
    }

    func episode(_ id: String, _ index: Int) -> EpisodeContent? {
        guard let data = try? Data(contentsOf: episodeURL(id, index)) else { return nil }
        return try? decoder.decode(EpisodeContent.self, from: data)
    }

    func saveEpisode(_ id: String, _ content: EpisodeContent) {
        let url = episodeURL(id, content.index)
        try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? encoder.encode(content) {
            try? data.write(to: url, options: .atomic)
        }
    }

    // MARK: - 縦書き表示ページ

    var readerPageURL: URL { root.appendingPathComponent("reader.html") }

    /// アプリに同梱した reader.html を、画像と同じフォルダに置く（画像を相対パスで読めるようにするため）
    private func installReaderPage() {
        guard let src = Bundle.main.url(forResource: "reader", withExtension: "html"),
              let data = try? Data(contentsOf: src) else { return }
        try? data.write(to: readerPageURL, options: .atomic)
    }

    // MARK: - ファイル一覧

    func listFiles() -> [StoredFile] {
        var out: [StoredFile] = []
        for w in works {
            let dir = workDir(w.id)
            guard let e = fm.enumerator(at: dir, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]) else { continue }
            for case let url as URL in e {
                let v = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey])
                guard v?.isRegularFile == true else { continue }
                // iOSでは /var と /private/var が混ざることがあるので、両方を実体のパスにそろえる
                let base = dir.resolvingSymlinksInPath().path
                let full = url.resolvingSymlinksInPath().path
                guard full.hasPrefix(base + "/") else { continue }
                let rel = String(full.dropFirst(base.count + 1))
                var f = StoredFile(workId: w.id, workTitle: w.title, path: rel, kind: .other, label: rel,
                                   size: v?.fileSize ?? 0, modified: v?.contentModificationDate ?? Date(),
                                   sourceUrl: nil, episodeIndex: nil, localURL: url)
                if rel == "work.json" {
                    f.kind = .toc
                    f.label = "作品情報・目次"
                    f.sourceUrl = w.sourceUrl
                } else if rel.hasPrefix("episodes/"), let n = Int(url.deletingPathExtension().lastPathComponent) {
                    f.kind = .episode
                    f.episodeIndex = n
                    f.label = n < w.episodes.count ? w.episodes[n].title : "第\(n + 1)話"
                    f.sourceUrl = n < w.episodes.count ? w.episodes[n].url : nil
                } else if rel.hasPrefix("images/") {
                    f.kind = .image
                    f.label = url.lastPathComponent
                    f.sourceUrl = w.images[url.lastPathComponent]?.url
                    f.episodeIndex = w.images[url.lastPathComponent]?.episode
                }
                out.append(f)
            }
        }
        let order: [StoredFile.Kind: Int] = [.toc: 0, .episode: 1, .image: 2, .other: 3]
        return out.sorted {
            if $0.workTitle != $1.workTitle { return $0.workTitle < $1.workTitle }
            if $0.kind != $1.kind { return order[$0.kind]! < order[$1.kind]! }
            if let a = $0.episodeIndex, let b = $1.episodeIndex, a != b, $0.kind == .episode { return a < b }
            return $0.path < $1.path
        }
    }
}
