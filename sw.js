/* sw.js — ClearDoc service worker
 *
 * Goal: make the static site + offline regex analyzer work in spotty
 * WiFi (coffee shops, planes). The AI-backed analysis still requires a
 * network, but the entire marketing site, the local analyzer, and the
 * saved/restore/share flows keep working without one.
 *
 * Strategy:
 *   - Install: precache the shell (HTML pages, CSS, JS, SVGs).
 *   - Activate: drop any prior cache version so users always get fresh
 *     assets when they reconnect.
 *   - Fetch:
 *       • navigations (HTML pages)   → network-first, fall back to cache
 *       • same-origin static assets  → cache-first, refresh in background
 *       • cross-origin (CDN, fonts)  → stale-while-revalidate
 *       • /api/*                     → network-only (never cache analysis)
 *
 * Scope: registered from the page root with scope "/", so this SW
 * controls all of cleardoc.app. Cache version is bumped on every
 * install — old caches are pruned in `activate`.
 */

const VERSION = 'v1.0.0';
const STATIC_CACHE = `cleardoc-static-${VERSION}`;
const RUNTIME_CACHE = `cleardoc-runtime-${VERSION}`;
const CDN_CACHE = `cleardoc-cdn-${VERSION}`;

// The shell: every HTML page, the shared CSS/JS, the SVGs. Keep this
// list lean — anything not listed is fetched lazily and runtime-cached.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/analyze.html',
  '/pricing.html',
  '/404.html',
  '/assets/theme.css',
  '/assets/app.js',
  '/assets/favicon.svg',
  '/assets/og-card.svg',
  '/site.webmanifest',
  '/robots.txt',
  '/sitemap.xml',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // addAll is atomic — if any URL fails to fetch, none are cached and
    // the install rejects (which is fine: the SW just won't activate).
    // Some CDNs intermittently 503; we tolerate a single failure by
    // falling back to per-URL adds so the rest of the shell still lands.
    try {
      await cache.addAll(PRECACHE_URLS);
    } catch (err) {
      for (const url of PRECACHE_URLS) {
        try { await cache.add(url); } catch (_) { /* skip — still useful */ }
      }
    }
    // Activate immediately so the new SW controls open pages without a reload.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC_CACHE, RUNTIME_CACHE, CDN_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => keep.has(k) ? null : caches.delete(k)));
    await self.clients.claim();
  })());
});

function isHTMLNavigation(request) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('Accept') || '';
  return request.method === 'GET' && accept.includes('text/html');
}
function isAPIRequest(url) {
  return url.pathname.startsWith('/api/');
}
function isCDNRequest(url) {
  const host = url.hostname;
  return host.endsWith('googleapis.com')
      || host.endsWith('gstatic.com')
      || host.endsWith('cdnjs.cloudflare.com')
      || host.endsWith('unpkg.com');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept non-GET

  const url = new URL(request.url);

  // 1. Never cache API responses — analyzer results must be live.
  if (isAPIRequest(url)) return;

  // 2. HTML navigations: network-first, fall back to cache, then offline.html-style fallback.
  if (isHTMLNavigation(request)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        // Refresh the cache with the live copy (only for same-origin navigations).
        if (url.origin === self.location.origin) {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch (_) {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request) || await cache.match('/') || await cache.match('/index.html');
        if (cached) return cached;
        // No cache + offline → return a minimal offline page so the user
        // sees something useful, not a browser error.
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
          '<style>body{font-family:system-ui;padding:40px;max-width:560px;margin:auto;color:#14120E;background:#EDE7D8;}' +
          'h1{font-size:32px;}a{color:#FF3B00;}</style>' +
          '<h1>You\'re offline.</h1>' +
          '<p>ClearDoc needs a connection the first time you load it so it can cache the site. Reconnect once, then this page will work offline too.</p>' +
          '<p><a href="/">Try again</a> · <a href="/analyze.html">Open the analyzer (cached once visited)</a></p>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // 3. CDN: stale-while-revalidate (instant load, background refresh).
  if (isCDNRequest(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CDN_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request).then((res) => {
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => null);
      return cached || await network || new Response('', { status: 504 });
    })());
    return;
  }

  // 4. Same-origin static assets: cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(request);
      if (cached) {
        // Background refresh — best effort, never throw.
        fetch(request).then((res) => {
          if (res && res.ok) cache.put(request, res.clone());
        }).catch(() => {});
        return cached;
      }
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) cache.put(request, fresh.clone());
        return fresh;
      } catch (_) {
        return new Response('', { status: 504 });
      }
    })());
  }
});

// Allow the page to ask the SW to skip waiting (force-activate on deploy).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
