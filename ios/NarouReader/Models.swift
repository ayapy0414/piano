import Foundation

/// 目次の1話分
struct Episode: Codable, Identifiable, Hashable {
    var index: Int
    var title: String
    var chapter: String?
    var url: String
    var fetchedAt: Date?
    var imageCount: Int = 0

    var id: Int { index }
    var isSaved: Bool { fetchedAt != nil }
}

/// 保存した画像の情報（元のURLを覚えておく）
struct ImageInfo: Codable, Hashable {
    var url: String
    var episode: Int
    var size: Int
    var savedAt: Date
}

/// 最後に読んだ位置
struct LastRead: Codable, Hashable {
    var index: Int
    var ratio: Double
    var at: Date
}

/// 本棚の1作品
struct Work: Codable, Identifiable, Hashable {
    var id: String
    var site: String
    var siteName: String
    var sourceUrl: String
    var title: String
    var author: String
    var authorUrl: String?
    var synopsis: String
    var importedAt: Date
    var updatedAt: Date
    var lastRead: LastRead?
    var images: [String: ImageInfo] = [:]
    var episodes: [Episode]

    var savedCount: Int { episodes.filter(\.isSaved).count }
    var sortDate: Date { lastRead?.at ?? updatedAt }
}

/// 保存した本文（HTMLは無害化済み、画像はローカルのパス）
struct EpisodeContent: Codable {
    var index: Int
    var title: String
    var url: String
    var preface: String
    var body: String
    var afterword: String
    var fetchedAt: Date
}

/// ファイル一覧の1行
struct StoredFile: Identifiable, Hashable {
    enum Kind: String, CaseIterable, Identifiable {
        case toc = "目次", episode = "本文", image = "画像", other = "その他"
        var id: String { rawValue }
    }
    var id: String { "\(workId)/\(path)" }
    var workId: String
    var workTitle: String
    var path: String
    var kind: Kind
    var label: String
    var size: Int
    var modified: Date
    var sourceUrl: String?
    var episodeIndex: Int?
    var localURL: URL
}

/// 画面遷移の行き先
enum Route: Hashable {
    case work(String)
    case reader(String, Int)
}
