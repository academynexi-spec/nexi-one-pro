const CACHE = "nexi-one-v4";
const APP_SHELL = [
  "./index.html", "./admin.html", "./eleve.html", "./superviseur.html",
  "./manifest.json",
  "./css/style.css",
  "./js/config.js", "./js/supabaseClient.js", "./js/auth.js", "./js/sync.js",
  "./js/nexibot.js", "./js/gamify.js",
  "./js/admin.js", "./js/eleve.js", "./js/superviseur.js",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./img/hero-bg.jpg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// RESEAU D'ABORD pour tout ce qui vient de ce site (HTML/CSS/JS) : pendant le
// developpement, un ancien fichier mis en cache qui continuerait a s'executer
// silencieusement est plus dangereux qu'un leger cout de latence. Le cache ne
// sert que de secours si le reseau est indisponible (mode hors-ligne).
// Les appels Supabase et les CDN externes ne sont JAMAIS interceptes.
self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  if (url.includes("supabase.co") || url.includes("cdn.jsdelivr.net") || url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com")) return;
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((cached) => cached || caches.match("./index.html")))
  );
});

// =========================================================
// NOTIFICATIONS PUSH : affichage même quand l'application est fermée, et ouverture au clic
// =========================================================
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { titre: "NEXI ONE", corps: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(d.titre || "NEXI ONE", {
    body: d.corps || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: d.tag || undefined,            // une même notification ne s'affiche pas deux fois
    renotify: false,
    vibrate: [120, 60, 120],
    data: { url: d.url || "./eleve.html" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "./eleve.html", self.registration.scope).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
      for (const f of fenetres) { if ("focus" in f) return f.focus(); }   // l'appli est déjà ouverte : on la met au premier plan
      return clients.openWindow(url);
    })
  );
});
