このzipは、元のリポジトリと同じフォルダ構成で入っています。
1. zipを展開して、中身をリポジトリの同じ場所に上書きコピーする
2. index.html は含まれていません。js/appliances.js を読み込む行の直前に次の1行を追加する
   <script src="js/manual-text.js"></script>
3. D1で db/migration-008-manual-extract.sql を1回だけ実行する
4. デプロイ後、.mjs ファイルがJavaScriptとして配信されることを確認する
