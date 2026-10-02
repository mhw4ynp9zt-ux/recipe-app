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
db/seed-foods.sql                成分表のデータ(wrangler用。2,538食品。scripts/build_foods_sql.py が文科省のExcelから生成)
data/foods.json                  成分表のデータ(ブラウザ取り込み用)
scripts/build_foods_sql.py       成分表のExcel → 上の2つのSQLを作るスクリプト
js/
  config.js                      栄養指標の定義(NUTRIENT_METRICS)
  utils.js                       共通関数
  error-log.js                   管理者向けエラーログ(記録・ダウンロード)。他のファイルの失敗もここに集まる
  save.js                        保存済みレシピの読み書き(ログイン中はサーバー、未ログインはlocalStorage)
  auth.js                        パスキーの登録・ログイン・ログアウトと、ログイン状態の管理
  settings.js                    管理者用のAI設定欄(管理者のときだけ表示)
  tabs.js                        タブ切り替え
  create-ai.js                   「作る」タブ。条件をサーバーへ送ってAIレシピを表示
  recipe-edit-core.js            レシピ編集・自作の処理(入力の整形、プレビュー計算の遅延、保存)。通信は注入された fetch だけ
  recipe-edit.js                 レシピ編集・自作の画面(自作ボタンと編集シートを実行時に差し込む)
  main.js                        初期化
functions/_lib/
  session.js                     Cookie・セッション・チャレンジ・管理者判定・Origin確認
  crypto.js                      APIキーの暗号化・復号(AES-GCM)
  app-settings.js                AI設定の読み書き、1日の利用回数の確保・払い戻し
  recipe-prompt.js               リクエスト検証・プロンプト組み立て・AI返答の検証
  debug-trace.js                 管理者だけに返すデバッグ情報(失敗の詳細)の収集と、APIキーの伏せ字処理
  nutrition.js                   AIが返した食材を成分表に照合し、栄養量を計算
  foods-import.js / foods-schema.js  成分表の取り込み処理とテーブル定義(foods-schemaは自動生成)
  recipe-edit.js                 編集・自作の入力検査と正規化(AIは呼ばない)
functions/api/auth/              認証API 6本(register-options / register-verify / login-options / login-verify / logout / me)
functions/api/recipes.js         レシピ一覧取得・保存
functions/api/recipes/[id].js    レシピ削除・編集の上書き保存(PUT)
functions/api/recipes/calc.js    編集中のプレビュー栄養計算(保存しない)
functions/api/recipes/custom.js  自作レシピの新規保存
functions/api/admin/             管理者専用API(ai-settings.js、ai-test.js、import-foods.js)
functions/api/ai/create-recipe.js  ログインユーザー向けAIレシピ作成
test/
  recipe-edit-*_test.mjs         レシピ編集・自作のテスト7本(npm run test:edit。fetch はテストの中でスタブにする)
  edit_env.mjs                   上のテスト用のDBと環境(node:sqlite のメモリDBでD1を再現。ログインCookie・リクエストの組み立て)
  fixtures/                      テスト用の小さな成分表(foods-mini.sql)とテーブル定義(app-schema.sql)
