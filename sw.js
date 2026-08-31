const CACHE = 'permission-out-v106-external-calc-skip-invalid';
const CORE = ['/', '/mod2/', '/login/', '/production.css?v=20260723-modules', '/production.js?v=20260831-external-calc', '/pea-hierarchy.js?v=20260801-kml-folder-tree', '/admin-users.css?v=20260723-auth-admin', '/admin-users.js?v=20260723-auth-admin', '/admin-data.css?v=20260723-data-versioning', '/admin-data.js?v=20260723-data-versioning', '/ux-refresh.css?v=20260730-multi-report-filter', '/ux-refresh.js?v=20260730-export-feedback', '/mod2.css?v=20260813-kml-fields', '/mod2.js?v=20260831-osm-basemap', '/app-theme.css?v=20260807-thailand-overview', '/app-theme.js?v=20260807-theme-review', '/login.css?v=20260726-central-login', '/login.js?v=20260726-central-login', '/vendor/leaflet.css', '/vendor/leaflet.js', '/vendor/supabase.js', '/manifest.webmanifest', '/logo.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Leave third-party resources to the browser. Intercepting them makes the
  // service worker's fetch subject to connect-src and can turn a failed font
  // request into the HTML navigation fallback.
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname === '/bootstrap.js' ||
    url.pathname.startsWith('/api/')
  ) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);

      if (response.ok) {
        // Clone before the response is returned to the page so its body has
        // not been consumed when Cache Storage starts writing it.
        const cacheCopy = response.clone();
        const cache = await caches.open(CACHE);
        await cache.put(event.request, cacheCopy);
      }

      return response;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      // Only navigations may fall back to the app shell. Returning HTML for
      // CSS, JavaScript, fonts or images causes MIME-type errors.
      if (event.request.mode === 'navigate') {
        const appShell = await caches.match(
          url.pathname.startsWith('/mod2') ? '/mod2/' : url.pathname.startsWith('/login') ? '/login/' : '/'
        );
        if (appShell) return appShell;
      }

      return Response.error();
    }
  })());
});
