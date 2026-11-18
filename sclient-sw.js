/* S-Client local instance file server. */
const DB_NAME = 'sclient-instances';
const STORE_NAME = 'files';
const ALLOWED_FILES = new Set(['index.html', 'app.js', 'style.css']);

function readStoredFile(key) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) { db.close(); resolve(null); return; }
      const tx = db.transaction(STORE_NAME, 'readonly');
      const get = tx.objectStore(STORE_NAME).get(key);
      get.onsuccess = () => { resolve(typeof get.result === 'string' ? get.result : null); db.close(); };
      get.onerror = () => { reject(get.error || new Error('IndexedDB read failed')); db.close(); };
    };
  });
}

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const prefix = new URL('instance-cache/', self.registration.scope).pathname;
  if (!url.pathname.startsWith(prefix)) return;

  event.respondWith((async () => {
    try {
      const parts = url.pathname.slice(prefix.length).split('/').map(part => decodeURIComponent(part));
      if (parts.length !== 2 || !/^[a-zA-Z0-9_-]{1,100}$/.test(parts[0]) || !ALLOWED_FILES.has(parts[1])) {
        return new Response('Invalid local instance path', { status: 400 });
      }
      const [instanceId, fileName] = parts;
      const content = await readStoredFile(`${instanceId}/${fileName}`);
      if (content === null) return new Response('This instance file is not installed in local storage.', { status: 404 });
      const contentType = fileName.endsWith('.html') ? 'text/html; charset=utf-8'
        : fileName.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8';
      return new Response(content, { status: 200, headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }});
    } catch (error) {
      return new Response(`Could not read this local instance: ${error.message}`, { status: 500 });
    }
  })());
});
