import Foundation

/// URLから作品を取り込み、各話の本文と画像を保存する
@MainActor
final class Importer: ObservableObject {
    struct Job: Equatable {
        var total = 0
        var done = 0
        var failed: [Int] = []
        var running = true
    }

    @Published private(set) var jobs: [String: Job] = [:]
    @Published private(set) var importing: Set<String> = []

    private let library: Library
    private let parser: HTMLParser
    private var jobTasks: [String: Task<Void, Never>] = [:]
    private var inflight: [String: Task<EpisodeContent, Error>] = [:]

    init(library: Library) {
        self.library = library
        self.parser = HTMLParser.shared
    }

    // MARK: - 作品の取り込み

    struct ImportResult {
        var work: Work
        var isNew: Bool
        var added: Int
    }

    func importURL(_ text: String) async throws -> ImportResult {
        var s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !s.lowercased().hasPrefix("http") { s = "https://" + s }
        guard let url = URL(string: s), let match = Sites.detect(url) else {
            throw FetchError.notFound("URLの形式が正しくありません")
        }
        importing.insert(match.workId)
        defer { importing.remove(match.workId) }

        let data = try await fetchWork(match, original: url)
        guard !data.episodes.isEmpty else { throw FetchError.notFound("目次（話の一覧）が見つかりませんでした") }

        let existing = library.work(match.workId)
        let old = Dictionary((existing?.episodes ?? []).map { ($0.url, $0) }, uniquingKeysWith: { a, _ in a })
        let episodes = data.episodes.enumerated().map { i, e -> Episode in
            let prev = old[e.url].flatMap { $0.index == i ? $0 : nil }
            return Episode(index: i, title: e.title, chapter: e.chapter, url: e.url,
                           fetchedAt: prev?.fetchedAt, imageCount: prev?.imageCount ?? 0)
        }
        var work = Work(
            id: match.workId, site: match.site, siteName: match.siteName,
            sourceUrl: data.sourceUrl, title: data.title.isEmpty ? "(無題)" : data.title,
            author: data.author, authorUrl: data.authorUrl, synopsis: data.synopsis,
            importedAt: existing?.importedAt ?? Date(), updatedAt: Date(),
            lastRead: existing?.lastRead, images: existing?.images ?? [:], episodes: episodes)
        library.save(work)

        // 短編など、目次と一緒に本文が取れたものは保存しておく
        if let single = data.single {
            _ = try await storeEpisode(workId: work.id, index: 0, parsed: single, pageURL: url)
            work = library.work(work.id) ?? work
        }
        return ImportResult(work: work, isNew: existing == nil, added: episodes.count - (existing?.episodes.count ?? 0))
    }

    func refresh(_ id: String) async throws -> ImportResult {
        guard let w = library.work(id) else { throw FetchError.notFound("作品が見つかりません") }
        return try await importURL(w.sourceUrl)
    }

    private typealias TocItem = (title: String, url: String, chapter: String?)

    private struct WorkData {
        var sourceUrl: String
        var title: String
        var author: String
        var authorUrl: String?
        var synopsis: String
        var episodes: [TocItem]
        var single: ParsedEpisode?
    }

