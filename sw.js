const VERSION = 'v6';
const CACHE = `musaudio-${VERSION}`;
const ASSETS = [
  // Relative to the SW scope (musaudio/)
  'index.html',
  'styles.css',
  'app.js',
  'decoder.js',
  'audio-worklet.js',
  'manifest.webmanifest',
  'img/Musaudio.png',
  'img/favicon/favicon-16x16.png',
  'img/favicon/favicon-32x32.png',
  'img/favicon/favicon.ico',
  'vendor/ffmpeg/ffmpeg.min.js'
];

const IMG_CACHE = `${CACHE}-img`;
const MAX_IMAGE_ENTRIES = 40; // LRU cap for image/background cache

async function pruneImageCache(){
  try{
    const cache = await caches.open(IMG_CACHE);
    const keys = await cache.keys();
    if (keys.length <= MAX_IMAGE_ENTRIES) return;
    // Delete oldest first (Cache keys are roughly insertion-ordered)
    const toDelete = keys.length - MAX_IMAGE_ENTRIES;
    for (let i = 0; i < toDelete; i++){
      await cache.delete(keys[i]).catch(()=>{});
    }
  }catch{}
}

self.addEventListener('install', (e)=>{
  e.waitUntil((async()=>{
    const cache = await caches.open(CACHE);
    try{
      await cache.addAll(ASSETS.map(u=> new Request(u, { cache:'reload' })));
    }catch(err){
      // Ignore individual failures so SW still installs
      console.warn('SW install: some assets failed to cache', err);
    }
  })());
});

self.addEventListener('activate', (e)=>{
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=> !k.startsWith(CACHE)).map(k=> caches.delete(k)));
  })());
});

self.addEventListener('fetch', (e)=>{
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // only handle same-origin
  // Ignore known non-HTTP assets and dev websocket
  if (url.pathname.endsWith('.map')) return;
  if (url.pathname.endsWith('/ws')) return;
  // Workaround: Chrome may throw on only-if-cached with mode not same-origin
  if (e.request.cache === 'only-if-cached' && e.request.mode !== 'same-origin') return;

  // Strategy selection
  const pathname = url.pathname;
  const ext = pathname.split('.').pop();

  // 1) Navigations (HTML): network-first with cache fallback for offline
  if (e.request.mode === 'navigate' || ext === 'html' || pathname === '/' || pathname.endsWith('/index.html')){
    e.respondWith((async()=>{
      try{
        const fresh = await fetch(e.request, { cache:'reload' });
        const appCache = await caches.open(CACHE);
        try{ await appCache.put('index.html', fresh.clone()); }catch{}
        return fresh;
      }catch{
        const appCache = await caches.open(CACHE);
        const cached = await appCache.match('index.html', { ignoreSearch:true });
        if (cached) return cached;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // 2) CSS/JS/JSON: stale-while-revalidate
  if (['css','js','json','webmanifest','wasm'].includes(ext)){
    e.respondWith((async()=>{
      const appCache = await caches.open(CACHE);
      const cached = await appCache.match(e.request, { ignoreSearch:true });
      const fetchPromise = fetch(e.request).then(async(res)=>{
        if (res && res.ok){ try{ await appCache.put(e.request, res.clone()); }catch{} }
        return res;
      }).catch(()=> null);
      return cached || (await fetchPromise) || new Response('Offline asset', { status: 503 });
    })());
    return;
  }

  // 3) Images (including backgrounds): cache-first with LRU prune
  const isImageExt = ['png','jpg','jpeg','webp','gif','svg'].includes(ext);
  const isImagePath = pathname.includes('/img/'); // robust across subpaths (e.g., /app/img/...)
  if (isImagePath && isImageExt){
    e.respondWith((async()=>{
      const imgCache = await caches.open(IMG_CACHE);
      const cached = await imgCache.match(e.request, { ignoreSearch:true });
      if (cached) return cached;
      try{
        const res = await fetch(e.request);
        if (e.request.method==='GET' && res && res.ok){
          try{ await imgCache.put(e.request, res.clone()); }catch{}
          pruneImageCache();
        }
        return res;
      }catch{
        // Fallback to app cache by path
        const appCache = await caches.open(CACHE);
        const byPath = await appCache.match(pathname, { ignoreSearch:true });
        if (byPath) return byPath;
        return new Response('Image unavailable', { status: 404 });
      }
    })());
    return;
  }

  // 4) Media/audio: prefer network, avoid caching large media
  if (['mp3','m4a','aac','flac','wav','ogg','oga','ec3','ac4','dts'].includes(ext)){
    e.respondWith(fetch(e.request));
    return;
  }

  // 5) Default: try cache, then network, and backfill cache
  e.respondWith((async()=>{
    const appCache = await caches.open(CACHE);
    const cached = await appCache.match(e.request, { ignoreSearch:true });
    if (cached) return cached;
    try{
      const res = await fetch(e.request);
      if (e.request.method==='GET' && res && res.ok){
        try{ await appCache.put(e.request, res.clone()); }catch{}
      }
      return res;
    }catch{
      return new Response('Offline or fetch failed', { status: 504, statusText: 'Gateway Timeout' });
    }
  })());
});

// Allow page to trigger immediate activation
self.addEventListener('message', (event)=>{
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
