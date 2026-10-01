# レシピアプリ(パスキー認証・サーバー保存・管理者AI設定)

## 何が入っているか

```
index.html                       画面(設定タブにアカウント欄と管理者用のAI設定欄)
package.json                     依存パッケージ(wrangler、@simplewebauthn/server)
wrangler.toml                    Cloudflare Pages/D1の設定(RP_ID・RP_NAME・ORIGIN)
css/style.css                    スタイル
db/schema.sql                    D1のテーブル定義(初回)
db/migration-002-ai-settings.sql AI設定用テーブルの追加分(app_settings、ai_usage_daily)
db/migration-003-foods.sql       日本食品標準成分表のテーブル定義(foods、food_groups、nutrient_defs)
db/seed-foods.sql                成分表のデータ(2,538食品。scripts/build_foods_sql.py が文科省のExcelから生成)
scripts/build_foods_sql.py       成分表のExcel → 上の2つのSQLを作るスクリプト
js/
  config.js                      栄養指標の定義(NUTRIENT_METRICS)
  utils.js                       共通関数
  save.js                        保存済みレシピの読み書き(ログイン中はサーバー、未ログインはlocalStorage)
  auth.js                        パスキーの登録・ログイン・ログアウトと、ログイン状態の管理
  settings.js                    管理者用のAI設定欄(管理者のときだけ表示)
  tabs.js                        タブ切り替え
  create-ai.js                   「作る」タブ。条件をサーバーへ送ってAIレシピを表示
  main.js                        初期化
functions/_lib/
  session.js                     Cookie・セッション・チャレンジ・管理者判定・Origin確認
  crypto.js                      APIキーの暗号化・復号(AES-GCM)
  app-settings.js                AI設定の読み書き、1日の利用回数の確保・払い戻し
  recipe-prompt.js               リクエスト検証・プロンプト組み立て・AI返答の検証
  nutrition.js                   AIが返した食材を成分表に照合し、栄養量を計算
functions/api/auth/              認証API 6本(register-options / register-verify / login-options / login-verify / logout / me)
functions/api/recipes.js         レシピ一覧取得・保存
functions/api/recipes/[id].js    レシピ削除
functions/api/admin/             管理者専用API(ai-settings.js、ai-test.js)
functions/api/ai/create-recipe.js  ログインユーザー向けAIレシピ作成
```

## 仕様の要点

- **認証**: パスキー(WebAuthn)のみ。ユーザー名の入力はなく、1ユーザー1パスキー。ログイン中は新規登録できない。
- **管理者**: Secret `ADMIN_USER_ID` に指定したユーザーIDの1人だけ。未設定なら誰も管理者にならない。
- **AI設定**: APIキー・モデル・1日の上限は管理者だけが設定できる。APIキーはAES-GCMで暗号化してD1に保存し、ブラウザには返さない。
- **AIの利用**: ログインユーザーのみ。呼び出しはサーバーが行い、プロンプトもサーバーで組み立てる。アプリ全体で1日の利用回数に上限がある(初期値50回、日本時間で毎日リセット)。失敗した回は回数に数えない。

## 設定手順

### 1. テーブルを用意する
初回は `db/schema.sql`、AI設定を追加するときは `db/migration-002-ai-settings.sql` を適用します。
```
npx wrangler d1 execute recipe-app-db --file=./db/schema.sql --remote
npx wrangler d1 execute recipe-app-db --file=./db/migration-002-ai-settings.sql --remote
```

