// S-Client launcher layer: Modrinth-style Library (instances) + Mods download page.
// S-Client supports the released Aquavoid 1.0 and 1.01 builds.
const MAX_INSTANCES = 3;
const SUPPORTED_VERSIONS = ['1.0', '1.01'];
// Game versions are hosted in this repo's GitHub Pages root: /game-versions/Aquavoid-<version>/
const VERSION_FILES = ['index.html', 'app.js', 'style.css'];
const INSTANCE_CACHE_REVISION = 'sclient-auth-redirect-2026-11-18-r3';
const versionFolder = v => `game-versions/Aquavoid-${v}/`;
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let instances = [];
let activeInstanceId = null;
let pendingLaunchInstanceId = null;
const PENDING_LAUNCH_KEY = 'sclient.pendingAquavoidLaunch';
let installing = false;
let modInstanceId = null; // instance whose mods the Mods tab is showing
let lastTick = Date.now();
let unsavedSeconds = 0;

function setPendingLaunchInstance(id) {
  pendingLaunchInstanceId = id || null;
  try {
    if (pendingLaunchInstanceId) sessionStorage.setItem(PENDING_LAUNCH_KEY, pendingLaunchInstanceId);
    else sessionStorage.removeItem(PENDING_LAUNCH_KEY);
  } catch (error) {
    console.info('Could not persist the pending Aquavoid launch for a sign-in redirect.', error);
  }
}


function toast(message) {
  const region = $('toastRegion');
  if (!region) return;
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  region.appendChild(node);
  setTimeout(() => node.remove(), 3000);
}


// ---- Local file store (IndexedDB): each instance keeps its own downloaded copy of the game files ----
let dbPromise = null;
function openDb() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('sclient-instances', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const out = fn(tx.objectStore('files'));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const putFile = (id, name, text) => idb('readwrite', s => s.put(text, `${id}/${name}`));
const getFile = (id, name) => idb('readonly', s => s.get(`${id}/${name}`));
const deleteFiles = id => idb('readwrite', s => [...VERSION_FILES, '_revision'].forEach(n => s.delete(`${id}/${n}`)));

// Serve each installed build from its own IndexedDB copy through a same-origin
// service-worker URL. This preserves Firebase's origin while actually using the
// files downloaded for the selected instance.
let instanceCacheRegistration = null;
async function ensureInstanceCache() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    if (!instanceCacheRegistration) {
      const workerUrl = new URL('sclient-sw.js', document.baseURI);
      const scopeUrl = new URL('./', document.baseURI);
      instanceCacheRegistration = await navigator.serviceWorker.register(workerUrl.href, { scope: scopeUrl.pathname });
    }
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve();
        };
        const timeout = setTimeout(finish, 1800);
        navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true });
        // Close the narrow race where the first controllerchange happened
        // between the initial check and listener registration.
        if (navigator.serviceWorker.controller) finish();
      });
    }
    return !!navigator.serviceWorker.controller;
  } catch (error) {
    console.warn('Local instance cache is unavailable; using the hosted game files.', error);
    return false;
  }
}

