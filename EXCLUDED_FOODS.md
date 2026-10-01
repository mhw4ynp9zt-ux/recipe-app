# 使わない食材(ユーザーごとの除外設定)

## 何ができるか
- 「設定」タブ →「レシピの設定」→「使わない食材」で、苦手・避けたい食材を登録できます(ログイン中のみ表示)。
- 登録した食材は、レシピ作成のたびに**自動で**AIへの条件に加わります。検索ごとに入力する必要はありません。
- 追加・削除のたびに自動保存。サーバー(D1)に保存されるので、別の端末でも同じ内容です。
- スペース・「、」区切りでまとめて追加可能。「豚肉」のような大きな分類も登録できます(AIには、全部位も避けるよう指示)。
- 「作る」タブには、登録があるときだけ「使わない食材 N件(…)は自動で除外されます」と表示されます。
- 上限: 30件 / 1件20文字。表記ゆれ(エビ・えび・半角)は同じ食材として重複登録されません。

## デプロイ前に必須: テーブルの追加
```
npx wrangler d1 execute recipe-app-db --file=./db/migration-005-user-settings.sql --remote
```
未実行でもレシピ作成は止まりません(登録なし扱い)が、設定タブでの保存は失敗します。

## 追加・変更したファイル
| ファイル | 内容 |
|---|---|
| db/migration-005-user-settings.sql | 新規。user_settings テーブル |
| functions/_lib/excluded-foods.js | 新規。検証・保存・読み込み・照合 |
| functions/api/user/excluded-foods.js | 新規。GET/PUT(本人のみ。AIは呼ばない) |
| functions/_lib/recipe-prompt.js | プロンプトに【使わない食材】を追加。作り直し依頼文にも反映 |
| functions/_lib/recipe-job.js | 開始時に本人の登録を読む。除外食材が入っていたら作り直し |
| functions/_lib/recipe-job-deps.js | 上記の部品を追加 |
| js/settings.js | 設定欄(HTML・スタイル含む)を組み込み。index.html・style.css は変更なし |
| js/create-ai.js | 除外食材が残ったときの注意表示 |
| test/ | job_fixtures.mjs 更新、excluded-foods_test.mjs 新規、create-ui_job_test.mjs に1件追加 |

## 仕組みと費用
- 登録の読み書き・画面操作ではAIを呼びません。
- 登録内容はジョブ開始時にサーバーが読みます(画面から送った値は無視)。
- AIが除外食材を材料に入れてしまった場合は、目標を外れたときと同じ「作り直し」の対象になります。
  **作り直し回数(MAX_ATTEMPTS=3)・AI呼び出しの絶対上限(MAX_AI_CALLS=4)は変わりません。**
  登録がないユーザーの動作・AI呼び出し数は従来と同じです。
- 上限まで直らなければ、除外食材が入っていない結果を優先して返し、残っていれば画面に注意を出します。
- 照合は名前の一致(カタカナ/ひらがな/全半角を吸収)。「豚肉」と「豚ロース」のような包含関係は照合できないため、AIへの指示が主で、照合は補助です。アレルギー等の重要な用途では材料の目視確認が必要です。

## テスト(実際のAIは一切呼びません)
```
node test/excluded-foods_test.mjs
node test/job_test.mjs
node test/create-ui_job_test.mjs
```