### 1-2. 成分表のデータを入れる(栄養計算に必要)
AIが返したレシピの栄養量は、日本食品標準成分表(八訂)増補2023年をD1に入れたデータから計算します。**このデータが無いと、栄養量が表示されません**(レシピ自体は表示されます)。
```
npx wrangler d1 execute recipe-app-db --file=./db/migration-003-foods.sql --remote
npx wrangler d1 execute recipe-app-db --file=./db/seed-foods.sql --remote
npx wrangler d1 execute recipe-app-db --remote --command "SELECT COUNT(*) FROM foods"   # 2538 と出ればOK
```
`seed-foods.sql` は何度流しても同じ結果になります(成分表が改訂されたら、新しいExcelで `python3 scripts/build_foods_sql.py 食品データ.xlsx` を実行して作り直し、流し直します。反映までに最大10分かかります)。
仕組みと前提は `NUTRITION.md` を参照してください。

### 2. Secretを2つ設定する(デプロイより前に)
Cloudflareのダッシュボード(Workers & Pages → 対象プロジェクト → Settings → Variables and Secrets)で、Type を Secret にして追加します。

| 名前 | 値 |
|---|---|
| `SETTINGS_ENC_KEY` | 長いランダムな文字列(`openssl rand -base64 32` など)。APIキーの暗号鍵。変更すると保存済みのキーを復号できなくなる |
| `ADMIN_USER_ID` | 自分の `users.id`(下記のSQLで調べる) |

```
npx wrangler d1 execute recipe-app-db --remote --command "SELECT id, username, display_name FROM users"
```
Secretの追加・変更は次回のデプロイから反映されます。

### 3. デプロイ
GitHubの `main` にpushすると自動でデプロイされます。手動の場合は次のとおりです。
```
npm install
npx wrangler pages deploy .
```

### 4. 動作確認
1. 自分のパスキーでログインし、「設定」タブに「AI設定(管理者のみ)」が出ることを確認
2. APIキーを入力して「接続テスト・モデルを取得」→ モデルを選択 →「設定を保存」
3. 別のブラウザやシークレットウィンドウで新規登録し、「設定」タブにAI設定が**出ない**ことを確認
4. そのユーザーで「作る」タブからレシピが作れることを確認

## 実装のポイント

- **権限チェックはすべてサーバー側**です。設定欄の表示切り替えは見た目だけで、管理者用APIは管理者以外に403を返します。
- ログインは「ユーザー名なし」方式(resident key / discoverable credential)です。新規登録時の内部名(`recipe-` + 8桁の16進数)はサーバーが自動生成し、画面には出しません。
- チャレンジとログインセッションは、Cookie経由のトークンでD1のテーブルを参照する方式です。サーバー側でいつでも失効できます。
- 未ログイン時は保存済みレシピをlocalStorageに保存します。ログイン・新規登録した瞬間に、その端末の分をアカウントへ引き継ぎます(`migrateLocalSavedToServer`)。
- 旧版が端末のlocalStorageに保存したGrokの設定(`recipeRouletteGrokSettingsV1`)は、管理者が設定欄を開いたときにサーバーへ移行し、端末側を削除します。

## 運用上の注意

- **パスキーはドメイン(`RP_ID`)に紐づきます。** 独自ドメインへ移すと全員のパスキーが使えなくなるため、移す予定があるなら利用者を増やす前に行ってください。
- **パスキーを失くしたときの復旧手段はありません。** 管理者本人の場合は、新しく登録してから `ADMIN_USER_ID` を新しいIDに差し替え、必要なら次のSQLで保存済みレシピを付け替えます。
  ```
  npx wrangler d1 execute recipe-app-db --remote --command "UPDATE recipes SET user_id='新しいID' WHERE user_id='古いID'"
  ```
- **新規登録は誰でもできます。** 1日の上限はアプリ全体で共通なので、知らない人に枠を使われる可能性があります。

## 未実装・今後の課題

詳しくは設計書を参照してください。主なものは次のとおりです。

- 新規登録の受付の制御(停止・招待制)
- ユーザーごとの利用制限、IPごとの登録制限
- 認証APIのレート制限
- 期限切れデータ(`challenges`・`sessions`)の掃除
- 保存失敗の画面通知、端末内レシピの引き継ぎ失敗時の扱い
- アカウント削除
