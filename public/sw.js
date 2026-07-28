// 跟課班表系統 — Service Worker（離線回退 + Web Push）
// 快取策略刻意保守：只快取靜態資源與離線頁，**不快取任何登入後的 HTML**，
// 避免登出後仍能從快取讀到上一個人的班表／個資。
const CACHE = "schedule-shell-v1";
const SHELL = [
  "/schedule/offline",
  "/schedule-icon.png",
  "/schedule-icon-192.png",
  "/manifest.json",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL);
    }).catch(function () { /* 單一資源失敗不阻擋安裝 */ })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 頁面導覽：一律走網路（資料必須即時），斷網才回退離線頁
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match("/schedule/offline").then(function (r) {
          return r || new Response("目前沒有網路", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        });
      })
    );
    return;
  }

  // 圖示等靜態檔：cache-first，順便補進快取
  if (/\.(png|jpg|jpeg|svg|ico|webp)$/i.test(url.pathname) || url.pathname === "/manifest.json") {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
  }
  // 其餘（API、字型等）不攔截，交給瀏覽器預設行為
});

self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { title: "跟課班表系統", body: event.data ? event.data.text() : "" }; }
  var title = data.title || "跟課班表系統";
  var options = {
    body: data.body || "",
    icon: "/schedule-icon.png",
    badge: "/schedule-icon.png",
    data: { url: data.url || "/schedule/home" },
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/schedule/home";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(url) >= 0 && "focus" in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
