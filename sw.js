const CACHE_NAME = "systan-srs-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"
];

self.addEventListener("install", function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; }).map(function(n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function(e) {
  var url = e.request.url;
  if (url.includes("script.google.com") || url.includes("googleusercontent.com")) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(response) {
        return caches.open(CACHE_NAME).then(function(cache) {
          cache.put(e.request, response.clone());
          return response;
        });
      });
    }).catch(function() {
      return caches.match("./index.html");
    })
  );
});