async function downloadVersion(version, id, onProgress) {
  const base = versionFolder(version);
  for (let i = 0; i < VERSION_FILES.length; i++) {
    const name = VERSION_FILES[i];
    onProgress?.(`Downloading ${name}…`, Math.round((i / VERSION_FILES.length) * 85));
    const res = await fetch(base + name, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const text = await res.text();
    if (!text.trim()) throw new Error(`${name} is empty`);
    await putFile(id, name, text);
  }
  onProgress?.('Verifying files…', 92);
  for (const name of VERSION_FILES) if (!(await getFile(id, name))) throw new Error(`${name} failed to save`);
  await putFile(id, '_revision', INSTANCE_CACHE_REVISION);
}

// ---- Launching: build the game page from the downloaded files and run it in the Game tab ----
let frameUrls = [];
function clearFrame() {
  window.SClientMods?.stopInstance?.();
  const wrap = $('instanceFrameWrap');
  if (document.fullscreenElement === wrap) {
    document.exitFullscreen?.().catch?.(() => {});
    navigator.keyboard?.unlock?.();
  }
  wrap.innerHTML = '';
  frameUrls.forEach(u => URL.revokeObjectURL(u));
  frameUrls = [];
}
async function instanceHasBetterESC(inst) {
  try {
    const records = await window.SClientCloud?.loadInstanceMods?.(inst.id);
    if (!Array.isArray(records)) return false;
    return records.some(record => {
      const manifest = record?.manifest;
      const versions = Array.isArray(manifest?.gameVersions) ? manifest.gameVersions.map(String) : [String(manifest?.gameVersion || '')];
      return record?.enabled === true
        && manifest?.permissions?.includes('input.cursorUnlock')
        && (!versions.filter(Boolean).length || versions.includes(String(inst.version)));
    });
  } catch (error) {
    console.warn('BetterESC could not read this instance mod profile:', error);
    return false;
  }
}

function installBetterESCOnFrame(frame) {
  const attach = () => {
    try {
      const gameDocument = frame.contentDocument;
      if (!gameDocument || gameDocument.__betterEscInstalled) return;
      gameDocument.__betterEscInstalled = true;
      // Keep track of the most recent pointer-lock state because Chromium may
      // dispatch pointerlockchange before the Escape keydown reaches the page.
      let pointerWasLocked = !!gameDocument.pointerLockElement;
      gameDocument.addEventListener('pointerlockchange', () => {
        if (gameDocument.pointerLockElement) pointerWasLocked = true;
      }, true);
      gameDocument.addEventListener('keydown', event => {
        if (event.code !== 'Escape' || (!gameDocument.pointerLockElement && !pointerWasLocked)) return;
        pointerWasLocked = false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        try { gameDocument.exitPointerLock?.(); } catch (error) { console.debug('BetterESC cursor unlock:', error); }
      }, true);
    } catch (error) {
      console.warn('BetterESC could not attach to the Aquavoid game frame:', error);
    }
  };
  frame.addEventListener('load', attach);
  // Cached same-origin pages may already be complete by the time the listener
  // is registered; attach in that case too.
  if (frame.contentDocument?.readyState === 'complete') attach();
}

async function mountInstance(inst) {
  clearFrame();

  // Ensure a complete installed copy exists before launching. The service
  // worker serves it under this site's origin (unlike Blob/srcdoc URLs), so
  // Firebase Auth and relative app/style paths continue to work.
  let cacheReady = await ensureInstanceCache();
  let filesReady = false;
  // IndexedDB requests are asynchronous; verify them before choosing the URL.
  try {
    const [storedFiles, revision] = await Promise.all([
      Promise.all(VERSION_FILES.map(name => getFile(inst.id, name))),
      getFile(inst.id, '_revision')
    ]);
    filesReady = storedFiles.every(value => typeof value === 'string' && value.trim())
      && revision === INSTANCE_CACHE_REVISION;
  } catch (_) { filesReady = false; }
  if (!filesReady) {
    await downloadVersion(inst.version, inst.id, (label, percent) => {
      const step = $('installStep'), amount = $('installPercent'), bar = $('installBar');
      if (step) step.textContent = `Preparing launch: ${label}`;
      if (amount) amount.textContent = `${percent}%`;
      if (bar) bar.style.width = `${percent}%`;
    });
    cacheReady = await ensureInstanceCache();
  }

  const gameUrl = cacheReady
    ? new URL(`instance-cache/${encodeURIComponent(inst.id)}/index.html`, document.baseURI)
    : new URL(versionFolder(inst.version) + 'index.html', document.baseURI);
  gameUrl.searchParams.set('sclientInstance', inst.id);
  gameUrl.searchParams.set('sclientVersion', inst.version);
  const betterESCEnabled = await instanceHasBetterESC(inst);

  const frame = document.createElement('iframe');
  frame.title = inst.name;
  frame.allow = 'fullscreen; autoplay; clipboard-write';
  if (betterESCEnabled) installBetterESCOnFrame(frame);
  frame.addEventListener('load', async () => {
    try {
      const result = await window.SClientMods?.startInstance?.(inst.id, frame.contentWindow, inst.version);
      if (result?.ok === false) toast(result.message || 'Mods could not be applied to this instance.');
    } catch (error) {
      console.error('Could not initialize this instance mod session:', error);
      toast('The game started, but its mod profile could not be applied.');
    }
  });
  frame.src = gameUrl.href;
  const wrap = $('instanceFrameWrap');
  wrap.appendChild(frame);

  // Fullscreen is controlled by the top-level S-Client document so the
  // Keyboard Lock API can keep Escape from dismissing the game fullscreen.
  const fullscreenButton = document.createElement('button');
  fullscreenButton.type = 'button';
  fullscreenButton.className = 'instance-fullscreen-button';
  fullscreenButton.textContent = '⛶';
  fullscreenButton.title = 'Enter fullscreen (Escape stays in the game)';
  fullscreenButton.setAttribute('aria-label', 'Enter fullscreen');
  fullscreenButton.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === wrap) {
        await document.exitFullscreen();
        navigator.keyboard?.unlock?.();
      } else {
        await wrap.requestFullscreen({ navigationUI: 'hide' });
        if (typeof navigator.keyboard?.lock === 'function') {
          try {
            await navigator.keyboard.lock(['Escape']);
          } catch (lockError) {
            console.info('Keyboard Lock was refused; Escape may exit fullscreen.', lockError);
            toast('Fullscreen started, but the browser refused to lock Escape.');
          }
        } else {
          toast('Fullscreen started, but this browser cannot lock Escape. Use the on-screen exit button.');
        }
        frame.contentWindow?.focus?.();
      }
    } catch (error) {
      console.error('Could not change game fullscreen:', error);
      toast('Fullscreen was blocked by the browser. Try clicking again.');
    }
  });
  wrap.appendChild(fullscreenButton);
}