docs/                            設計書(RECIPE-EDIT.md など)
```

## 仕様の要点

- **認証**: パスキー(WebAuthn)のみ。ユーザー名の入力はなく、1ユーザー1パスキー。ログイン中は新規登録できない。
- **管理者**: Secret `ADMIN_USER_ID` に指定したユーザーIDの1人だけ。未設定なら誰も管理者にならない。
- **AI設定**: APIキー・モデル・1日の上限は管理者だけが設定できる。APIキーはAES-GCMで暗号化してD1に保存し、ブラウザには返さない。
- **エラーログ(管理者のみ)**: 画面でエラーが起きると、管理者には「ログをダウンロード」ボタンが出ます(「作る」タブのエラー表示の下と、「設定」タブの管理者欄)。詳細は下の「エラーログ」を参照。
- **AIの利用**: ログインユーザーのみ。呼び出しはサーバーが行い、プロンプトもサーバーで組み立てる。アプリ全体で1日の利用回数に上限がある(初期値50回、日本時間で毎日リセット)。失敗した回は回数に数えない。
- **レシピの編集・自作入力**: 保存済みレシピの編集と、自分で材料・作り方を入力する自作ができる(ログイン必須)。編集・自作はAIを一切呼ばない。栄養値は入力値を信用せず、サーバーが必ず成分表から再計算する。成分表に無い食材だけ栄養値を手入力でき、その値は「その行のグラム数ぶんの合計」(100gあたりではない)。保存は「上書き」と「別名で保存」を選べる。テストは `npm run test:edit` で、通信はすべてスタブのため外部には接続しない。

> 注意: 成分表のSQL(`db/schema.sql`、`db/migration-003-foods.sql`、`db/seed-foods.sql`)は、このリポジトリのスナップショットには含まれていない。下の設定手順は、これらがそろった完全なリポジトリを前提にしている。成分表の全件が要る古いテスト6本(`test/e2e_test.mjs` `test/match_test.mjs` `test/calc_test.mjs` `test/import_test.mjs` `test/settings-ui_test.mjs` `test/error-log-server_test.mjs`)は、これらが無いと動かない。また `test/error-log-client_test.mjs` は、この機能を入れる前から失敗していた。

## 設定手順

### 1. テーブルを用意する
初回は `db/schema.sql`、AI設定を追加するときは `db/migration-002-ai-settings.sql` を適用します。
```
npx wrangler d1 execute recipe-app-db --file=./db/schema.sql --remote
npx wrangler d1 execute recipe-app-db --file=./db/migration-002-ai-settings.sql --remote
```

### 1-2. 成分表のデータを入れる(栄養計算に必要)
AIが返したレシピの栄養量は、日本食品標準成分表(八訂)増補2023年をD1に入れたデータから計算します。**このデータが無いと、栄養量が表示されません**(レシピ自体は表示されます)。

**方法A(ブラウザだけ・おすすめ)**: デプロイ後、アプリの「設定」タブで管理者としてログインすると、「成分表の登録(管理者のみ)」欄が出ます。「成分表を登録する」を押すと、2,538件を100件ずつ自動で登録します(ターミナル不要)。「登録数: 2538 件」と出れば完了です。何度押しても上書きされるだけです。

**方法B(wrangler)**:
```
npx wrangler d1 execute recipe-app-db --file=./db/migration-003-foods.sql --remote
npx wrangler d1 execute recipe-app-db --file=./db/seed-foods.sql --remote
npx wrangler d1 execute recipe-app-db --remote --command "SELECT COUNT(*) FROM foods"   # 2538 と出ればOK
```
成分表が改訂されたら、新しいExcelで `python3 scripts/build_foods_sql.py 食品データ.xlsx` を実行して `data/foods.json` などを作り直し、もう一度取り込みます(反映までに最大10分かかります)。
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
5. エラーログの確認: 管理者でログインし、機内モード(通信オフ)で「レシピを作成する」を押すと、エラー表示の下に「ログをダウンロード」が出て、押すとJSONが保存されることを確認。同じ操作を一般ユーザーで行っても、ボタンが**出ない**ことを確認

## エラーログ(管理者のみ)

管理者でログインしているとき、処理でエラーが起きると、その内容をJSONファイルとしてダウンロードできます。原因の調査(このファイルを共有して相談するなど)に使えます。

- **ボタンの場所**: 「作る」タブのエラー表示の下(エラーが1件以上あるとき)と、「設定」タブの「エラーログ(管理者のみ)」欄(件数の確認・ダウンロード・消去)。一般ユーザーには出ません。
- **記録されるもの**: AIレシピ作成の失敗(リクエスト内容・HTTPステータス・サーバーが返した原因)、管理者用API(接続テスト・AI設定の保存・成分表の登録)の失敗、パスキーのログイン・登録の失敗、保存・削除・一覧取得の失敗、予期しないJavaScriptエラー、スクリプトの読み込み失敗。ユーザー自身によるパスキー操作のキャンセルは記録しません。
- **成功したのに問題があった場合も記録されます**: AIの作り直しの失敗、栄養計算の失敗、目標の±5%に収まらなかった、など(レベル `warn`)。
- **サーバー側の詳細**: AIレシピ作成APIは、管理者のリクエストにだけ、レスポンスの `debug`(どの段階で何が起きたかの時系列。xAIのエラー本文、AIの返答の先頭など)を付けます。管理者用APIは、失敗時に `detail` を返します。管理者かどうかの判定はサーバー側(`ADMIN_USER_ID`)で行うので、一般ユーザーには一切返りません。
- **APIキーは記録されません**: `xai-...` の形や `Bearer ...`、`apiKey` などの名前の項目は `[REDACTED]` に置き換えます。管理者用APIへ送った内容(APIキーを入力して保存した本文など)は、そもそも記録しません。
- **保存先はこの端末のメモリだけ**です。サーバーには送りません。ページを閉じる・再読み込みするとログは消え、ログアウトしたときも消えます(共有の端末にログを残さないため)。
- ファイル名は `recipe-app-log-年月日-時分秒.json` です。

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
