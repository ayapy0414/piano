# なろう系リーダー（iPhoneアプリ）

アプリ内のブラウザで小説のページを開くと「本棚に追加」ボタンが出て、押すと本文と画像をiPhoneの中に保存します。保存した作品は、オフラインでも縦書きで読めます。

## できること

- **ブラウザから本棚に追加**：小説家になろう・カクヨム・ハーメルン・青空文庫の作品ページや本文ページを開くと、下に「本棚に追加」が出ます。すでに本棚にある作品なら「読む」が出ます。
  - その他のページや画像も、右下の「…」メニューの「このページを本棚に追加」で取り込めます。
- **本文と画像を保存**：本文は話を開いたときに保存し、次の話は先読みします。目次画面の「未保存の◯話を保存」で、全話をまとめて保存することもできます。挿絵もダウンロードして保存します。
- **縦書きで読む**（横書きにも切り替えられます）
  - ルビ、傍点、2桁の数字や「!?」の縦中横に対応しています。
  - 画面の左側をタップで次のページ、右側で前のページ、中央でメニューの表示切替。最後のページの先は自動で次の話に進みます。
  - 文字サイズ・行間・書体・背景色を変えられます。読んでいた位置を覚えています。
- **元のページへ戻る**：本棚（長押し）、目次、閲覧画面（上のSafariボタン・本文の最後の「出典」）、ファイル一覧から、アプリ内のブラウザで元のページを開けます。
- **ファイル一覧**：「ファイル」タブで、保存した目次・本文・画像を、作品や種類で絞り込んで確認できます。それぞれ元のURLが付いています。

## Xcodeでの作り方

Mac の Xcode（15以降）で作ります。

1. Xcode で **File → New → Project…** を選び、**iOS → App** を選びます。
   - Product Name: `NarouReader`
   - Interface: **SwiftUI** / Language: **Swift** / Storage: **None**
2. 自動で作られた `ContentView.swift` と `NarouReaderApp.swift` を削除します（「Move to Trash」）。
3. このフォルダ `ios/NarouReader/` の中身（`.swift` ファイル全部と `Resources` フォルダ）を、Xcode 左側のファイル一覧にドラッグします。
   - 「Copy items if needed」にチェックを入れます。
   - 「Add to targets」で `NarouReader` にチェックが入っていることを確認します。
4. プロジェクトの設定（左上の青いアイコン → TARGETS の NarouReader）で、次を確認します。
   - **General → Minimum Deployments**：iOS **16.0** 以上
   - **Build Phases → Copy Bundle Resources** に `Parser.js` と `reader.html` が入っていること（入っていなければ「＋」で追加）。`Parser.js` が **Compile Sources** に入っていたら、そこからは外してください。
   - **Build Settings**（右上の検索欄で探します）
     - `Swift Language Version` → **Swift 5**
     - `Default Actor Isolation` という項目があれば → **nonisolated**（Xcode 26 以降）
5. **Signing & Capabilities** で Team に自分の Apple ID を選びます。Bundle Identifier はほかと重ならない名前（例：`com.自分の名前.NarouReader`）にします。
6. iPhone をケーブルでMacにつなぎ、上の実行先に iPhone を選んで ▶︎（Run）を押します。
   - 初回は iPhone の **設定 → プライバシーとセキュリティ → デベロッパモード** をオンにする必要があります。
   - 「信頼されていない開発元」と出たら、**設定 → 一般 → VPNとデバイス管理** で自分の Apple ID を信頼します。
   - 無料の Apple ID の場合、7日ほどでアプリが起動しなくなります。そのときは、もう一度 Mac から ▶︎ で入れ直してください（保存した作品は消えません）。

## しくみ

| ファイル | 内容 |
| --- | --- |
| `NarouReaderApp.swift` | アプリの入口、タブ（本棚・ブラウザ・ファイル） |
| `BrowserView.swift` | アプリ内ブラウザと「本棚に追加」 |
| `LibraryView.swift` / `WorkView.swift` | 本棚・目次 |
| `ReaderView.swift` | 縦書き表示と表示設定 |
| `FilesView.swift` | ファイル一覧 |
| `Importer.swift` | 取り込み・本文と画像の保存・全話の一括保存 |
| `Fetcher.swift` | サイトへのアクセス（同じサイトへは1秒以上空ける、Shift_JIS対応） |
| `Sites.swift` | URLからサイトを判定 |
| `HTMLParser.swift` + `Resources/Parser.js` | ページの解析。画面に出さないWebViewの中でJavaScriptを動かします |
| `Resources/reader.html` | 縦書き表示のページ |
| `Library.swift` / `Models.swift` | 保存の仕組みとデータの形 |

保存場所はアプリの「書類」フォルダの中です。

```
works/<作品ID>/work.json          作品情報・目次・読書位置
works/<作品ID>/episodes/<n>.json  各話の本文
works/<作品ID>/images/            挿絵などの画像
```

サイトのページ構造が変わって取り込めなくなったときは、`Resources/Parser.js` の該当サイトの部分を直します。

## 補足

- `http://`（暗号化なし）のページは、iOSの標準設定では開けません。必要なら Info.plist に `App Transport Security Settings → Allow Arbitrary Loads = YES` を追加してください。
- 保存したファイルを iPhone の「ファイル」アプリからも見たいときは、Info.plist に `Application supports iTunes file sharing = YES` と `Supports opening documents in place = YES` を追加します。
- 個人で読むためのアプリです。取り込んだ作品の著作権は各作者にあります。