// ---- Per-instance mods: pick which instance the Mods tab manages ----
function setModInstance(id, notify = true) {
  modInstanceId = id && instances.some(i => i.id === id) ? id : null;
  const selected = instances.find(i => i.id === modInstanceId);
  window.__sclientModInstance = modInstanceId;
  window.__sclientModVersion = selected?.version || null;
  if (notify) window.dispatchEvent(new CustomEvent('sclient:mod-instance', { detail: { id: modInstanceId, version: selected?.version || null } }));
  renderModBar();
}
function renderModBar() {
  let bar = $('modInstanceBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'modInstanceBar';
    bar.className = 'mod-instance-bar';
    $('view-instancemods').prepend(bar);
    bar.addEventListener('change', e => { if (e.target.id === 'modInstanceSelect') setModInstance(e.target.value); });
  }
  if (!instances.length) {
    bar.innerHTML = '<span class="mod-bar-label">MODS ARE PER INSTANCE</span><span class="mod-bar-hint">Install Aquavoid from Discover first, then add mods to that instance.</span>';
  } else {
    bar.innerHTML = `<span class="mod-bar-label">MODS FOR INSTANCE</span><select id="modInstanceSelect" class="mod-bar-select">${instances.map(i => `<option value="${esc(i.id)}" ${i.id === modInstanceId ? 'selected' : ''}>${esc(i.name)} · ${esc(i.version)}</option>`).join('')}</select><span class="mod-bar-hint">Each instance has its own mod library, enabled mods and settings.</span>`;
  }
  const imp = $('importModButton');
  if (imp) imp.disabled = !modInstanceId;
}

