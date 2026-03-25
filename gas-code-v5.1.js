// ========================================
// シス単SRS - GASコード v5.1（修正版）
// 作成日時: 2026-03-25
// バージョン: v5.1-row-based-fixed
// ========================================
// 修正内容:
//   BUG-1 修正: doPost が body.data.words を正しく読むよう変更
//   BUG-2 修正: doPost 書込み後、余剰行をクリアして幽霊データを防止
//   BUG-4 修正: v4 デッドコード完全除去、関数名重複を解消
//   BUG-5 修正: DATA_MAX_ROWS を 2027 → 10000 に拡張
//   BUG-6 修正: settings を SRS_Meta シートに保存・読込
//   BUG-7 修正: v4 残骸（getOrCreateSheet, appendDebugLog 等）を除去
// ========================================

// ========================================
// 定数定義
// ========================================

// スプレッドシートID（デプロイ時に自分のIDに置き換えてください）
var SPREADSHEET_ID = "1940t4GPm8GDZf41fP9R5ga3jg_efxRvfq8wAdl-5us8";

// シート名
var SHEET_NAME_DATA = "SRS_Data_v5"; // v4 との混在を避けるため新シート名を使用
var SHEET_NAME_META = "SRS_Meta";

// 列インデックス（0始まり）
var COL = {
  ID: 0,         // A列: 語番号
  PHRASE: 1,     // B列: 英語フレーズ
  MEANING: 2,    // C列: 日本語訳
  REPETITIONS: 3,// D列: 復習回数
  INTERVAL: 4,   // E列: 復習間隔（日数）
  EASE_FACTOR: 5,// F列: 難易度係数
  NEXT_REVIEW: 6,// G列: 次回復習日
  LAST_REVIEW: 7,// H列: 最終復習日
  LAST_QUALITY: 8,// I列: 最後の判定
  GRADUATED: 9,  // J列: 卒業フラグ
  CREATED: 10,   // K列: 作成日
  RESERVED: 11   // L列: 予備
};

// データ範囲
var DATA_START_ROW = 2;       // データは2行目から
var DATA_MAX_ROWS = 10000;    // ★BUG-5修正: 2027→10000（スケーラビリティ確保）
var DATA_COLS = 12;           // 12列

// ヘッダー行の内容
var HEADER_ROW = [
  "id", "phrase", "meaning", "repetitions", "interval",
  "easeFactor", "nextReviewDate", "lastReviewDate",
  "lastQuality", "graduated", "createdDate", "reserved"
];

// ========================================
// ヘルパー関数
// ========================================

/**
 * スプレッドシートオブジェクトを取得
 * ※ getActiveSpreadsheet() は Web App では動作しないため openById を使用
 */
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * データシートを取得（なければ作成）
 */
function getDataSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_DATA);

  if (!sheet) {
    // 新規シート作成
    sheet = ss.insertSheet(SHEET_NAME_DATA);
    // ヘッダー行を設定
    sheet.getRange(1, 1, 1, DATA_COLS).setValues([HEADER_ROW]);
    // ヘッダー行を固定
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * メタデータシートを取得（なければ作成）
 * A1: タイムスタンプ
 * B1: 最後のrequestID
 * C1: settings JSON（★BUG-6修正: settingsの永続化）
 */
function getMetaSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_META);

  if (!sheet) {
    // 新規シート作成
    sheet = ss.insertSheet(SHEET_NAME_META);
    sheet.getRange("A1").setValue(Date.now()); // 初期タイムスタンプ
    sheet.getRange("B1").setValue("");         // requestID
    sheet.getRange("C1").setValue("");         // settings JSON
  }

  return sheet;
}

/**
 * タイムスタンプを取得（読み取り専用。更新はしない）
 */
function getTimestamp() {
  var metaSheet = getMetaSheet();
  var ts = metaSheet.getRange("A1").getValue();
  return ts || Date.now();
}

/**
 * タイムスタンプを設定（書き込み時のみ呼ぶ）
 */
function setTimestamp(timestamp) {
  var metaSheet = getMetaSheet();
  metaSheet.getRange("A1").setValue(timestamp);
}

/**
 * 最後のrequestIDを設定（デバッグ用）
 */
function setLastRequestId(requestId) {
  var metaSheet = getMetaSheet();
  metaSheet.getRange("B1").setValue(requestId || "");
}

/**
 * settings を Meta シートに保存（★BUG-6修正）
 */
function saveSettings(settings) {
  if (!settings) return;
  var metaSheet = getMetaSheet();
  // gasUrl は保存しない（セキュリティ＋Safari問題回避）
  var toSave = {
    dailyLimit: settings.dailyLimit || 50,
    graduationDays: settings.graduationDays || 30
  };
  metaSheet.getRange("C1").setValue(JSON.stringify(toSave));
}

