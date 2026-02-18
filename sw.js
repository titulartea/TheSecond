const CACHE_NAME = "second-gallery-v1";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/styles.css",
  "/script.js",
  "/manifest.json",
];

// 설치 시 정적 자산 캐시
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// 활성화 시 오래된 캐시 삭제
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// 네트워크 우선, 실패 시 캐시 사용 (Network First)
self.addEventListener("fetch", (event) => {
  // API 요청이나 Cloudinary/Supabase 요청은 캐시하지 않음
  if (
    event.request.url.includes("supabase.co") ||
    event.request.url.includes("cloudinary.com")
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 성공한 응답을 캐시에 저장
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // 네트워크 실패 시 캐시에서 제공
        return caches.match(event.request);
      })
  );
});
