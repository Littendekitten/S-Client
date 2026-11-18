// S-Client launcher layer: Modrinth-style Library (instances) + Discover (download).
// Only Aquavoid 1.0 is supported for now, and a player can own at most 3 instances.
const MAX_INSTANCES = 3;
const SUPPORTED_VERSIONS = ['1.0'];
// Game versions are hosted in this repo's GitHub Pages root: /game-versions/Aquavoid-<version>/
const VERSION_FILES = ['index.html', 'app.js', 'style.css'];
const versionFolder = v => `game-versions/Aquavoid-${v}/`;
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let instances = [];
let activeInstanceId = null;
let installing = false;
let lastTick = Date.now();
let unsavedSeconds = 0;

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
const deleteFiles = id => idb('readwrite', s => VERSION_FILES.forEach(n => s.delete(`${id}/${n}`)));

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
}

// ---- Launching: build the game page from the downloaded files and run it in the Game tab ----
let frameUrls = [];
function clearFrame() {
  $('instanceFrameWrap').innerHTML = '';
  frameUrls.forEach(u => URL.revokeObjectURL(u));
  frameUrls = [];
}
async function mountInstance(inst) {
  clearFrame();
  let files = {};
  for (const name of VERSION_FILES) files[name] = await getFile(inst.id, name);
  if (VERSION_FILES.some(n => !files[n])) {
    toast('Re-downloading missing game files…');
    await downloadVersion(inst.version, inst.id);
    for (const name of VERSION_FILES) files[name] = await getFile(inst.id, name);
  }
  const cssUrl = URL.createObjectURL(new Blob([files['style.css']], { type: 'text/css' }));
  const jsUrl = URL.createObjectURL(new Blob([files['app.js']], { type: 'text/javascript' }));
  frameUrls.push(cssUrl, jsUrl);
  const html = files['index.html']
    .replace(/<link[^>]*href=["']style\.css["'][^>]*>/i, `<link rel="stylesheet" href="${cssUrl}">`)
    .replace(/<script[^>]*src=["']app\.js["'][^>]*>\s*<\/script>/i, `<script type="module" src="${jsUrl}"><\/script>`);
  const frame = document.createElement('iframe');
  frame.title = inst.name;
  frame.allow = 'fullscreen; autoplay; clipboard-write';
  frame.setAttribute('allowfullscreen', '');
  frame.srcdoc = html;
  $('instanceFrameWrap').appendChild(frame);
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
  document.querySelector(`.nav-item[data-view="${view}"]`)?.click();
}

function renderCounts() {
  const n = instances.length;
  $('instanceCount').textContent = `${n}/${MAX_INSTANCES}`;
  $('libraryTag').textContent = `${n} / ${MAX_INSTANCES} INSTANCES`;
  $('discoverTag').textContent = `${n} / ${MAX_INSTANCES} INSTANCES`;
  $('slotMeter').innerHTML = Array.from({ length: MAX_INSTANCES }, (_, i) => `<span class="slot ${i < n ? 'used' : ''}"></span>`).join('') + `<em>${n} of ${MAX_INSTANCES} used</em>`;
  const full = n >= MAX_INSTANCES;
  const btn = $('installVersionButton');
  btn.disabled = installing;
  btn.textContent = full ? 'LIMIT REACHED (3/3)' : '⬇ INSTALL';
  btn.classList.toggle('is-full', full);
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
        <button class="soft-button" data-act="rename" type="button">RENAME</button>
        <button class="soft-button danger" data-act="delete" type="button">DELETE</button>
      </div>
    </article>`);
  for (let i = instances.length; i < MAX_INSTANCES; i++) {
    cards.push(`<article class="instance-card instance-empty"><div class="instance-icon ghost">＋</div><div class="instance-body"><h3>Empty slot</h3><div class="instance-meta"><span>Install Aquavoid from Discover</span></div></div><div class="instance-actions"><button class="outline-button" data-goto="discover" type="button">DISCOVER</button></div></article>`);
  }
  grid.innerHTML = cards.join('');
  renderCounts();
}

function updatePlayHeader() {
  const view = $('view-play');
  const inst = instances.find(i => i.id === activeInstanceId);
  view.classList.toggle('no-instance', !inst);
  if (inst) {
    $('playEyebrow').textContent = `INSTANCE · AQUAVOID ${inst.version}`;
    $('playTitle').textContent = inst.name;
    $('playSubtitle').textContent = 'Ride the waves. Collect crystals. Make your own rules.';
    $('playTag').textContent = 'RUNNING';
  } else {
    $('playEyebrow').textContent = 'YOUR GAME';
    $('playTitle').textContent = 'Game';
    $('playSubtitle').textContent = 'Launch an instance from your Library.';
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
  if (activeInstanceId && activeInstanceId !== id) flushPlaytime();
  if (activeInstanceId !== id) {
    try { await mountInstance(inst); }
    catch (err) { console.error(err); toast('Could not load this instance. Check your connection and try again.'); return; }
    activeInstanceId = id;
    unsavedSeconds = 0;
    inst.lastPlayed = Date.now();
    persist();
  }
  updatePlayHeader();
  renderLibrary();
  goto('play');
}

function closeActiveInstance() {
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
  if (id === activeInstanceId) closeActiveInstance();
  instances = instances.filter(i => i.id !== id);
  deleteFiles(id).catch(() => {});
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
  const input = $('instanceNameInput');
  const n = instances.length + 1;
  input.value = instances.length ? `Aquavoid 1.0 (${n})` : 'Aquavoid 1.0';
  input.focus();
  input.select();
}

async function runInstall() {
  if (installing) return;
  if (instances.length >= MAX_INSTANCES) { toast(`Instance limit reached (${MAX_INSTANCES}/${MAX_INSTANCES}).`); return; }
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
    setProgress('Fetching Aquavoid 1.0…', 5);
    await downloadVersion('1.0', id, setProgress);
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
    instances.push({ id, name, version: '1.0', createdAt: Date.now(), lastPlayed: 0, playSeconds: 0 });
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
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]');
    if (g) { goto(g.dataset.goto); return; }
  });
  $('instanceGrid').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.instance-card')?.dataset.id;
    if (btn.dataset.act === 'play') launch(id);
    else if (btn.dataset.act === 'stop') { closeActiveInstance(); toast('Instance stopped.'); }
    else if (btn.dataset.act === 'rename') renameInstance(id);
    else if (btn.dataset.act === 'delete') deleteInstance(id);
  });
  $('installVersionButton').addEventListener('click', openInstallPanel);
  $('cancelInstallButton').addEventListener('click', () => { if (!installing) $('installPanel').hidden = true; });
  $('confirmInstallButton').addEventListener('click', runInstall);
  $('instanceNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') runInstall(); });

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
  window.addEventListener('pagehide', flushPlaytime);
}

function init() {
  const stored = window.SCLIENT_BOOT?.clientPrefs?.instances;
  instances = (Array.isArray(stored) ? stored : []).map(sanitizeInstance).filter(Boolean).slice(0, MAX_INSTANCES);
  wireEvents();
  updatePlayHeader();
  renderLibrary();
}

// Wait for the cloud profile to finish loading (app.js populates SClientCloud after sign-in).
const wait = setInterval(() => {
  if (window.SClientCloud && window.SCLIENT_BOOT) { clearInterval(wait); init(); }
}, 250);
