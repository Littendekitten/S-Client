// S-Client launcher layer: Modrinth-style Library (instances) + Mods download page.
// S-Client supports the released Aquavoid 1.0 and 1.01 builds.
const MAX_INSTANCES = 3;
const SUPPORTED_VERSIONS = ['1.0', '1.01'];
// Game versions are hosted in this repo's GitHub Pages root: /game-versions/Aquavoid-<version>/
const VERSION_FILES = ['index.html', 'app.js', 'style.css'];
const versionFolder = v => `game-versions/Aquavoid-${v}/`;
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const SCLIENT_GAME_MOD_RUNTIME = String.raw`
;(() => {
  try {
    const boot = window.SCLIENT_INSTANCE || {};
    const version = String(boot.version || '');
    const validKey = value => /^[a-z0-9][a-z0-9._-]{1,63}$/i.test(String(value || ''));
    const validColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
    const modSkins = [];

    // Only declarative, enabled .sclient vehicle-skin data reaches this adapter.
    // No JavaScript supplied by a mod is evaluated here.
    for (const record of (Array.isArray(boot.mods) ? boot.mods : [])) {
      const manifest = record && record.manifest;
      if (!manifest || !validKey(manifest.id)) continue;
      if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes('vehicles.shipSkins')) continue;
      const versions = Array.isArray(manifest.gameVersions) && manifest.gameVersions.length
        ? manifest.gameVersions.map(String)
        : (manifest.gameVersion ? [String(manifest.gameVersion)] : []);
      if (versions.length && !versions.includes(version)) continue;
      for (const raw of (Array.isArray(manifest.vehicleSkins) ? manifest.vehicleSkins : []).slice(0, 8)) {
        if (!raw || !validKey(raw.id)) continue;
        const style = ['sloop', 'catamaran', 'trimaran', 'ironclad'].includes(String(raw.style || 'sloop')) ? String(raw.style || 'sloop') : 'sloop';
        modSkins.push({
          id: String(raw.id),
          name: String(raw.name || raw.id).slice(0, 48),
          description: String(raw.description || '').slice(0, 120),
          icon: String(raw.icon || '⛵').slice(0, 4),
          style,
          hullColor: validColor(raw.hullColor, '#805232'),
          sailColor: validColor(raw.sailColor, '#f6efe0'),
          flagColor: validColor(raw.flagColor, '#ff6b8a'),
          glowColor: validColor(raw.glowColor, '#b6e2ee'),
          accentColor: validColor(raw.accentColor, '#d9b45a'),
          logo: /^data:image\/png;base64,[A-Za-z0-9+/=]{1,60000}$/.test(String(raw.logo || '')) ? String(raw.logo) : '',
          modId: String(manifest.id),
          modName: String(manifest.name || manifest.id).slice(0, 70),
          modSkinId: String(manifest.id) + ':' + String(raw.id)
        });
      }
    }

    if (!modSkins.length || typeof THREE === 'undefined' || typeof P === 'undefined' || typeof applySkin !== 'function' || typeof drawShop !== 'function') {
      return;
    }

    const instanceId = String(boot.id || 'standalone').replace(/[^a-z0-9_-]/gi, '');
    const storageKey = 'sclient:ship-skin:' + instanceId;
    let selectedId = '';
    try { selectedId = localStorage.getItem(storageKey) || ''; } catch (_) {}
    let activeModSkin = modSkins.find(skin => skin.modSkinId === selectedId) || null;
    if (!activeModSkin && selectedId) {
      try { localStorage.removeItem(storageKey); } catch (_) {}
    }

    function renderModShip(skin) {
      while (P.children.length) P.remove(P.children[0]);
      const ironclad = skin.style === 'ironclad';
      const hullMaterial = new THREE.MeshStandardMaterial({
        color: skin.hullColor,
        metalness: ironclad ? 0.62 : 0.18,
        roughness: ironclad ? 0.34 : 0.72
      });
      const accentMaterial = new THREE.MeshStandardMaterial({ color: skin.accentColor, metalness: 0.48, roughness: 0.42 });
      const glowMaterial = new THREE.MeshStandardMaterial({
        color: skin.glowColor, emissive: skin.glowColor, emissiveIntensity: 0.55, metalness: 0.28, roughness: 0.32
      });
      const sailMaterial = new THREE.MeshStandardMaterial({ color: skin.sailColor, roughness: 0.78, side: THREE.DoubleSide });
      const add = (geometry, material, x, y, z) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, z);
        P.add(mesh);
        return mesh;
      };

      add(new THREE.BoxGeometry(1.4, 0.48, 3.15), hullMaterial, 0, 0.08, 0);
      const bowGeometry = new THREE.ConeGeometry(0.99, 1.5, 4);
      bowGeometry.rotateY(Math.PI / 4);
      bowGeometry.rotateX(-Math.PI / 2);
      const bow = add(bowGeometry, hullMaterial, 0, 0.08, -2.0);
      bow.scale.y = 0.48 / 1.4;
      add(new THREE.BoxGeometry(1.18, 0.12, 2.3), accentMaterial, 0, 0.37, 0.12);

      const hullCount = skin.style === 'trimaran' ? 3 : skin.style === 'catamaran' ? 2 : 1;
      if (hullCount > 1) {
        for (let i = 0; i < hullCount; i++) {
          const side = i - (hullCount - 1) / 2;
          if (Math.abs(side) < 0.01) continue;
          add(new THREE.BoxGeometry(0.34, 0.34, 2.9), hullMaterial, side * 0.9, 0.02, 0.05);
          add(new THREE.BoxGeometry(0.09, 0.1, 2.55), glowMaterial, side * 0.9, 0.21, 0.02);
        }
      }

      if (ironclad) {
        for (const side of [-1, 1]) {
          add(new THREE.BoxGeometry(0.08, 0.22, 2.8), accentMaterial, side * 0.66, 0.46, 0.04);
          const port = add(new THREE.CylinderGeometry(0.11, 0.11, 0.34, 10), glowMaterial, side * 0.55, 0.62, -1.05);
          port.rotation.z = Math.PI / 2;
        }
      }

      add(new THREE.CylinderGeometry(0.055, 0.065, 3.8, 8), hullMaterial, 0, 2.05, -0.08);
      const sail = add(new THREE.PlaneGeometry(ironclad ? 1.5 : 2.0, 2.45), sailMaterial, 0, 2.15, -0.18);
      sail.rotation.y = 0;
      for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.045, 2.45, 0.06), glowMaterial, side * 0.99, 2.16, -0.18);
      const flag = add(new THREE.PlaneGeometry(0.55, 0.3), new THREE.MeshBasicMaterial({ color: skin.flagColor, side: THREE.DoubleSide }), 0.28, 3.55, -0.08);

      const badgeCanvas = document.createElement('canvas');
      badgeCanvas.width = badgeCanvas.height = 128;
      const context = badgeCanvas.getContext('2d');
      context.fillStyle = skin.flagColor;
      context.beginPath(); context.arc(64, 64, 56, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#ffffff'; context.font = 'bold 66px sans-serif';
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(skin.icon || '⛵', 64, 68);
      const badgeTexture = new THREE.CanvasTexture(badgeCanvas);
      if (THREE.sRGBEncoding !== undefined) badgeTexture.encoding = THREE.sRGBEncoding;
      const badge = add(new THREE.PlaneGeometry(0.75, 0.75), new THREE.MeshBasicMaterial({ map: badgeTexture, transparent: true, side: THREE.DoubleSide, depthWrite: false }), 0, 2.18, -0.31);
      if (skin.logo) {
        const logoImage = new Image();
        logoImage.onload = () => {
          context.clearRect(0, 0, 128, 128);
          context.fillStyle = '#ffffff'; context.beginPath(); context.arc(64, 64, 58, 0, Math.PI * 2); context.fill();
          context.save(); context.beginPath(); context.arc(64, 64, 54, 0, Math.PI * 2); context.clip();
          context.drawImage(logoImage, 6, 6, 116, 116); context.restore();
          badgeTexture.needsUpdate = true;
        };
        logoImage.src = skin.logo;
      }
      // Retain references on the player group for predictable cleanup/debugging.
      P.userData = P.userData || {};
      P.userData.sclientModShipSkinId = skin.modSkinId;
    }

    function persistSelection() {
      try {
        if (activeModSkin) localStorage.setItem(storageKey, activeModSkin.modSkinId);
        else localStorage.removeItem(storageKey);
      } catch (error) { console.warn('Could not save selected S-Client ship skin:', error); }
    }

    const originalApplySkin = applySkin;
    const originalDrawShop = drawShop;
    applySkin = function (index) {
      if (activeModSkin) {
        try { renderModShip(activeModSkin); return; }
        catch (error) {
          console.error('S-Client could not render the enabled mod ship skin:', error);
          activeModSkin = null;
          persistSelection();
        }
      }
      return originalApplySkin(index);
    };

    drawShop = function () {
      originalDrawShop();
      const grid = $('grid');
      if (!grid) return;
      const baseButtons = Array.from(grid.querySelectorAll('button'));
      for (const button of baseButtons) {
        if (button.dataset.sclientBaseSkinWrapped === '1') continue;
        const previousClick = button.onclick;
        if (typeof previousClick !== 'function') continue;
        button.dataset.sclientBaseSkinWrapped = '1';
        button.onclick = function (event) {
          activeModSkin = null;
          persistSelection();
          return previousClick.call(this, event);
        };
      }
      if (activeModSkin) baseButtons.forEach(button => button.classList.remove('on'));

      for (const skin of modSkins) {
        const button = document.createElement('button');
        const isSelected = !!activeModSkin && activeModSkin.modSkinId === skin.modSkinId;
        button.type = 'button';
        button.className = 'sk' + (isSelected ? ' on' : '');
        const hullSwatch = document.createElement('i');
        hullSwatch.style.backgroundColor = skin.hullColor;
        const sailSwatch = document.createElement('i');
        sailSwatch.style.backgroundColor = skin.sailColor;
        const name = document.createElement('span');
        name.textContent = skin.name;
        const source = document.createElement('small');
        source.textContent = 'MOD · ' + skin.modName;
        const status = document.createElement('small');
        status.textContent = isSelected ? 'Equipped' : 'Equip';
        button.append(hullSwatch, sailSwatch, name, source, status);
        button.addEventListener('click', () => {
          activeModSkin = skin;
          persistSelection();
          try {
            renderModShip(skin);
            const note = $('note');
            if (note) note.textContent = skin.name + ' equipped from ' + skin.modName + '.';
            drawShop();
          } catch (error) {
            console.error('S-Client mod ship skin failed:', error);
            activeModSkin = null;
            persistSelection();
            originalApplySkin(typeof sel === 'number' ? sel : 0);
          }
        });
        grid.appendChild(button);
      }
    };

    if (activeModSkin) renderModShip(activeModSkin);
  } catch (error) {
    console.error('S-Client mod runtime could not start; the unmodified Aquavoid game will continue:', error);
  }
})();
`;


