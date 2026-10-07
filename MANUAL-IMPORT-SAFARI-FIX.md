# Safari(iPhone)で説明書PDFを読み取れない問題の修正(実施内容)

仕様: `claude/SAFARI-PDF-FIX-SPEC.md`

## 根本原因(同梱の pdf.js で確認済み)
- `pdf.min.mjs` の `getTextContent` が `for await (const t of e)` で `streamTextContent()` の ReadableStream を読む(legacy ビルドにも補いは無い)。
- Safari(iOS 18.x)には `ReadableStream.prototype[Symbol.asyncIterator]` が無く、`TypeError` になる → アプリは `read_failed`。AI(`/extract`)は呼ばれない。
- `pdf.worker.min.mjs` にも `for await` が1か所(FlateDecode の `DecompressionStream`)あるが、`try/catch` で通常の展開に戻る作りなので、メイン側の補いで足りる見込み(ワーカー側も消した再現テストで確認)。

## 変更点
1. `js/manual-text.js`: `ensureReadableStreamAsyncIterator()` を追加。既定の `loadPdfjs` が `import(pdf.min.mjs)` の**前**に呼ぶ。無い環境でだけ `getReader()` ベースの実装を足す(`next` は done で `releaseLock`、`return` は `cancel`→`releaseLock`、`[Symbol.asyncIterator]()` は `this`)。pdf.js は無改変。
2. 同梱 cmaps: `Adobe-Japan1-UCS2.bcmap`・`90ms-RKSJ-H.bcmap`・`UniJIS-UCS2-H.bcmap` などの存在をテストで確認(足りなければ pdfjs-dist 6.2.108 の `cmaps/` から追加)。
3. 文字化け検知: 新コード `garbled`。空白を除いた文字のうち、ひらがな・カタカナ・漢字・英数字・基本記号の割合が 0.7 未満ならAIを呼ばずに止める。正常な日本語・記号まじりは 1.000、`˗վ଄͸͠ͳ͍ɻ` は 0.000、半々は 0.495。200文字未満の `no_text` は従来どおり。
4. 画面側: 画面は `err.message` をそのまま出すので、`no_text`・`garbled`・`read_failed` の文言に「「仕様(任意)」の欄に説明書の内容を手で入力できます」を追加(新機能なし)。

## ドキュメントの更新箇所(貼り付け用)
### claude/APPLIANCES.md「同梱のpdf.js」節の末尾に追加
- Safari(iPhone)対策: pdf.js は ReadableStream を `for await` で読むが Safari には非同期イテレーターが無いため、`js/manual-text.js` が pdf.js を読み込む前に、無い環境でだけ補いを足す(pdf.js のファイルは改変しない)。更新するときは、このフォルダのファイルの差し替えのみでよい。
- `js/vendor/pdfjs/cmaps/` は pdfjs-dist 6.2.108 の `cmaps/` と同じ(日本語の説明書は Adobe-Japan1 の対応表が必要)。`VERSION.txt` に記載。

### claude/APPLIANCES.md「テスト」節
- `test/manual-text_test.mjs`(16件): 変更なし
- `test/manual-text-safari_test.mjs`(13件): Safari 状態の再現(補いなしで getTextContent が失敗)・補いの単体・本物の pdf.js で日本語PDF(Adobe-Japan1・UniJIS・圧縮・10ページ)・文字化け検知・手入力の案内・cmaps の確認(外部通信0件)
- `test/manual-text_browser_test.mjs`: Chromium・Chromium(Safari状態の再現)・WebKit(入っていなければSKIP)。実PDFは `RSY2_PDF=パス` で確認
- `test/manual-text-device-check.html`: 実機の Safari でAIを呼ばずに抽出だけ確かめる画面(デプロイしない)
- `npm run test:manual-import` を次に変更:
  `node test/manual-extract_test.mjs && node test/manual-extract-api_test.mjs && node test/manual-text_test.mjs && node test/manual-text-safari_test.mjs && node test/manual-text_browser_test.mjs`

### README.md(説明書読み取りの行)
末尾に「Safari(iPhone)でも読めるよう、pdf.js に ReadableStream の補いを足している。文字化けしたPDFはAIに送らず手入力を案内する」を追加。

## 実機(iPhone Safari)での確認手順(AIは呼ばない)
1. PCで `npx wrangler pages dev .` を起動し、iPhone から同じネットワークでそのPCの `/test/manual-text-device-check.html` を開く(本番にはデプロイしない)。
2. RSY-2 のPDFを選び「読み取る」。「成功」と表示され、SOYMILK・300ml・Max が true、読める文字の割合が 0.9 以上なら OK。
3. 本物のアプリの読み取りボタン(/extract=有料AI)は、上が OK になってから1回だけ試す。
