# 所要時間の指定 実装メモ(claude/TIME-LIMIT.md の設計に対する実装結果)

## できたこと
「作る」タブで所要時間(指定なし/10/30/45/60分以内)を選べる。選択はこの端末に記憶(localStorage `recipeRouletteTimeLimitV1`)。
- サーバー: `body.maxMinutes`(10/30/45/60 以外は 400「所要時間の指定が不正です」。利用回数は消費しない)。プロンプトの【必ず守る条件】に1行追加、AIの返答JSONに `minutes` を追加(1〜240の整数のみ採用)。
- 画面: 各品に「目安 約◯分」を表示、保存レシピに `minutes` が残る。目安が上限を超える品があれば注意文を表示(作り直しはしない)。
- **AIの呼び出し回数は増えない**(`MAX_ATTEMPTS`=3、`MAX_AI_CALLS`=4、`recipe-job.js`・`maxTokensFor`・`buildRetryPrompt` は未変更。テストで確認)。

## ★ 手作業が1回必要: index.html の2か所
`index.html` には大きな画像データ(アイコン2つ)が埋め込まれており、丸ごと書き戻すと壊すおそれがあるため、プロジェクト側の `index.html` は変更していません。次の2か所を足してください(足すまで機能は表示されないだけで、ほかの動作は変わりません)。

1. 「3 品数」の `</section>` の直後(`<div class="generate-area">` の前)に追加:
```html
    <section class="panel step">
      <div class="step-head">
        <span class="step-num">4</span>
        <h2>所要時間</h2>
        <span class="step-tag">任意</span>
      </div>
      <p class="input-hint step-lead">全品を同時進行で作って、この時間以内に終わる料理にします。選択はこの端末に記憶されます。</p>
      <div class="count-toggle" id="time-limit-row" role="group" aria-label="所要時間"></div>
    </section>
```
2. `<script src="js/config.js"></script>` の次の行に追加:
```html
<script src="js/time-limit.js"></script>
```
(`index.html` を添付してもらえれば、こちらで反映もできます。)

## 変更・追加したファイル
- 変更: `functions/_lib/recipe-prompt.js`、`js/config.js`(`TIME_LIMIT_OPTIONS`)、`js/create-ai.js`、`package.json`(`test:time`)
- 追加: `js/time-limit.js`、`test/time-prompt_test.mjs`、`test/time-limit_test.mjs`、`test/time-create-ui_test.mjs`
- README は未更新(この文書が代わり)。

## 設計からのずれ(判断済み)
- チップの位置は「品数」の次の独立パネル(4)。
- 要約行(作成ボタンの上)に「所要時間は◯分以内を目安にします。」を追加。
- 超過の判定は画面側(`job.request.maxMinutes`。開き直した復帰でも使える)。
- 見た目の調整CSSは style.css を触らず、実行時に `<style id="time-limit-style">` を差し込む(5列にする指定を含む。見た目がずれたら style.css に移してよい)。

## テスト(すべて外部通信なし。AIは偽物)
`npm run test:time`(= time-prompt / time-limit / time-create-ui)。既存の `taste-prompt_test.mjs`(プロンプト4000文字未満の確認を含む)・`genre-create-ui_test.mjs` も通過。

## 実際のAIでの確認(1回だけ・通常の1回分の利用)
index.html の2か所を足したあと、「30分以内」を選んで1品で1回作成し、(1)結果に「目安 約◯分」が出る (2)成功すれば有料の呼び出しは通常どおり1回だけ、を確認してください。