let instances = [];
let activeInstanceId = null;
let installing = false;
let modInstanceId = null; // instance whose mods the Mods tab is showing
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
const gameFileKey = (id, name) => `${id}/clean-source-v1/${name}`;
const putFile = (id, name, text) => idb('readwrite', s => s.put(text, gameFileKey(id, name)));
const getFile = (id, name) => idb('readonly', s => s.get(gameFileKey(id, name)));
const deleteFiles = id => idb('readwrite', s => VERSION_FILES.forEach(n => { s.delete(gameFileKey(id, n)); s.delete(`${id}/${n}`); }));

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
  const wrap = $('instanceFrameWrap');
  if (document.fullscreenElement === wrap) {
    document.exitFullscreen?.().catch?.(() => {});
    navigator.keyboard?.unlock?.();
  }
  wrap.innerHTML = '';
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
  // Hand this instance's enabled mods to the game page before its script runs.
  let enabledMods = [];
  try {
    const stored = await window.SClientCloud.loadInstanceMods(inst.id);
    const supportsVersion = manifest => {
      const versions = Array.isArray(manifest?.gameVersions) && manifest.gameVersions.length
        ? manifest.gameVersions.map(String)
        : (manifest?.gameVersion ? [String(manifest.gameVersion)] : []);
      return !versions.length || versions.includes(String(inst.version));
    };
    enabledMods = stored
      .filter(m => m && m.enabled && m.manifest && supportsVersion(m.manifest))
      .map(m => ({ manifest: m.manifest, featureStates: m.featureStates || {}, settings: m.settings || {} }));
  } catch (err) { console.warn('Could not load instance mods:', err); }
  const gameModule = files['app.js'] + '\n/* S-Client declarative mod runtime; source game files remain untouched. */\n' + SCLIENT_GAME_MOD_RUNTIME;
  const jsUrl = URL.createObjectURL(new Blob([gameModule], { type: 'text/javascript' }));
  frameUrls.push(cssUrl, jsUrl);
  let html = files['index.html']
    .replace(/<link[^>]*href=["']style\.css["'][^>]*>/i, `<link rel="stylesheet" href="${cssUrl}">`)
    .replace(/<script[^>]*src=["']app\.js["'][^>]*>\s*<\/script>/i, `<script type="module" src="${jsUrl}"><\/script>`);
  const bootData = JSON.stringify({ id: inst.id, name: inst.name, version: inst.version, mods: enabledMods }).replace(/</g, '\\u003c');
  html = html.replace(/<script[^>]*src=["']blob:/i, m => `<script>window.SCLIENT_INSTANCE=${bootData};<\/script>${m}`);
  const frame = document.createElement('iframe');
  frame.title = inst.name;
  frame.allow = 'fullscreen; autoplay; clipboard-write';
  frame.setAttribute('allowfullscreen', '');
  frame.srcdoc = html;
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
  window.__sclientModInstance = modInstanceId;
  if (notify) window.dispatchEvent(new CustomEvent('sclient:mod-instance', { detail: { id: modInstanceId } }));
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
    const name = await window.SClientMods.install(instanceId, raw);
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
  else if (!modInstanceId && instances.length) setModInstance(activeInstanceId || instances[0].id);
  else renderModBar();
  renderModCatalogue();
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
  wireEvents();
  updatePlayHeader();
  renderLibrary();
}

// Wait for the cloud profile to finish loading (app.js populates SClientCloud after sign-in).
const wait = setInterval(() => {
  if (window.SClientCloud && window.SCLIENT_BOOT) { clearInterval(wait); init(); }
}, 250);
