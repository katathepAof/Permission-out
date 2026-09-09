const CACHE = 'permission-out-v124-route-detail-drawer';
const CORE = ['/', '/mod2/', '/login/', '/production.css?v=20260723-modules', '/production.js?v=20260831-external-calc', '/pea-hierarchy.js?v=20260801-kml-folder-tree', '/admin-users.css?v=20260723-auth-admin', '/admin-users.js?v=20260723-auth-admin', '/admin-data.css?v=20260723-data-versioning', '/admin-data.js?v=20260723-data-versioning', '/ux-refresh.css?v=20260730-multi-report-filter', '/ux-refresh.js?v=20260909-electricity-area-label', '/mod1-dashboard.css?v=20260909-route-detail-drawer', '/mod2.css?v=20260813-kml-fields', '/mod2.js?v=20260831-osm-basemap', '/app-theme.css?v=20260807-thailand-overview', '/app-theme.js?v=20260807-theme-review', '/login.css?v=20260909-mod1-theme', '/login.js?v=20260726-central-login', '/vendor/leaflet.css', '/vendor/leaflet.js', '/vendor/supabase.js', '/manifest.webmanifest', '/logo.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/bootstrap.js') return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    const network = fetch(event.request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(network);
      return cached;
    }

    const finalResponse = await network;
    if (finalResponse) return finalResponse;

    if (event.request.mode === 'navigate') {
      const fallback = await caches.match(
        url.pathname.startsWith('/mod2') ? '/mod2/' : url.pathname.startsWith('/login') ? '/login/' : '/'
      );
      if (fallback) return fallback;
    }

    return Response.error();
  })());
});