    private func fetchWork(_ m: SiteMatch, original: URL) async throws -> WorkData {
        let fetcher = Fetcher.shared
        switch m.site {
        case "narou":
            // 目次は100話ごとにページが分かれている
            var pageURL: URL? = m.workURL
            var chapter: String?
            var first: ParsedToc?
            var eps: [TocItem] = []
            var page = 0
            while let u = pageURL, page < 300 {
                page += 1
                let r = try await fetcher.html(u)
                let toc = try await parser.parseToc(site: m.site, html: r.html, url: r.url, chapter: chapter)
                if first == nil { first = toc }
                if toc.isSingle == true, page == 1, let single = toc.single {
                    let title = toc.title ?? ""
                    return WorkData(sourceUrl: m.workURL.absoluteString, title: title, author: toc.author ?? "",
                                    authorUrl: toc.authorUrl, synopsis: toc.synopsis ?? "",
                                    episodes: [(title, m.workURL.absoluteString, nil)], single: single)
                }
                eps += toc.episodes.compactMap { e -> TocItem? in
                    guard let u = e.url else { return nil }
                    return (title: e.title, url: u, chapter: e.chapter)
                }
                chapter = toc.chapter
                pageURL = toc.episodes.isEmpty ? nil : toc.next.flatMap(URL.init(string:))
            }
            let t = first!
            return WorkData(sourceUrl: m.workURL.absoluteString, title: t.title ?? "", author: t.author ?? "",
                            authorUrl: t.authorUrl, synopsis: t.synopsis ?? "", episodes: eps, single: nil)

        case "kakuyomu", "hameln", "aozora":
            var r = try await fetcher.html(m.workURL)
            var toc = try await parser.parseToc(site: m.site, html: r.html, url: r.url, chapter: nil)
            if let redirect = toc.redirect.flatMap(URL.init(string:)) {
                // 青空文庫の図書カード → 本文ページへ
                r = try await fetcher.html(redirect)
                toc = try await parser.parseToc(site: m.site, html: r.html, url: r.url, chapter: nil)
            } else if m.site == "aozora", toc.redirect == nil, toc.isSingle != true {
                throw FetchError.notFound("図書カードに本文（XHTML版）が見つかりませんでした")
            }
            let title = toc.title ?? ""
            var eps: [TocItem] = toc.episodes.compactMap { e -> TocItem? in
                guard let u = e.url else { return nil }
                return (title: e.title, url: u, chapter: e.chapter)
            }
            if toc.isSingle == true { eps = [(title, r.url.absoluteString, nil)] }
            return WorkData(sourceUrl: m.site == "aozora" ? original.absoluteString : m.workURL.absoluteString,
                            title: title, author: toc.author ?? "", authorUrl: toc.authorUrl,
                            synopsis: toc.synopsis ?? "", episodes: eps, single: toc.single)

        default:
            // その他のページ・画像・テキスト
            let (data, resp) = try await fetcher.data(original)
            let type = (resp.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
            let finalURL = resp.url ?? original
            let name = finalURL.lastPathComponent.removingPercentEncoding ?? finalURL.lastPathComponent
            if type.hasPrefix("image/") {
                let ep = ParsedEpisode(title: name, preface: "", body: "<p><img src=\"nrimg:0\" alt=\"\"></p>",
                                       afterword: "", images: [finalURL.absoluteString])
                return WorkData(sourceUrl: original.absoluteString, title: name, author: finalURL.host ?? "",
                                authorUrl: nil, synopsis: "", episodes: [(name, finalURL.absoluteString, nil)], single: ep)
            }
            let text = Fetcher.decode(data, response: resp)
            if type.hasPrefix("text/plain") {
                let body = try await parser.textToHtml(text)
                let ep = ParsedEpisode(title: name, preface: "", body: body, afterword: "", images: [])
                return WorkData(sourceUrl: original.absoluteString, title: name, author: finalURL.host ?? "",
                                authorUrl: nil, synopsis: "", episodes: [(name, finalURL.absoluteString, nil)], single: ep)
            }
            let toc = try await parser.parseToc(site: "web", html: text, url: finalURL, chapter: nil)
            let title = toc.title ?? name
            return WorkData(sourceUrl: original.absoluteString, title: title, author: toc.author ?? "",
                            authorUrl: nil, synopsis: toc.synopsis ?? "",
                            episodes: [(title, finalURL.absoluteString, nil)], single: toc.single)
        }
    }

    // MARK: - 本文の取得

    func loadEpisode(_ id: String, _ index: Int, force: Bool = false) async throws -> EpisodeContent {
        if !force, let cached = library.episode(id, index) { return cached }
        let key = "\(id)/\(index)"
        if let t = inflight[key] { return try await t.value }
        let task = Task { @MainActor () throws -> EpisodeContent in
            guard let work = library.work(id), index < work.episodes.count else {
                throw FetchError.notFound("その話は見つかりません")
            }
            let ep = work.episodes[index]
            guard let url = URL(string: ep.url) else { throw FetchError.notFound("URLが正しくありません") }
            let parsed: ParsedEpisode
            if work.site == "web" {
                // 画像・テキストのURLは取り込み直す
                _ = try await importURL(work.sourceUrl)
                guard let c = library.episode(id, index) else { throw FetchError.notFound("本文が見つかりませんでした") }
                return c
            } else {
                let r = try await Fetcher.shared.html(url)
                parsed = try await parser.parseEpisode(site: work.site, html: r.html, url: r.url)
            }
            return try await storeEpisode(workId: id, index: index, parsed: parsed, pageURL: url)
        }
        inflight[key] = task
        defer { inflight[key] = nil }
        return try await task.value
    }

    /// 画像をダウンロードしてから本文を保存する
    private func storeEpisode(workId: String, index: Int, parsed: ParsedEpisode, pageURL: URL) async throws -> EpisodeContent {
        guard parsed.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            throw FetchError.notFound("本文が見つかりませんでした（ページの構造が変わった可能性があります）")
        }
        var known = library.work(workId)?.images ?? [:]
        var replacements: [String: String] = [:]
        var newImages: [String: ImageInfo] = [:]
        var count = 0
        for (i, src) in parsed.images.enumerated() {
            let hash = Sites.stableHash(src)
            if let file = known.keys.first(where: { $0.hasPrefix(hash + ".") }) {
                replacements["nrimg:\(i)"] = "\(workId)/images/\(file)"
                count += 1
                continue
            }
            do {
                guard let u = URL(string: src) else { throw FetchError.notFound("") }
                let (data, resp) = try await Fetcher.shared.data(u, referer: pageURL.absoluteString)
                let type = (resp.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
                guard let ext = Importer.imageExt(type) else { throw FetchError.notFound("画像ではありません") }
                let file = "\(hash).\(ext)"
                let dir = library.imagesDir(workId)
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try data.write(to: dir.appendingPathComponent(file), options: .atomic)
                let info = ImageInfo(url: src, episode: index, size: data.count, savedAt: Date())
                newImages[file] = info
                known[file] = info
                replacements["nrimg:\(i)"] = "\(workId)/images/\(file)"
                count += 1
            } catch {
                replacements["nrimg:\(i)"] = "missing:"
            }
        }
        func fix(_ html: String) -> String {
            // 番号の大きい方から置き換える（nrimg:1 が nrimg:10 の一部を書き換えないように）
            var out = html
            for key in replacements.keys.sorted(by: { $0.count > $1.count || ($0.count == $1.count && $0 > $1) }) {
                out = out.replacingOccurrences(of: "src=\"\(key)\"", with: "src=\"\(replacements[key]!)\"")
            }
            return out
        }
        guard var work = library.work(workId), index < work.episodes.count else {
            throw FetchError.notFound("作品が見つかりません")
        }
        let content = EpisodeContent(index: index, title: parsed.title.isEmpty ? work.episodes[index].title : parsed.title,
                                     url: work.episodes[index].url, preface: fix(parsed.preface), body: fix(parsed.body),
                                     afterword: fix(parsed.afterword), fetchedAt: Date())
        library.saveEpisode(workId, content)
        work.episodes[index].fetchedAt = content.fetchedAt
        work.episodes[index].imageCount = count
        work.images.merge(newImages) { _, new in new }
        library.save(work)
        return content
    }

    private static func imageExt(_ type: String) -> String? {
        let t = type.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        return ["image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif",
                "image/webp": "webp", "image/avif": "avif", "image/bmp": "bmp", "image/svg+xml": "svg"][t]
    }

    // MARK: - 全話の一括保存

    func downloadAll(_ id: String) {
        if jobs[id]?.running == true { return }
        guard let work = library.work(id) else { return }
        let targets = work.episodes.filter { !$0.isSaved }.map(\.index)
        jobs[id] = Job(total: targets.count)
        jobTasks[id] = Task { [weak self] in
            for i in targets {
                guard let self, !Task.isCancelled else { break }
                do {
                    _ = try await self.loadEpisode(id, i)
                } catch {
                    if Task.isCancelled { break }
                    self.jobs[id]?.failed.append(i)
                }
                self.jobs[id]?.done += 1
            }
            self?.jobs[id]?.running = false
            self?.jobTasks[id] = nil
        }
    }

    func cancel(_ id: String) {
        jobTasks[id]?.cancel()
        jobTasks[id] = nil
        jobs[id]?.running = false
    }
}
