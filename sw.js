/* ============================================================================
 *  AI FITNESS · SERVICE WORKER  (sw.js)
 *  @ By Brice Jct · Alpha OS · Groupe Alpha Nex Strasbourg
 *
 *  Rôle : recevoir les notifications Web Push même quand l'app est FERMÉE,
 *  et les afficher. Gère aussi le clic sur la notification (ouvre/focus l'app).
 *
 *  ⚠️ Volontairement SANS cache de pages (pas de fetch handler) : on évite
 *     ainsi tout problème de version périmée. Le SW se met à jour tout seul
 *     (skipWaiting + clients.claim).
 *
 *  Déploiement : ce fichier DOIT être à la racine du site, à côté de
 *  index.html (ex: https://alphakorner.github.io/ai-fitness/sw.js), pour que
 *  son scope couvre toute l'app.
 * ==========================================================================*/

const SW_VERSION = "ai-fitness-sw-v1";

self.addEventListener("install", (event) => {
  // Active la nouvelle version immédiatement (pas d'attente)
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Prend le contrôle de toutes les pages ouvertes tout de suite
  event.waitUntil(self.clients.claim());
});

// Réception d'une notification push
self.addEventListener("push", (event) => {
  let data = { title: "AI Fitness", body: "", url: "/", icon: "" };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = Object.assign(data, parsed);
    }
  } catch (e) {
    try { data.body = event.data ? event.data.text() : ""; } catch (e2) {}
  }

  // Icône iA inline (jaune/noir) si non fournie
  const icon = data.icon || ("data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#000"/><circle cx="256" cy="256" r="188" fill="none" stroke="#ffec00" stroke-width="16"/><text x="256" y="324" font-family="sans-serif" font-size="200" font-weight="800" fill="#ffec00" text-anchor="middle">iA</text></svg>'
  ));

  const options = {
    body: data.body || "",
    icon: icon,
    badge: icon,
    tag: data.tag || "ai-fitness-push",
    renotify: true,
    vibrate: [120, 60, 120],
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(data.title || "AI Fitness", options));
});

// Clic sur la notification → ouvre/focus l'app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      // Si une fenêtre de l'app est déjà ouverte → on la met au premier plan
      for (const client of clientsArr) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client && targetUrl !== "/") { try { client.navigate(targetUrl); } catch (e) {} }
          return;
        }
      }
      // Sinon on ouvre une nouvelle fenêtre
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
