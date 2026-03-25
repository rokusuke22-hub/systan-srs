// ========================================
// キャッシュ強制クリア用 sw.js（一時利用）
// 作成日時: 2026-03-25
// 目的: 古いService Workerキャッシュを完全に破棄し、
//       新しいファイルを強制的に読み込ませる
// ========================================
// ★★★ このファイルは一時的なものです ★★★
// 全端末でキャッシュクリアが確認できたら、
// 本番用 sw.js に差し替えてください。
// ========================================

// install: 即座にアクティブ化（待機なし）
self.addEventListener("install", function(e) {
  // skipWaiting で古い SW を即座に置き換える
  self.skipWaiting();
});

// activate: 全キャッシュを削除
self.addEventListener("activate", function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      console.log("[SW NUKE] 削除対象キャッシュ:", names);
      return Promise.all(
        names.map(function(name) {
          console.log("[SW NUKE] 削除:", name);
          return caches.delete(name);
        })
      );
    }).then(function() {
      console.log("[SW NUKE] 全キャッシュ削除完了");
      // 全クライアント（タブ）にコントロールを取得
      return self.clients.claim();
    })
  );
});

// fetch: キャッシュを一切使わず、常にネットワークから取得
self.addEventListener("fetch", function(e) {
  // GAS通信はそのまま通す
  var url = e.request.url;
  if (url.includes("script.google.com") || url.includes("googleusercontent.com")) {
    return;
  }
  // 常にネットワークからフェッチ（キャッシュ不使用）
  e.respondWith(
    fetch(e.request).catch(function() {
      // オフライン時のみフォールバック
      return new Response("オフラインです。ネットワーク接続を確認してください。", {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    })
  );
});
