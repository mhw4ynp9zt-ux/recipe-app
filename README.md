# レシピアプリ パスキーログイン実装

## 何が入っているか

```
db/schema.sql                    D1のテーブル定義
wrangler.toml                    Cloudflare Pages/D1の設定
package.json                     依存パッケージ(@simplewebauthn/server)
functions/api/auth/
  register-options.js            新規登録: パスキー作成オプションを発行
  register-verify.js             新規登録: 検証してユーザー作成・ログイン
  login-options.js                ログイン: 認証オプションを発行(ユーザー名不要)
  login-verify.js                 ログイン: 検証してセッション作成
  logout.js                       ログアウト
  me.js                            ログイン中かどうかの確認
functions/api/recipes.js          レシピ一覧取得・保存
functions/api/recipes/[id].js     レシピ削除
functions/_lib/session.js         Cookie・セッション・チャレンジの共通処理
js/save.js                        既存save.jsの置き換え(ログイン中はサーバー、未ログインはlocalStorage)
js/auth.js                        新規追加。ログイン/登録UIとセッション管理
index.html                        account-box用のHTMLと<script>タグを追加した版
```

`render-result.js` と `create-ai.js` は変更不要です(`isSaved`/`toggleSave` の呼び出し方が変わらないため)。

## 手順

### 1. 既存プロジェクトへの反映
- `js/save.js` を今回のファイルで **上書き**
- `js/auth.js` を追加
- `index.html` を今回の版で置き換え(またはdiffを見て2箇所だけ手動反映)
- `functions/`, `db/`, `wrangler.toml`, `package.json` をプロジェクトのルートに配置

### 2. 依存インストール
```
npm install
```

### 3. Cloudflareにログイン・D1データベース作成
```
npx wrangler login
npx wrangler d1 create recipe-app-db
```
表示された `database_id` を `wrangler.toml` の `database_id` に貼り付けてください。

### 4. スキーマ適用
```
npx wrangler d1 execute recipe-app-db --file=./db/schema.sql --remote
```

### 5. RP設定を自分のドメインに変更
`wrangler.toml` の `[vars]` を、実際にデプロイするPagesのURLに合わせて書き換えます。
```
RP_ID = "recipe-app-xxxx.pages.dev"
RP_NAME = "今日のレシピ回し"
ORIGIN = "https://recipe-app-xxxx.pages.dev"
```
独自ドメインを使う場合はそのドメインを指定してください。**RP_IDは登録時と一致していないとパスキーが機能しません**(サブドメインが変わっただけでも別物として扱われます)。

### 6. デプロイ
```
npx wrangler pages deploy .
```
初回はPagesプロジェクト名の入力を求められます。デプロイ後に発行されたURLが `wrangler.toml` の値と一致しているか確認してください(一致していない場合は書き換えて再デプロイ)。

### 7. 動作確認
1. アプリを開き、「設定」タブの「アカウント」欄でユーザー名を入力して「この端末のパスキーで新規登録」
2. 端末の指示(Face ID/Touch ID/画面ロックなど)に従って登録
3. 「作る」タブでレシピを作成し、保存する
4. 別のブラウザ/シークレットウィンドウから同じURLを開き、「パスキーでログイン」で同じレシピが見えることを確認

## 実装のポイント

- **パスキーの検証はサーバー側でしかできない**ため、Cloudflare Pages Functions(Workers)でAPIを追加しています。
- ログインは「ユーザー名なし」方式(resident key / discoverable credential)です。ユーザー名を入れるのは新規登録のときだけで、2回目以降は「パスキーでログイン」ボタンを押すだけで端末側が候補を出します。
- チャレンジ(使い捨ての値)とログインセッションはどちらもCookie経由のトークンでD1のテーブルを参照する方式です。JWTのような自己完結トークンではなく、いつでもサーバー側で失効させられます。
- 未ログイン時は今まで通りlocalStorageに保存されます。ログイン/新規登録した瞬間に、その端末に溜まっていた保存済みレシピをサーバー側のアカウントへ自動で引き継ぎます(`migrateLocalSavedToServer`)。

## 今回のスコープ外(必要なら次にやると良いこと)

- 設定タブのxAI APIキーは今もブラウザのlocalStorageに保存され、ブラウザから直接xAIへ送信されています。サーバー側にAPIキーを移して `/api/create-recipe` のようなエンドポイント経由で呼び出すようにすると、キーの漏洩リスクを下げられます。
- パスキーを紛失した場合の復旧手段(別のパスキーを追加登録する画面など)は未実装です。
- レート制限やCSRF対策など、公開運用する場合に追加で検討した方がよい項目があります。