/**
 * settings を Meta シートから読み込み（★BUG-6修正）
 */
function loadSettings() {
  var metaSheet = getMetaSheet();
  var raw = metaSheet.getRange("C1").getValue();
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      // パース失敗時はデフォルト値
    }
  }
  return { dailyLimit: 50, graduationDays: 30 };
}

/**
 * JSONレスポンスを返す（★BUG-4修正: 関数名重複を解消、1つだけに統合）
 */
function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ========================================
// データ変換関数
// ========================================

/**
 * Wordオブジェクトを行配列に変換
 * @param {Object} word - 単語オブジェクト
 * @return {Array} - 行配列（12要素）
 */
function wordToRow(word) {
  return [
    word.id || 0,                                    // A: id（数値）
    word.phrase || "",                               // B: phrase（文字列）
    word.meaning || "",                              // C: meaning（文字列）
    word.repetitions || 0,                           // D: repetitions（数値）
    word.interval || 0,                              // E: interval（数値）
    Number(word.easeFactor) || 2.5,                  // F: easeFactor（数値）
    formatDate(word.nextReviewDate) || "",           // G: nextReviewDate（YYYYMMDD）
    formatDate(word.lastReviewDate) || "",           // H: lastReviewDate（YYYYMMDD）
    word.lastQuality || "",                          // I: lastQuality（文字列）
    word.graduated ? 1 : 0,                          // J: graduated（0/1）
    formatDate(word.createdDate) || "",              // K: createdDate（YYYYMMDD）
    ""                                               // L: 予備
  ];
}

/**
 * 行配列をWordオブジェクトに変換
 * @param {Array} row - 行配列（12要素）
 * @return {Object} - 単語オブジェクト
 */
function rowToWord(row) {
  return {
    id: row[COL.ID] || 0,
    phrase: row[COL.PHRASE] || "",
    meaning: row[COL.MEANING] || "",
    repetitions: row[COL.REPETITIONS] || 0,
    interval: row[COL.INTERVAL] || 0,
    easeFactor: Number(row[COL.EASE_FACTOR]) || 2.5,
    nextReviewDate: parseDate(row[COL.NEXT_REVIEW]) || "",
    lastReviewDate: parseDate(row[COL.LAST_REVIEW]) || "",
    lastQuality: row[COL.LAST_QUALITY] || "",
    graduated: row[COL.GRADUATED] == 1,
    createdDate: parseDate(row[COL.CREATED]) || ""
  };
}

/**
 * 日付文字列をYYYYMMDD形式に変換（シート保存用）
 */
function formatDate(dateStr) {
  if (!dateStr) return "";
  dateStr = String(dateStr);
  if (/^\d{8}$/.test(dateStr)) return dateStr;                       // すでにYYYYMMDD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr.replace(/-/g, ""); // YYYY-MM-DD→YYYYMMDD
  return "";
}

/**
 * YYYYMMDD形式をYYYY-MM-DD形式に変換（アプリ側で使う形式）
 */
