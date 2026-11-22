// 서비스 워커 — 앱 파일을 캐시해 오프라인에서도 열리게 한다.
// 배포할 때마다 VERSION을 올리면 새 버전이 적용된다.
const VERSION = 'v8';
const FILES = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/db.js', 'js/render.js', 'js/exporter.js', 'js/vendor/mp4-muxer.mjs', 'js/ai.js', 'js/music.js', 'manifest.webmanifest', 'icons/art.webp', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // 네트워크 우선(최신 버전 반영), 실패하면 캐시
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
