// ==== 説明書PDFから、端末(ブラウザ)の中だけで文字を取り出し、関連ページに絞る ====
// PDFはサーバーに送りません。ここで取り出して絞った「文字」だけが、あとで(UI側の操作で)送られます。
// この処理ではAIを呼びません(=費用は発生しません)。pdf.js は呼ばれたときに初めて読み込みます(ページ表示時には読み込みません)。
//
//   ManualText.extractFromFile(file) -> { text, pagesUsed, truncated }
//     失敗は Error で、err.code は too_large | too_many_pages | not_pdf | encrypted | no_text | garbled | read_failed
//     (err.message は画面にそのまま出せる日本語の案内)。サイズとPDFの先頭(%PDF)の確認は、pdf.js を読み込む前に行います。
//   ManualText.selectRelevantPages(pages, maxChars) -> { text, pagesUsed(1始まり), truncated }
//   ManualText.ensureReadableStreamAsyncIterator(RS?) -> boolean(補いを足したら true)
//   ManualText.readableTextRatio(text) -> 0〜1(日本語・英数字・基本記号の割合。文字化けの検知用)
//
// ブラウザでも Node(テストの vm)でも読めるよう、globalThis に ManualText を付けます。
(function () {
  var LIMITS = { maxBytes: 20 * 1024 * 1024, maxPages: 200, maxChars: 30000, minChars: 200 };
  var MANUAL_KEYWORDS = ["モード", "メニュー", "調理", "容量", "温度", "時間", "仕様", "使用上の注意", "最大", "加熱", "圧力", "低温", "自動"];
  var PAGE_SEP = "\n\n";
  // 読める文字の割合がこれ未満なら、文字化けとみなしてAIを呼ばない(正常な日本語PDFは1.0付近、文字化けは0付近。test/manual-text_test.mjs で確認)
  var MIN_READABLE_RATIO = 0.7;
  var HAND_INPUT_HINT = "うまくいかない場合は、「仕様(任意)」の欄に説明書の内容を手で入力できます。";

  function fail(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  // ---- Safari 対策: ReadableStream の for await を使えるようにする ----
  // pdf.js(getTextContent など)は ReadableStream を `for await (const x of stream)` で読むが、
  // Safari には ReadableStream.prototype[Symbol.asyncIterator] が無く、TypeError("undefined is not a function") になる。
  // 無い環境でだけ、getReader() ベースの実装を足す(Chromium・Node など、既にある環境では何もしない)。pdf.js のファイルは改変しない。
  function ensureReadableStreamAsyncIterator(RS) {
    var C = RS || (typeof ReadableStream !== "undefined" ? ReadableStream : undefined);
    if (!C || !C.prototype || typeof Symbol === "undefined" || !Symbol.asyncIterator) return false;
    if (C.prototype[Symbol.asyncIterator]) return false;
    Object.defineProperty(C.prototype, Symbol.asyncIterator, {
      configurable: true,
      writable: true,
      value: function () {
        var reader = this.getReader();
        var finished = false;
        var release = function () { try { reader.releaseLock(); } catch (_) {} };
        var it = {
          next: function () {
            if (finished) return Promise.resolve({ done: true, value: undefined });
            return reader.read().then(function (r) {
              if (r.done) { finished = true; release(); return { done: true, value: undefined }; }
              return { done: false, value: r.value };
            }, function (e) { finished = true; release(); throw e; });
          },
          // for await を途中で抜けたとき(break / throw)に呼ばれる: ストリームを閉じて、ロックを外す
          return: function (value) {
            if (finished) return Promise.resolve({ done: true, value: value });
            finished = true;
            return reader.cancel().then(function () { release(); return { done: true, value: value }; },
              function (e) { release(); throw e; });
          },
        };
        it[Symbol.asyncIterator] = function () { return this; };
        return it;
      },
    });
    return true;
  }

  // 文字化けの検知: 空白を除いた文字のうち、ひらがな・カタカナ・漢字・英数字・基本の記号が占める割合
  function isReadableCode(c) {
    return (c >= 0x21 && c <= 0x7e) ||                        // ASCII(英数字・記号)
      c === 0xb0 || c === 0xb1 || c === 0xd7 || c === 0xf7 ||  // ° ± × ÷
      (c >= 0x2010 && c <= 0x2027) || (c >= 0x2030 && c <= 0x2033) || // 各種ダッシュ・引用符・点・‰ ′ ″
      c === 0x2103 || c === 0x2212 ||                          // ℃ −
      (c >= 0x2190 && c <= 0x2199) ||                          // 矢印
      (c >= 0x25a0 && c <= 0x25ef) ||                          // ■□▲△●○ など
      (c >= 0x2460 && c <= 0x2473) ||                          // ①〜⑳
      (c >= 0x3000 && c <= 0x30ff) ||                          // 和文の記号・ひらがな・カタカナ(・ー を含む)
      (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || // 漢字
      (c >= 0xff01 && c <= 0xff9f);                            // 全角の英数字・記号・半角カナ
  }
  function readableTextRatio(text) {
    var total = 0, good = 0;
    var s = String(text == null ? "" : text);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x3000 || c === 0xa0) continue; // 空白は数えない
      total++;
      if (isReadableCode(c) || (c >= 0xd800 && c <= 0xdfff)) good++; // サロゲート(𠮟など)は漢字とみなす
    }
    return total ? good / total : 0;
  }

  function countKeywords(text) {
    var n = 0;
    for (var i = 0; i < MANUAL_KEYWORDS.length; i++) {
      var kw = MANUAL_KEYWORDS[i], pos = 0, at;
      while ((at = text.indexOf(kw, pos)) !== -1) { n++; pos = at + kw.length; }
    }
    return n;
  }

  // 全ページの合計が maxChars 以下なら全部。超えるときは、キーワードの多いページから(元のページ順で)予算に収まるまで取る。
  // 結合した text の長さ(ページ間の空行を含む)は maxChars を超えません。
  function selectRelevantPages(pages, maxChars) {
    var max = maxChars == null ? LIMITS.maxChars : maxChars;
    var items = [];
    (pages || []).forEach(function (p, i) {
      var t = typeof p === "string" ? p.trim() : "";
      if (t) items.push({ no: i + 1, text: t, score: countKeywords(t) });
    });
    if (!items.length) return { text: "", pagesUsed: [], truncated: false };

    var total = items.reduce(function (s, it) { return s + it.text.length; }, 0) + PAGE_SEP.length * (items.length - 1);
    if (total <= max) {
      return { text: items.map(function (it) { return it.text; }).join(PAGE_SEP), pagesUsed: items.map(function (it) { return it.no; }), truncated: false };
    }

    var order = items.slice();
    if (order.some(function (it) { return it.score > 0; })) {
      order.sort(function (a, b) { return b.score - a.score || a.no - b.no; });
    } // キーワードが全く無ければ、先頭ページから
    var chosen = [], used = 0, truncated = false;
    order.forEach(function (it) {
      var cost = it.text.length + (chosen.length ? PAGE_SEP.length : 0);
      if (used + cost <= max) { chosen.push(it); used += cost; return; }
      if (!chosen.length) { // 1ページだけで予算を超える: そのページを切り詰める
        chosen.push({ no: it.no, text: it.text.slice(0, max) });
        used = max;
      }
      truncated = true;
    });
    chosen.sort(function (a, b) { return a.no - b.no; });
    return { text: chosen.map(function (it) { return it.text; }).join(PAGE_SEP), pagesUsed: chosen.map(function (it) { return it.no; }), truncated: truncated };
  }

  // 既定: 同梱の pdf.js を、呼ばれたときだけ読み込む(外部CDNは使わない)
  // pdf.js を読み込む「前」に、Safari 向けの補いを足す(pdf.js 本体は改変しない)
  function defaultLoadPdfjs() {
    ensureReadableStreamAsyncIterator();
    return import("/js/vendor/pdfjs/pdf.min.mjs").then(function (m) {
      m.GlobalWorkerOptions.workerSrc = "/js/vendor/pdfjs/pdf.worker.min.mjs";
      return m;
    });
  }

  function pageText(content) {
    var out = "";
    (content.items || []).forEach(function (it) {
      if (typeof it.str !== "string") return;
      out += it.str;
      if (it.hasEOL) out += "\n";
    });
    return out;
  }

  function extractFromFile(file, opts) {
    var loadPdfjs = (opts && opts.loadPdfjs) || defaultLoadPdfjs;
    var readFail = function () { return fail("read_failed", "PDFを読み取れませんでした。ファイルが壊れていないか確認して、もう一度お試しください。" + HAND_INPUT_HINT); };

    if (!file || typeof file.size !== "number") return Promise.reject(readFail());
    if (file.size > LIMITS.maxBytes) {
      return Promise.reject(fail("too_large", "PDFのサイズが大きすぎます(20MBまで)。必要なページだけを切り出したPDFでお試しください。"));
    }
    var doc = null, task = null;
    var cleanup = function () {
      // loadingTask の破棄は、開いたPDF(doc)の破棄も含む。失敗時にワーカー側の資源を残さない
      if (task && task.destroy) { try { var p = task.destroy(); if (p && p.catch) p.catch(function () {}); } catch (_) {} }
      if (doc && doc.destroy) { try { var q = doc.destroy(); if (q && q.catch) q.catch(function () {}); } catch (_) {} }
    };
    return file.slice(0, 5).arrayBuffer().then(function (head) {
      var b = new Uint8Array(head);
      if (!(b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46)) { // "%PDF"
        throw fail("not_pdf", "PDFファイルではないようです。説明書のPDFを選んでください。");
      }
      return Promise.all([loadPdfjs().catch(function () { throw readFail(); }), file.arrayBuffer()]);
    }, function (e) { throw e && e.code ? e : readFail(); }).then(function (r) {
      var pdfjs = r[0];
      // 日本語PDFで使われる定義済みCMap(UniJIS-UCS2-H など)を同梱の cmaps から読む(同じ配信元・外部通信なし)
      task = pdfjs.getDocument({ data: new Uint8Array(r[1]), cMapUrl: "/js/vendor/pdfjs/cmaps/", cMapPacked: true });
      return task.promise.catch(function (e) {
        if (e && e.name === "PasswordException") throw fail("encrypted", "パスワード付きのPDFは読み取れません。パスワードを外したPDFでお試しください。");
        if (e && e.name === "InvalidPDFException") throw fail("not_pdf", "PDFファイルではないようです。説明書のPDFを選んでください。");
        throw readFail();
      });
    }).then(function (d) {
      doc = d;
      if (d.numPages > LIMITS.maxPages) {
        throw fail("too_many_pages", "ページ数が多すぎます(200ページまで)。必要なページだけを切り出したPDFでお試しください。");
      }
      var pages = [], chain = Promise.resolve();
      var step = function (i) {
        return function () {
          return d.getPage(i).then(function (page) {
            return page.getTextContent().then(function (c) { pages.push(pageText(c)); }).then(
              function () { page.cleanup(); },
              function (e) { try { page.cleanup(); } catch (_) {} throw e; });
          });
        };
      };
      for (var i = 1; i <= d.numPages; i++) chain = chain.then(step(i));
      return chain.then(function () { return pages; });
    }).then(function (pages) {
      var all = pages.join("").replace(/\s+/g, "");
      if (all.length < LIMITS.minChars) {
        throw fail("no_text", "このPDFから文字を取り出せませんでした(スキャン画像のPDFの可能性があります)。文字を選択できるPDFでお試しください。" + HAND_INPUT_HINT);
      }
      // 文字は取り出せたが、読める文字がほとんど無い(フォントの対応表が無いPDFなどの文字化け)。AIには送らない
      if (readableTextRatio(all) < MIN_READABLE_RATIO) {
        throw fail("garbled", "このPDFは文字を正しく取り出せませんでした。説明書の内容を手で入力してください(「仕様(任意)」の欄に入力できます)。");
      }
      return selectRelevantPages(pages, LIMITS.maxChars);
    }).catch(function (e) {
      throw e && e.code ? e : readFail();
    }).then(function (res) {
      cleanup();
      return res;
    }, function (e) {
      cleanup();
      throw e;
    });
  }

  globalThis.ManualText = {
    LIMITS: LIMITS, MANUAL_KEYWORDS: MANUAL_KEYWORDS, MIN_READABLE_RATIO: MIN_READABLE_RATIO,
    selectRelevantPages: selectRelevantPages, extractFromFile: extractFromFile,
    ensureReadableStreamAsyncIterator: ensureReadableStreamAsyncIterator, readableTextRatio: readableTextRatio,
  };
})();