function parseDate(dateStr) {
  if (!dateStr) return "";
  dateStr = String(dateStr);
  if (/^\d{8}$/.test(dateStr)) {
    return dateStr.substring(0, 4) + "-" +
           dateStr.substring(4, 6) + "-" +
           dateStr.substring(6, 8);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return "";
}

// ========================================
// doGet: データ読み込み（タイムスタンプ更新なし）
// ========================================
function doGet(e) {
  try {
    var sheet = getDataSheet();

    // 全データ行を取得
    var lastRow = sheet.getLastRow();
    var numRows = Math.max(1, lastRow - 1); // ヘッダー除く
    var range = sheet.getRange(DATA_START_ROW, 1, numRows, DATA_COLS);
    var values = range.getValues();

    // 行データをWordオブジェクトに変換
    var words = {};
    values.forEach(function(row) {
      var id = row[COL.ID];
      if (id) { // IDが存在する行のみ処理
        words[id] = rowToWord(row);
      }
    });

    // タイムスタンプ取得（読むだけ。更新しない）
    var timestamp = getTimestamp();

    // settings を読み込み（★BUG-6修正）
    var settings = loadSettings();

    // デバッグ用: requestId 記録
    if (e && e.parameter && e.parameter.requestId) {
      setLastRequestId(e.parameter.requestId);
    }

    // レスポンス
    return createJsonResponse({
      status: "ok",
      data: {
        words: words,
        settings: settings
      },
      timestamp: timestamp
    });

  } catch (error) {
    return createJsonResponse({
      status: "error",
      error: error.toString(),
      stack: error.stack
    });
  }
}

// ========================================
// doPost: データ書き込み
// ========================================
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var sheet = getDataSheet();

    // ★BUG-1修正: body.data.words を読む（フロントは body.data にネストして送信する）
    var wordsData = (body.data && body.data.words) ? body.data.words : body.words;
    var settingsData = (body.data && body.data.settings) ? body.data.settings : body.settings;

    // words が取得できなかった場合はエラー
    if (!wordsData || typeof wordsData !== "object") {
      return createJsonResponse({
        status: "error",
        message: "wordsデータが見つかりません。body.data.words または body.words が必要です。"
      });
    }

    // タイムスタンプチェック（競合検出）
    var currentTimestamp = getTimestamp();
    if (body.timestamp && body.timestamp < currentTimestamp) {
      return createJsonResponse({
        status: "conflict",
        message: "別の端末で更新があります",
        currentTimestamp: currentTimestamp
      });
    }

    // Wordオブジェクトを行配列に変換（IDでソート）
    var rows = [];
    var ids = Object.keys(wordsData).sort(function(a, b) {
      return Number(a) - Number(b);
    });

    ids.forEach(function(id) {
      rows.push(wordToRow(wordsData[id]));
    });

    // データ書き込み
    if (rows.length > 0) {
      var targetRange = sheet.getRange(
        DATA_START_ROW,
        1,
        rows.length,
        DATA_COLS
      );
      targetRange.setValues(rows);
    }

    // ★BUG-2修正: 書き込んだ行の後ろにある古いデータをクリア
    var lastRow = sheet.getLastRow();
    var newLastDataRow = DATA_START_ROW + rows.length - 1; // 新しいデータの最終行
    if (lastRow > newLastDataRow) {
      // 余剰行のデータをクリア（行自体は削除しない＝安全策）
      var excessRows = lastRow - newLastDataRow;
      sheet.getRange(newLastDataRow + 1, 1, excessRows, DATA_COLS).clearContent();
    }

    // settings を保存（★BUG-6修正）
    if (settingsData) {
      saveSettings(settingsData);
    }

    // 新しいタイムスタンプを設定
    var newTimestamp = Date.now();
    setTimestamp(newTimestamp);

    // デバッグ用: requestId 記録
    if (body.requestId) {
      setLastRequestId(body.requestId);
    }

    // レスポンス
    return createJsonResponse({
      status: "ok",
      timestamp: newTimestamp,
      rowsWritten: rows.length
    });

  } catch (error) {
    return createJsonResponse({
      status: "error",
      error: error.toString(),
      stack: error.stack
    });
  }
}

// ========================================
// テスト関数（GASエディタから実行可能）
// ========================================

/**
 * doGetのテスト
 */
function testDoGet() {
  var result = doGet({});
  Logger.log(result.getContent());
}

/**
 * doPostのテスト
 */
function testDoPost() {
  // ★BUG-1修正テスト: body.data.words 形式で送信
  var testData = {
    timestamp: Date.now(),
    data: {
      words: {
        "17": {
          id: 17,
          phrase: "require more attention",
          meaning: "もっと注意を必要とする",
          repetitions: 1,
          interval: 1,
          easeFactor: 2.5,
          nextReviewDate: "2026-03-24",
          lastReviewDate: "2026-03-23",
          lastQuality: "correct",
          graduated: false,
          createdDate: "2026-03-22"
        }
      },
      settings: {
        dailyLimit: 50,
        graduationDays: 30
      }
    },
    requestId: "test_" + Date.now()
  };

  var e = {
    postData: {
      contents: JSON.stringify(testData)
    }
  };

  var result = doPost(e);
  Logger.log(result.getContent());
}

/**
 * 移行前チェック（旧v4データの確認用）
 */
function checkDataStatus() {
  var ss = getSpreadsheet();

  // v5 シート確認
  var sheet = ss.getSheetByName(SHEET_NAME_DATA);
  if (sheet) {
    var lastRow = sheet.getLastRow();
    Logger.log("========================================");
    Logger.log("データ状態チェック");
    Logger.log("========================================");
    Logger.log("シート名: " + SHEET_NAME_DATA);
    Logger.log("データ行数: " + (lastRow - 1) + "行");
    Logger.log("タイムスタンプ: " + getTimestamp());
    Logger.log("settings: " + JSON.stringify(loadSettings()));
    Logger.log("========================================");
  } else {
    Logger.log("シート '" + SHEET_NAME_DATA + "' が見つかりません（初回実行時に自動作成されます）");
  }
}