// ---- Mods tab: a download page. Mods are hosted in /mods/ and installed into one instance ----
let modIndexPromise = null;
const installedIdsByInstance = {};
const installedVersionsByInstance = {};
function loadModIndex() {
  if (!modIndexPromise) modIndexPromise = fetch('mods/index.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(d => Array.isArray(d.mods) ? d.mods : []);
  return modIndexPromise;
}
async function refreshInstalledIds(instanceId) {
  if (!instanceId || !window.SClientCloud) return [];
  try {
    const stored = await window.SClientCloud.loadInstanceMods(instanceId);
    installedIdsByInstance[instanceId] = stored.map(m => m?.manifest?.id).filter(Boolean);
    installedVersionsByInstance[instanceId] = Object.fromEntries(stored
      .filter(m => m?.manifest?.id)
      .map(m => [String(m.manifest.id), String(m.manifest.version || '')]));
  } catch (_) {
    installedIdsByInstance[instanceId] = installedIdsByInstance[instanceId] || [];
    installedVersionsByInstance[instanceId] = installedVersionsByInstance[instanceId] || {};
  }
  return installedIdsByInstance[instanceId];
}
async function renderModCatalogue() {
  const root = $('modCatalogue');
  let mods;
  try { mods = await loadModIndex(); }
  catch (err) {
    root.innerHTML = '<div class="empty-state"><div class="empty-icon">◇</div><h3>Could not load the mod list</h3><p>Check your connection and reload the page.</p></div>';
    return;
  }
  $('modsTag').textContent = `${mods.length} MOD${mods.length === 1 ? '' : 'S'}`;
  if (!instances.length) {
    root.innerHTML = '<div class="empty-state"><div class="empty-icon">▦</div><h3>Create an instance first</h3><p>Mods are installed into an instance. Create one in your Library, then come back to download mods.</p><button class="outline-button" type="button" data-goto="library">OPEN LIBRARY</button></div>';
    return;
  }
  const selected = root.dataset.instance && instances.some(i => i.id === root.dataset.instance) ? root.dataset.instance : (modInstanceId || instances[0].id);
  root.dataset.instance = selected;
  // Refresh this instance's installed versions so catalogue updates remain visible
  // even when a mod was imported from the private library in another tab.
  const have = await refreshInstalledIds(selected);
  root.innerHTML = `
    <div class="mod-instance-bar"><span class="mod-bar-label">INSTALL INTO</span>
      <select id="catalogueInstance" class="mod-bar-select">${instances.map(i => `<option value="${esc(i.id)}" ${i.id === selected ? 'selected' : ''}>${esc(i.name)} · ${esc(i.version)}</option>`).join('')}</select>
      <span class="mod-bar-hint">Manage installed mods from a Library card (MODS).</span></div>
    <div class="catalogue-grid">${mods.map(m => {
      const done = have.includes(m.id);
      const installedVersion = installedVersionsByInstance[selected]?.[m.id] || '';
      const updateAvailable = done && !!installedVersion && installedVersion !== String(m.version || '');
      const compatibleVersions = Array.isArray(m.gameVersions) && m.gameVersions.length ? m.gameVersions.map(String) : (m.gameVersion ? [String(m.gameVersion)] : []);
      const compatible = !compatibleVersions.length || compatibleVersions.includes(String(instances.find(i => i.id === selected)?.version || ''));
      const versionsLabel = compatibleVersions.length ? compatibleVersions.join(' / ') : String(m.gameVersion || '?');
      const actionLabel = !compatible ? `NOT FOR ${instances.find(i => i.id === selected)?.version || 'THIS VERSION'}` : updateAvailable ? '↻ UPDATE' : done ? '✓ INSTALLED' : '⬇ DOWNLOAD';
      return `<article class="catalogue-card" data-file="${esc(m.file)}">
        <div class="catalogue-icon">${esc(m.icon || '◇')}</div>
        <div class="catalogue-body">
          <h3>${esc(m.name)}</h3>
          <p>${esc(m.description || '')}</p>
          <div class="project-tags"><span>Aquavoid ${esc(versionsLabel)}</span><span>v${esc(m.version || '1.0.0')}</span>${(m.tags || []).map(t => `<span>${esc(t)}</span>`).join('')}</div>
          <div class="instance-meta"><span>by ${esc(m.author || 'Unknown')}</span>${updateAvailable ? `<span>Installed v${esc(installedVersion)}</span>` : ''}</div>
        </div>
        <div class="catalogue-action"><button class="primary-button" data-install="${esc(m.file)}" type="button" ${!compatible || (done && !updateAvailable) ? 'disabled' : ''}>${actionLabel}</button></div>
      </article>`;
    }).join('')}</div>`;
}
async function installCatalogueMod(file, button) {
  const instanceId = $('modCatalogue').dataset.instance;
  if (!window.SClientMods) { toast('The client is still loading. Try again in a moment.'); return; }
  button.disabled = true;
  button.textContent = 'DOWNLOADING…';
  try {
    const res = await fetch('mods/' + file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    setModInstance(instanceId, false);
    const instance = instances.find(item => item.id === instanceId);
    const name = await window.SClientMods.install(instanceId, raw, instance?.version);
    await refreshInstalledIds(instanceId);
    toast(`${name} installed to ${instances.find(i => i.id === instanceId)?.name || 'your instance'}.`);
  } catch (err) {
    console.error(err);
    toast(`Could not install: ${err.message}`);
  }
  renderModCatalogue();
}

function sanitizeInstance(raw) {
  const version = SUPPORTED_VERSIONS.includes(String(raw?.version)) ? String(raw.version) : null;
  if (!version) return null;
  return {
    id: String(raw.id || ('inst_' + Math.random().toString(36).slice(2, 10))),
    name: String(raw.name || `Aquavoid ${version}`).replace(/\s+/g, ' ').trim().slice(0, 24) || `Aquavoid ${version}`,
    version,
    createdAt: Number(raw.createdAt) || Date.now(),
    lastPlayed: Number(raw.lastPlayed) || 0,
    playSeconds: Math.max(0, Math.floor(Number(raw.playSeconds) || 0))
  };
}

function persist() {
  const payload = { instances: instances.slice(0, MAX_INSTANCES) };
  return window.SClientCloud?.saveClientPrefs?.(payload)?.catch?.(err => {
    console.error('Instance save failed:', err);
    toast('Could not sync your instances to the cloud.');
  });
}

function fmtTime(sec) {
  if (!sec) return 'Never played';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m played` : `${Math.max(1, m)}m played`;
}
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function goto(view) {
  if (view === 'instancemods') {
    // Per-instance mod manager has no sidebar entry: open it from a Library card.
    document.querySelectorAll('.view').forEach(el => el.classList.toggle('view-active', el.id === 'view-instancemods'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === 'library'));
    return;
  }
  document.querySelector(`.nav-item[data-view="${view}"]`)?.click();
}

function renderCounts() {
  const n = instances.length;
  $('instanceCount').textContent = `${n}/${MAX_INSTANCES}`;
  $('libraryTag').textContent = `${n} / ${MAX_INSTANCES} INSTANCES`;
  const full = n >= MAX_INSTANCES;
  const btn = $('newInstanceButton');
  btn.textContent = full ? 'LIMIT REACHED (3/3)' : '＋ NEW INSTANCE';
  btn.disabled = installing || full;
}

function renderLibrary() {
  const grid = $('instanceGrid');
  const cards = instances.map(inst => `
    <article class="instance-card ${inst.id === activeInstanceId ? 'is-running' : ''}" data-id="${esc(inst.id)}">
      <div class="instance-icon">A</div>
      <div class="instance-body">
        <h3>${esc(inst.name)}</h3>
        <div class="instance-meta"><span>Aquavoid ${esc(inst.version)}</span><span>${esc(fmtTime(inst.playSeconds))}</span></div>
        <div class="instance-meta"><span>Installed ${esc(fmtDate(inst.createdAt))}</span>${inst.lastPlayed ? `<span>Last played ${esc(fmtDate(inst.lastPlayed))}</span>` : ''}</div>
      </div>
      <div class="instance-actions">
        <button class="primary-button" data-act="play" type="button">${inst.id === activeInstanceId ? '▶ RESUME' : '▶ PLAY'}</button>
        ${inst.id === activeInstanceId ? '<button class="soft-button" data-act="stop" type="button">■ STOP</button>' : ''}
        <button class="soft-button" data-act="mods" type="button">MODS</button>
        <button class="soft-button" data-act="rename" type="button">RENAME</button>
        <button class="soft-button danger" data-act="delete" type="button">DELETE</button>
      </div>
    </article>`);
  for (let i = instances.length; i < MAX_INSTANCES; i++) {
    cards.push(`<article class="instance-card instance-empty"><div class="instance-icon ghost">＋</div><div class="instance-body"><h3>Empty slot</h3><div class="instance-meta"><span>Install Aquavoid 1.0 or 1.01</span></div></div><div class="instance-actions"><button class="outline-button" data-act="new" type="button">＋ INSTALL</button></div></article>`);
  }
  grid.innerHTML = cards.join('');
  renderCounts();
  if (modInstanceId && !instances.some(i => i.id === modInstanceId)) setModInstance(instances[0]?.id || null);
  else if (modInstanceId && instances.some(i => i.id === modInstanceId)) setModInstance(modInstanceId, false);
  else if (!modInstanceId && instances.length) setModInstance(activeInstanceId || instances[0].id);
  else renderModBar();
  renderModCatalogue();
}

function updatePlayHeader() {
  const view = $('view-play');
  const inst = instances.find(i => i.id === activeInstanceId);
  const pendingInst = instances.find(i => i.id === pendingLaunchInstanceId);
  const needsAquavoidAuth = !window.AQUAVOID_BOOT?.authenticated;
  view.classList.toggle('no-instance', !inst);
  view.classList.toggle('awaiting-aquavoid-auth', needsAquavoidAuth);
  $('noInstance').hidden = needsAquavoidAuth;

  if (inst) {
    $('playEyebrow').textContent = `INSTANCE · AQUAVOID ${inst.version}`;
    $('playTitle').textContent = inst.name;
    $('playSubtitle').textContent = 'Ride the waves. Collect crystals. Make your own rules.';
    $('playTag').textContent = 'RUNNING';
  } else if (needsAquavoidAuth) {
    $('playEyebrow').textContent = 'AQUAVOID ACCOUNT REQUIRED';
    $('playTitle').textContent = pendingInst ? `Connect to launch ${pendingInst.name}` : 'Connect to Aquavoid';
    $('playSubtitle').textContent = 'S-Client is signed in. Sign in separately to your Aquavoid Google account to continue.';
    $('playTag').textContent = 'LOGIN REQUIRED';
  } else {
    $('playEyebrow').textContent = 'YOUR GAME';
    $('playTitle').textContent = 'Game';
    $('playSubtitle').textContent = 'Launch one of your installed Aquavoid instances from the Library.';
    $('playTag').textContent = 'NOT RUNNING';
  }
}

function flushPlaytime() {
  const inst = instances.find(i => i.id === activeInstanceId);
  if (inst && unsavedSeconds > 0) {
    inst.playSeconds += unsavedSeconds;
    inst.lastPlayed = Date.now();
    unsavedSeconds = 0;
    persist();
    renderLibrary();
  }
}

async function launch(id) {
  const inst = instances.find(i => i.id === id);
  if (!inst) return;
  // Keep the requested instance queued while the user completes the separate
  // Aquavoid Google sign-in. The auth-ready event resumes this exact launch.
  if (!window.AQUAVOID_BOOT?.authenticated) {
    setPendingLaunchInstance(id);
    updatePlayHeader();
    const status = $('aquavoidAuthStatus');
    if (status) status.textContent = `Connect your Aquavoid Google account to launch ${inst.name}.`;
    goto('play');
    return;
  }
  setPendingLaunchInstance(null);
  if (activeInstanceId && activeInstanceId !== id) flushPlaytime();
  if (activeInstanceId !== id) {
    try { await mountInstance(inst); }
    catch (err) { console.error(err); toast('Could not load this instance. Check your connection and try again.'); return; }
    activeInstanceId = id;
    unsavedSeconds = 0;
    inst.lastPlayed = Date.now();
    persist();
  }
  setModInstance(inst.id, true);
  updatePlayHeader();
  renderLibrary();
  goto('play');
}

function closeActiveInstance() {
  setPendingLaunchInstance(null);
  flushPlaytime();
  activeInstanceId = null;
  clearFrame();
  updatePlayHeader();
  renderLibrary();
}

function deleteInstance(id) {
  const inst = instances.find(i => i.id === id);
  if (!inst) return;
  if (!confirm(`Delete "${inst.name}"? Your Aquavoid cloud save is kept, but this instance will be removed.`)) return;
  if (pendingLaunchInstanceId === id) setPendingLaunchInstance(null);
  if (id === activeInstanceId) closeActiveInstance();
  instances = instances.filter(i => i.id !== id);
  deleteFiles(id).catch(() => {});
  window.SClientCloud?.deleteInstanceMods?.(id)?.catch?.(() => {});
  persist();
  renderLibrary();
  toast(`Deleted ${inst.name}.`);
}

function renameInstance(id) {
  const inst = instances.find(i => i.id === id);
  if (!inst) return;
  const next = prompt('Rename instance (2–24 characters):', inst.name);
  if (next === null) return;
  const clean = next.replace(/\s+/g, ' ').trim().slice(0, 24);
  if (clean.length < 2) { toast('Instance names need at least 2 characters.'); return; }
  inst.name = clean;
  persist();
  renderLibrary();
  updatePlayHeader();
}

function openInstallPanel() {
  if (instances.length >= MAX_INSTANCES) { toast(`Instance limit reached (${MAX_INSTANCES}/${MAX_INSTANCES}). Delete one to install another.`); return; }
  $('installPanel').hidden = false;
  $('installPanel').scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  const input = $('instanceNameInput');
  const n = instances.length + 1;
  const versionSelect = $('instanceVersionSelect');
  if (versionSelect) versionSelect.value = '1.0';
  const version = versionSelect?.value || '1.0';
  const title = $('installTitle');
  const note = $('installNote');
  if (title) title.textContent = `Install Aquavoid ${version}`;
  if (note) note.textContent = `Choose the game version for this instance. S-Client keeps each version's files separate.`;
  input.value = instances.length ? `Aquavoid ${version} (${n})` : `Aquavoid ${version}`;
  input.focus();
  input.select();
}

async function runInstall() {
  if (installing) return;
  if (instances.length >= MAX_INSTANCES) { toast(`Instance limit reached (${MAX_INSTANCES}/${MAX_INSTANCES}).`); return; }
  const version = String($('instanceVersionSelect')?.value || '1.0');
  if (!SUPPORTED_VERSIONS.includes(version)) { toast('Choose a supported Aquavoid version.'); return; }
  const name = $('instanceNameInput').value.replace(/\s+/g, ' ').trim().slice(0, 24);
  if (name.length < 2) { toast('Give your instance a name (2–24 characters).'); return; }
  installing = true;
  $('confirmInstallButton').disabled = true;
  $('cancelInstallButton').disabled = true;
  $('instanceNameInput').disabled = true;
  $('installProgress').hidden = false;
  renderCounts();
  const id = 'inst_' + Math.random().toString(36).slice(2, 10);
  const setProgress = (label, pct) => {
    $('installStep').textContent = label;
    $('installBar').style.width = pct + '%';
    $('installPercent').textContent = pct + '%';
  };
  let failed = false;
  try {
    setProgress(`Fetching Aquavoid ${version}…`, 5);
    await downloadVersion(version, id, setProgress);
    setProgress('Creating instance…', 100);
    await new Promise(r => setTimeout(r, 350));
  } catch (err) {
    console.error('Install failed:', err);
    failed = true;
    deleteFiles(id).catch(() => {});
    toast('Download failed. Check your connection and try again.');
  }
  // Re-check the cap right before committing (e.g. another tab filled the slots).
  if (failed) {
    // nothing is created when the download fails
  } else if (instances.length >= MAX_INSTANCES) {
    deleteFiles(id).catch(() => {});
    toast('Instance limit reached.');
  } else {
    instances.push({ id, name, version, createdAt: Date.now(), lastPlayed: 0, playSeconds: 0 });
    await persist();
    toast(`Installed ${name}. Find it in your Library.`);
    goto('library');
  }
  installing = false;
  $('installPanel').hidden = true;
  $('installProgress').hidden = true;
  $('installBar').style.width = '0%';
  $('confirmInstallButton').disabled = false;
  $('cancelInstallButton').disabled = false;
  $('instanceNameInput').disabled = false;
  renderLibrary();
}

function wireEvents() {
  window.addEventListener('sclient:aquavoid-ready', () => {
    const queuedId = pendingLaunchInstanceId;
    if (queuedId && instances.some(inst => inst.id === queuedId)) {
      setPendingLaunchInstance(null);
      launch(queuedId);
    } else {
      updatePlayHeader();
    }
  });
  window.addEventListener('sclient:aquavoid-disconnected', () => {
    if (activeInstanceId) closeActiveInstance();
    updatePlayHeader();
  });
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]');
    if (g) { goto(g.dataset.goto); return; }
  });
  $('instanceGrid').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'new') { openInstallPanel(); return; }
    const id = btn.closest('.instance-card')?.dataset.id;
    if (btn.dataset.act === 'play') launch(id);
    else if (btn.dataset.act === 'stop') { closeActiveInstance(); toast('Instance stopped.'); }
    else if (btn.dataset.act === 'mods') { setModInstance(id); goto('instancemods'); }
    else if (btn.dataset.act === 'rename') renameInstance(id);
    else if (btn.dataset.act === 'delete') deleteInstance(id);
  });
  $('newInstanceButton').addEventListener('click', openInstallPanel);
  $('modCatalogue').addEventListener('click', e => {
    const b = e.target.closest('button[data-install]');
    if (b) installCatalogueMod(b.dataset.install, b);
  });
  $('modCatalogue').addEventListener('change', e => {
    if (e.target.id === 'catalogueInstance') { $('modCatalogue').dataset.instance = e.target.value; renderModCatalogue(); }
  });
  $('cancelInstallButton').addEventListener('click', () => { if (!installing) $('installPanel').hidden = true; });
  $('confirmInstallButton').addEventListener('click', runInstall);
  $('instanceNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') runInstall(); });
  $('instanceVersionSelect')?.addEventListener('change', () => {
    const version = $('instanceVersionSelect').value;
    const input = $('instanceNameInput');
    const title = $('installTitle');
    const note = $('installNote');
    if (title) title.textContent = `Install Aquavoid ${version}`;
    if (note) note.textContent = `Choose the game version for this instance. S-Client keeps each version's files separate.`;
    const previousPrefix = /^Aquavoid 1\.0(?:1)?(?: \(\d+\))?$/;
    if (!input.value.trim() || previousPrefix.test(input.value.trim())) {
      input.value = instances.length ? `Aquavoid ${version} (${instances.length + 1})` : `Aquavoid ${version}`;
    }
    input.placeholder = `Aquavoid ${version}`;
  });

  // Keep the game fullscreen until the user presses the on-screen fullscreen
  // control. Keyboard Lock captures Escape where the browser supports it.
  document.addEventListener('fullscreenchange', () => {
    const wrap = $('instanceFrameWrap');
    const active = document.fullscreenElement === wrap;
    const button = wrap?.querySelector('.instance-fullscreen-button');
    if (button) {
      button.textContent = active ? '×' : '⛶';
      button.title = active ? 'Exit fullscreen' : 'Enter fullscreen (Escape stays in the game)';
      button.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    }
    if (!active) navigator.keyboard?.unlock?.();
  });
  document.addEventListener('keydown', event => {
    if (document.fullscreenElement === $('instanceFrameWrap') && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  // Count play time only while the Game tab is open and visible.
  setInterval(() => {
    const now = Date.now();
    const dt = Math.min(10, Math.round((now - lastTick) / 1000));
    lastTick = now;
    const playing = activeInstanceId && $('view-play').classList.contains('view-active') && !document.hidden;
    if (playing) {
      unsavedSeconds += dt;
      if (unsavedSeconds >= 60) flushPlaytime();
    }
  }, 5000);
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => { if (b.dataset.view !== 'play') flushPlaytime(); }));
  window.addEventListener('pagehide', () => {
    flushPlaytime();
    navigator.keyboard?.unlock?.();
  });
}

