// 跟課班表系統 — Service Worker（Web Push）
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

// 最小 fetch handler（Chrome 判定「可安裝」需要 SW 有 fetch 事件；此處直接走網路）
self.addEventListener("fetch", function () { /* pass-through */ });

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