function init() {
  const stored = window.SCLIENT_BOOT?.clientPrefs?.instances;
  instances = (Array.isArray(stored) ? stored : []).map(sanitizeInstance).filter(Boolean).slice(0, MAX_INSTANCES);
  try {
    const storedPendingId = sessionStorage.getItem(PENDING_LAUNCH_KEY);
    if (storedPendingId && instances.some(inst => inst.id === storedPendingId)) pendingLaunchInstanceId = storedPendingId;
    else sessionStorage.removeItem(PENDING_LAUNCH_KEY);
  } catch (error) {
    console.info('Could not restore a pending Aquavoid launch.', error);
  }
  wireEvents();
  updatePlayHeader();
  renderLibrary();
  // A redirect-based Aquavoid login reloads the page. If auth completed before
  // this launcher initialized, resume the stored instance here instead.
  if (pendingLaunchInstanceId && window.AQUAVOID_BOOT?.authenticated) {
    const queuedId = pendingLaunchInstanceId;
    setPendingLaunchInstance(null);
    launch(queuedId);
  }
}

// Wait for the cloud profile to finish loading (app.js populates SClientCloud after sign-in).
const wait = setInterval(() => {
  if (window.SClientCloud && window.SCLIENT_BOOT) { clearInterval(wait); init(); }
}, 250);
