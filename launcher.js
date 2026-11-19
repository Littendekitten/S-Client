// S-Client launcher layer: Modrinth-style Library (instances) + Mods download page.
// S-Client supports the released Aquavoid 1.0 and 1.01 builds.
const MAX_INSTANCES = 3;
// Mod loaders, like Fabric on Modrinth: mods only run in instances that use MangoMod Loader.
const LOADERS = { vanilla: 'Vanilla', mangomod: 'MangoMod Loader' };
const loaderOf = inst => (inst && inst.loader === 'mangomod') ? 'mangomod' : 'vanilla';
const SUPPORTED_VERSIONS = ['1.0', '1.01'];
// Game versions are hosted in this repo's GitHub Pages root: /game-versions/Aquavoid-<version>/
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


// ---- Cleanup of the retired local-copy system ----
// Earlier builds stored a copy of each game version in IndexedDB and served it through a service
// worker. Games now load straight from their hosted version folder, so remove those leftovers.
async function cleanupLegacyInstanceCache() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations
        .filter(r => [r.active, r.waiting, r.installing].some(w => w?.scriptURL?.endsWith('sclient-sw.js')))
        .map(r => r.unregister()));
    }
    indexedDB.deleteDatabase('sclient-instances');
  } catch (error) {
    console.info('Legacy instance cache cleanup skipped.', error);
  }
}

// Confirms a version folder is really hosted before an instance is created for it.
async function verifyVersionAvailable(version, onProgress) {
  onProgress?.(`Checking Aquavoid ${version}…`, 40);
  const res = await fetch(versionFolder(version) + 'index.html', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Aquavoid ${version} is not available (HTTP ${res.status})`);
  onProgress?.('Ready.', 90);
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
// BetterESC follows the live mod state (sent by the mod engine whenever mods are
// enabled, disabled or the game starts) instead of a one-off read at launch, so toggling the
// mod while the game is open works and a slow/failed Firestore read can't silently disable it.
let betterEscActive = false;
let betterEscInstanceId = null;
window.addEventListener('sclient:mods-synced', event => {
  const detail = event.detail || {};
  betterEscInstanceId = detail.instanceId || null;
  betterEscActive = Array.isArray(detail.permissions) && detail.permissions.includes('input.cursorUnlock');
});

function installBetterESCOnFrame(frame, instanceId) {
  const attach = () => {
    try {
      const gameDocument = frame.contentDocument;
      if (!gameDocument || gameDocument.__betterEscInstalled || !isGameDocument(frame)) return;
      gameDocument.__betterEscInstalled = true;
      // Keep track of the most recent pointer-lock state because Chromium may
      // dispatch pointerlockchange before the Escape keydown reaches the page.
      let pointerWasLocked = !!gameDocument.pointerLockElement;
      gameDocument.addEventListener('pointerlockchange', () => {
        if (gameDocument.pointerLockElement) pointerWasLocked = true;
      }, true);
      gameDocument.addEventListener('keydown', event => {
        if (!betterEscActive || betterEscInstanceId !== instanceId) return;
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

// app.js (the mod engine) finishes loading on its own schedule: it waits on Firebase and the
// Three.js CDN. Wait for it instead of silently launching the game with no mods applied.
function waitForModEngine(timeoutMs = 20000) {
  if (window.SClientMods?.startInstance) return Promise.resolve(window.SClientMods);
  return new Promise(resolve => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.SClientMods?.startInstance) { clearInterval(timer); resolve(window.SClientMods); }
      else if (Date.now() - started > timeoutMs) { clearInterval(timer); resolve(null); }
    }, 100);
  });
}

// ---- In-memory game patch --------------------------------------------------------------
// The game files in game-versions/ are never edited. When an instance starts, the launcher
// reads the game's own index.html and app.js, applies the small patches below to the copy
// in memory, and writes that copy into the instance frame:
//   * ship skins supplied by mods show up in the Ship Shop for free and are never auto-equipped
//   * the KitaCat logo sits on the front of the sail instead of behind it
//   * FightingPatches / BoatPatches hooks (enemy contact check, stock boat sails)
function patchGameSource(source) {
  let js = String(source).replace(/\r\n/g, '\n');
  const replaceOnce = (from, to) => {
    if (js.split(from).length !== 2) throw new Error('game patch anchor not found: ' + from.slice(0, 50));
    js = js.replace(from, () => to);
  };
  replaceOnce(`        getVehicleSkin() {
            for (const mod of mods) {
                if (!mod.permissions?.includes('vehicles.shipSkins')) continue;
                const skin = mod.vehicleSkins?.[0];
                if (skin) return skin;
            }
            return null;
        }`, `        getVehicleSkins() {
            const list = [];
            for (const mod of mods) {
                if (!mod.permissions?.includes('vehicles.shipSkins')) continue;
                for (const skin of (mod.vehicleSkins || [])) list.push({...skin, modId:mod.id, modName:mod.name || mod.id, key:mod.id + ':' + skin.id});
            }
            return list;
        },
        getVehicleSkin() {
            return selectedModSkin ? (this.getVehicleSkins().find(skin => skin.key === selectedModSkin) || null) : null;
        },
        getSelectedKey() { return selectedModSkin; },
        selectVehicleSkin(key) {
            selectedModSkin = String(key || '');
            try { localStorage.setItem('aquavoid-mod-skin', selectedModSkin); } catch (e) {}
        },
        hasPermission(permission) {
            return mods.some(mod => Array.isArray(mod.permissions) && mod.permissions.includes(permission));
        }`);
  replaceOnce('    let mods = [];\n    return Object.freeze({',
    "    let mods = [];\n    let selectedModSkin = '';\n    try { selectedModSkin = localStorage.getItem('aquavoid-mod-skin') || ''; } catch (e) {}\n    return Object.freeze({");
  replaceOnce('badge.position.set(0,2.18,-.31)', 'badge.position.set(0,2.18,-.47)');
  // FightingPatches (combat.stompImmunity): an enemy only hurts on touch when the boat is not
  // above it. "Above" = the boat has been lifted clear of the monster's body and fin.
  const contactRe = /d\s*<\s*m\.T\.r\s*\+\s*1\.3\s*&&\s*hurtT\s*<=\s*0/;
  if (!contactRe.test(js)) throw new Error('game patch anchor not found: enemy contact check');
  js = js.replace(contactRe, match => match + ' && !(AquavoidMods.hasPermission(\'combat.stompImmunity\') && p.y - o.position.y > m.T.sc * 1.2 + .6)');
  // BoatPatches (vehicles.sailFix): stock sails are curved toward the stern; turn them so they
  // billow toward the bow (-Z) like the sail on the mod ships. The z-tilt is negated so the lean stays.
  const shapeRe = /SHAPES\[SHAPE_OF\[i\]\s*\|\|\s*SHAPE_OF\[0\]\]\(\);/;
  if (!shapeRe.test(js)) throw new Error('game patch anchor not found: ship shape builder');
  js = js.replace(shapeRe, match => match + ' if (AquavoidMods.hasPermission(\'vehicles.sailFix\')) P.children.forEach(m => { if (m.isMesh && m.material === cloth && m.geometry.type === \'PlaneGeometry\') { m.rotation.y = Math.PI; m.rotation.z = -m.rotation.z; } });');
  const applyModsRe = /applyMods:\s*\(\)\s*=>\s*applySclientVehicleSkin\(\)/;
  if (!applyModsRe.test(js)) throw new Error('game patch anchor not found: applyMods');
  js = js.replace(applyModsRe, 'applyMods: () => { applySclientVehicleSkin(); drawShop(); }');
  const shopHelper = `
function appendModSkinButtons(g) {
  AquavoidMods.getVehicleSkins().forEach(skin => {
    const b = document.createElement('button');
    const on = AquavoidMods.getSelectedKey() === skin.key;
    b.className = 'sk' + (on ? ' on' : '');
    b.innerHTML = '<i style="background:' + skin.hullColor + '"></i><i style="background:' + skin.sailColor + '"></i><span></span><small></small>';
    b.querySelector('span').textContent = skin.name;
    b.querySelector('small').textContent = on ? 'Equipped' : 'Free · MOD';
    b.onclick = () => { AquavoidMods.selectVehicleSkin(skin.key); applySkin(sel); $('note').textContent = skin.name + ' equipped.'; drawShop(); };
    g.appendChild(b);
  });
}
`;
  if (js.includes('            drawShop();\n        };\n\n        g.appendChild(b);\n    });\n}\n')) {          // Aquavoid 1.0
    replaceOnce('            drawShop();\n        };\n\n        g.appendChild(b);\n    });\n}\n', '            drawShop();\n        };\n\n        g.appendChild(b);\n    });\n    appendModSkinButtons(g);\n}\n' + shopHelper);
    replaceOnce('        b.onclick = () => {\n            applySkin(i);\n\n            if (own) {', "        b.onclick = () => {\n            if (own || coins >= s.p) AquavoidMods.selectVehicleSkin('');\n            applySkin(i);\n\n            if (own) {");
  } else {                                                                                                    // Aquavoid 1.01
    replaceOnce('showCoins();drawShop()};g.appendChild(b)})}', 'showCoins();drawShop()};g.appendChild(b)});appendModSkinButtons(g)}' + shopHelper);
    replaceOnce('b.onclick=()=>{applySkin(i);if(own){', "b.onclick=()=>{if(own||coins>=s.p)AquavoidMods.selectVehicleSkin('');applySkin(i);if(own){");
  }
  return js;
}

const isGameDocument = frame => {
  try {
    const doc = frame.contentDocument;
    return frame.dataset.fallback === '1' || !!doc?.documentElement?.hasAttribute('data-sclient-patched');
  } catch (error) { return false; }
};

// Loads the (patched) game into the frame while keeping its real URL, so the shared Firebase
// login, the ?sclientInstance query and the mod messages work exactly as before.
async function loadGameIntoFrame(frame, gameUrl, version) {
  let scriptUrl = null;
  try {
    const [htmlRes, jsRes] = await Promise.all([
      fetch(gameUrl.pathname, { cache: 'no-cache' }),
      fetch(new URL('app.js', gameUrl).pathname, { cache: 'no-cache' })
    ]);
    if (!htmlRes.ok || !jsRes.ok) throw new Error('game files unavailable');
    const html = (await htmlRes.text()).replace(/\r\n/g, '\n');
    const patchedJs = patchGameSource(await jsRes.text());
    scriptUrl = URL.createObjectURL(new Blob([patchedJs], { type: 'text/javascript' }));
    const scriptTag = '<script type="module" src="app.js"></script>';
    if (!html.includes(scriptTag)) throw new Error('game script tag not found');
    const patchedHtml = html
      .replace(scriptTag, () => `<script type="module" src="${scriptUrl}"></script>`)
      .replace(/<html/i, '<html data-sclient-patched="1"');
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) throw new Error('frame is gone');
    doc.open();
    win.history.replaceState(null, '', gameUrl.pathname + gameUrl.search);
    doc.write(patchedHtml);
    doc.close();
    frame.addEventListener('load', () => setTimeout(() => URL.revokeObjectURL(scriptUrl), 60000), { once: true });
  } catch (error) {
    console.warn(`Aquavoid ${version}: loading the unpatched game instead.`, error);
    if (scriptUrl) URL.revokeObjectURL(scriptUrl);
    if (!frame.isConnected) return;
    frame.dataset.fallback = '1';
    frame.src = gameUrl.href;
  }
}

async function mountInstance(inst) {
  clearFrame();

  // The game loads straight from its hosted version folder (same origin as S-Client, so the
  // shared Firebase login and the mod messages keep working).
  const gameUrl = new URL(versionFolder(inst.version) + 'index.html', document.baseURI);
  gameUrl.searchParams.set('sclientInstance', inst.id);
  gameUrl.searchParams.set('sclientVersion', inst.version);

  const frame = document.createElement('iframe');
  frame.title = inst.name;
  frame.allow = 'fullscreen; autoplay; clipboard-write';
  installBetterESCOnFrame(frame, inst.id);
  frame.addEventListener('load', async () => {
    if (!isGameDocument(frame)) return;
    try {
      const engine = await waitForModEngine();
      if (!engine) { toast('The mod engine did not finish loading, so mods were not applied. Reload the page and try again.'); return; }
      const result = await engine.startInstance(inst.id, frame.contentWindow, inst.version, loaderOf(inst));
      if (result?.ok === false) toast(result.message || 'Mods could not be applied to this instance.');
    } catch (error) {
      console.error('Could not initialize this instance mod session:', error);
      toast('The game started, but its mod profile could not be applied.');
    }
  });
  const wrap = $('instanceFrameWrap');
  wrap.appendChild(frame);
  loadGameIntoFrame(frame, gameUrl, inst.version);

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
  window.__sclientModLoader = loaderOf(selected);
  if (notify) window.dispatchEvent(new CustomEvent('sclient:mod-instance', { detail: { id: modInstanceId, version: selected?.version || null, loader: loaderOf(selected) } }));
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
    const sel = instances.find(i => i.id === modInstanceId);
    const loaderNote = loaderOf(sel) === 'mangomod'
      ? 'MangoMod Loader is active: enabled mods run when you launch.'
      : 'Vanilla instance: mods are off. Switch this instance to MangoMod Loader (LOADER button in your Library) to use mods.';
    bar.innerHTML = `<span class="mod-bar-label">MODS FOR INSTANCE</span><select id="modInstanceSelect" class="mod-bar-select">${instances.map(i => `<option value="${esc(i.id)}" ${i.id === modInstanceId ? 'selected' : ''}>${esc(i.name)} · ${esc(i.version)}</option>`).join('')}</select><span class="loader-chip ${loaderOf(sel)}">${esc(LOADERS[loaderOf(sel)])}</span><span class="mod-bar-hint">${esc(loaderNote)}</span>`;
  }
  const imp = $('importModButton');
  if (imp) imp.disabled = !modInstanceId;
}

// ---- Mods tab: a download page. Mods are hosted in /mods/ and installed into one instance ----
let modIndexPromise = null;
const installedIdsByInstance = {};
const installedVersionsByInstance = {};
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0), pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}
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
    ${loaderOf(instances.find(i => i.id === selected)) === 'mangomod' ? '' : '<p class="loader-warning">This is a Vanilla instance. Switch it to MangoMod Loader (LOADER button in your Library) to install and run mods.</p>'}
    <div class="catalogue-grid">${mods.map(m => {
      const done = have.includes(m.id);
      const installedVersion = installedVersionsByInstance[selected]?.[m.id] || '';
      const updateAvailable = done && !!installedVersion && compareVersions(installedVersion, m.version) < 0;
      const compatibleVersions = Array.isArray(m.gameVersions) && m.gameVersions.length ? m.gameVersions.map(String) : (m.gameVersion ? [String(m.gameVersion)] : []);
      const compatible = !compatibleVersions.length || compatibleVersions.includes(String(instances.find(i => i.id === selected)?.version || ''));
      const versionsLabel = compatibleVersions.length ? compatibleVersions.join(' / ') : String(m.gameVersion || '?');
      const loaderOk = loaderOf(instances.find(i => i.id === selected)) === 'mangomod';
      const actionLabel = !loaderOk && !done ? 'NEEDS MANGOMOD' : !compatible ? `NOT FOR ${instances.find(i => i.id === selected)?.version || 'THIS VERSION'}` : updateAvailable ? '↻ UPDATE' : done ? '✓ INSTALLED' : '⬇ DOWNLOAD';
      return `<article class="catalogue-card" data-file="${esc(m.file)}">
        <div class="catalogue-icon">${esc(m.icon || '◇')}</div>
        <div class="catalogue-body">
          <h3>${esc(m.name)}</h3>
          <p>${esc(m.description || '')}</p>
          <div class="project-tags"><span>Aquavoid ${esc(versionsLabel)}</span><span>v${esc(m.version || '1.0.0')}</span>${(m.tags || []).map(t => `<span>${esc(t)}</span>`).join('')}</div>
          <div class="instance-meta"><span>by ${esc(m.author || 'Unknown')}</span>${updateAvailable ? `<span>Installed v${esc(installedVersion)}</span>` : ''}</div>
        </div>
        <div class="catalogue-action"><button class="primary-button" data-install="${esc(m.file)}" type="button" ${!compatible || !loaderOk || (done && !updateAvailable) ? 'disabled' : ''}>${actionLabel}</button>${done ? `<button class="soft-button danger" data-remove="${esc(m.id)}" type="button">REMOVE</button>` : ''}</div>
      </article>`;
    }).join('')}</div>`;
}
async function removeCatalogueMod(modId, button) {
  const instanceId = $('modCatalogue').dataset.instance;
  if (!window.SClientMods?.remove) { toast('The client is still loading. Try again in a moment.'); return; }
  button.disabled = true;
  try {
    setModInstance(instanceId, false);
    const name = await window.SClientMods.remove(instanceId, modId);
    await refreshInstalledIds(instanceId);
    toast(`${name} removed from ${instances.find(i => i.id === instanceId)?.name || 'your instance'}.${instanceId === activeInstanceId ? ' Relaunch the game to finish unloading it.' : ''}`);
  } catch (err) {
    console.error(err);
    toast(`Could not remove: ${err.message}`);
  }
  renderModCatalogue();
}
async function installCatalogueMod(file, button) {
  const instanceId = $('modCatalogue').dataset.instance;
  if (loaderOf(instances.find(i => i.id === instanceId)) !== 'mangomod') { toast('Switch this instance to MangoMod Loader to install mods.'); return; }
  if (!window.SClientMods?.install) { toast('The client is still loading. Try again in a moment.'); return; }
  button.disabled = true;
  button.textContent = 'DOWNLOADING…';
  try {
    const res = await fetch('mods/' + file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    setModInstance(instanceId, false);
    const instance = instances.find(item => item.id === instanceId);
    const name = await window.SClientMods.install(instanceId, raw, instance?.version, { enable: true });
    await refreshInstalledIds(instanceId);
    toast(`${name} installed and enabled for ${instances.find(i => i.id === instanceId)?.name || 'your instance'}. Launch (or relaunch) the game to use it.`);
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
    // The local file server only accepts [a-zA-Z0-9_-]{1,100}; normalise anything else.
    id: (String(raw.id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)) || ('inst_' + Math.random().toString(36).slice(2, 10)),
    name: String(raw.name || `Aquavoid ${version}`).replace(/\s+/g, ' ').trim().slice(0, 24) || `Aquavoid ${version}`,
    version,
    // Instances saved before loaders existed keep their mods working (MangoMod Loader).
    loader: raw.loader === 'vanilla' ? 'vanilla' : 'mangomod',
    createdAt: Number(raw.createdAt) || Date.now(),
    lastPlayed: Number(raw.lastPlayed) || 0,
    playSeconds: Math.max(0, Math.floor(Number(raw.playSeconds) || 0))
  };
}

async function toggleLoader(id) {
  const inst = instances.find(i => i.id === id);
  if (!inst) return;
  inst.loader = loaderOf(inst) === 'mangomod' ? 'vanilla' : 'mangomod';
  await persist();
  toast(`${inst.name} now uses ${LOADERS[inst.loader]}.${inst.id === activeInstanceId ? ' Relaunch the game to apply it.' : ''}`);
  renderLibrary();
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

function renderLibraryGrid() {
  const grid = $('instanceGrid');
  const cards = instances.map(inst => `
    <article class="instance-card ${inst.id === activeInstanceId ? 'is-running' : ''}" data-id="${esc(inst.id)}">
      <div class="instance-icon">A</div>
      <div class="instance-body">
        <h3>${esc(inst.name)}</h3>
        <div class="instance-meta"><span>Aquavoid ${esc(inst.version)}</span><span class="loader-chip ${loaderOf(inst)}">${esc(LOADERS[loaderOf(inst)])}</span><span>${esc(fmtTime(inst.playSeconds))}</span></div>
        <div class="instance-meta"><span>Installed ${esc(fmtDate(inst.createdAt))}</span>${inst.lastPlayed ? `<span>Last played ${esc(fmtDate(inst.lastPlayed))}</span>` : ''}</div>
      </div>
      <div class="instance-actions">
        <button class="primary-button" data-act="play" type="button">${inst.id === activeInstanceId ? '▶ RESUME' : '▶ PLAY'}</button>
        ${inst.id === activeInstanceId ? '<button class="soft-button" data-act="stop" type="button">■ STOP</button>' : ''}
        <button class="soft-button" data-act="mods" type="button">MODS</button>
        <button class="soft-button" data-act="loader" type="button">LOADER</button>
        <button class="soft-button" data-act="rename" type="button">RENAME</button>
        <button class="soft-button danger" data-act="delete" type="button">DELETE</button>
      </div>
    </article>`);
  for (let i = instances.length; i < MAX_INSTANCES; i++) {
    cards.push(`<article class="instance-card instance-empty"><div class="instance-icon ghost">＋</div><div class="instance-body"><h3>Empty slot</h3><div class="instance-meta"><span>Install Aquavoid 1.0 or 1.01</span></div></div><div class="instance-actions"><button class="outline-button" data-act="new" type="button">＋ INSTALL</button></div></article>`);
  }
  grid.innerHTML = cards.join('');
  renderCounts();
}

function renderLibrary() {
  renderLibraryGrid();
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

// A cloud write started from pagehide often never finishes, so a local backup of the
// play time is kept until the cloud write succeeds and is merged back on the next start.
const PLAYTIME_BACKUP_KEY = 'sclient.playtimeBackup';
function backupPlaytime(inst, extraSeconds = 0) {
  try {
    localStorage.setItem(PLAYTIME_BACKUP_KEY, JSON.stringify({ id: inst.id, playSeconds: inst.playSeconds + extraSeconds, lastPlayed: Date.now() }));
  } catch (_) { /* storage unavailable */ }
}
function clearPlaytimeBackup(id) {
  try {
    const b = JSON.parse(localStorage.getItem(PLAYTIME_BACKUP_KEY) || 'null');
    if (b && b.id === id) localStorage.removeItem(PLAYTIME_BACKUP_KEY);
  } catch (_) {}
}
function restorePlaytimeBackup() {
  try {
    const b = JSON.parse(localStorage.getItem(PLAYTIME_BACKUP_KEY) || 'null');
    if (!b) return;
    const inst = instances.find(i => i.id === b.id);
    if (inst && Number(b.playSeconds) > inst.playSeconds) {
      inst.playSeconds = Math.floor(Number(b.playSeconds));
      inst.lastPlayed = Math.max(inst.lastPlayed, Number(b.lastPlayed) || 0);
      Promise.resolve(persist()).then(() => clearPlaytimeBackup(inst.id)).catch(() => {});
    } else localStorage.removeItem(PLAYTIME_BACKUP_KEY);
  } catch (_) {}
}
function flushPlaytime() {
  const inst = instances.find(i => i.id === activeInstanceId);
  if (inst && unsavedSeconds > 0) {
    inst.playSeconds += unsavedSeconds;
    inst.lastPlayed = Date.now();
    unsavedSeconds = 0;
    backupPlaytime(inst);
    Promise.resolve(persist()).then(() => clearPlaytimeBackup(inst.id)).catch(() => {});
    // Only the instance grid shows play time; do not rebuild the mod catalogue (and re-read Firestore) each minute.
    renderLibraryGrid();
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
    catch (err) {
      console.error(err);
      // mountInstance() already tore down the previous frame, so do not keep reporting it as running.
      activeInstanceId = null;
      unsavedSeconds = 0;
      clearFrame();
      updatePlayHeader();
      renderLibrary();
      toast('Could not load this instance. Check your connection and try again.');
      return;
    }
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
  const loader = $('instanceLoaderSelect')?.value === 'mangomod' ? 'mangomod' : 'vanilla';
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
    setProgress(`Preparing Aquavoid ${version}…`, 5);
    await verifyVersionAvailable(version, setProgress);
    setProgress('Creating instance…', 100);
    await new Promise(r => setTimeout(r, 350));
  } catch (err) {
    console.error('Install failed:', err);
    failed = true;
    toast('Could not install this version. Check your connection and try again.');
  }
  // Re-check the cap right before committing (e.g. another tab filled the slots).
  if (failed) {
    // nothing is created when the download fails
  } else if (instances.length >= MAX_INSTANCES) {
    toast('Instance limit reached.');
  } else {
    instances.push({ id, name, version, loader, createdAt: Date.now(), lastPlayed: 0, playSeconds: 0 });
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
    else if (btn.dataset.act === 'loader') toggleLoader(id);
    else if (btn.dataset.act === 'rename') renameInstance(id);
    else if (btn.dataset.act === 'delete') deleteInstance(id);
  });
  $('newInstanceButton').addEventListener('click', openInstallPanel);
  $('modCatalogue').addEventListener('click', e => {
    const b = e.target.closest('button[data-install]');
    if (b) installCatalogueMod(b.dataset.install, b);
    const r = e.target.closest('[data-remove]');
    if (r) removeCatalogueMod(r.dataset.remove, r);
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
      const running = instances.find(i => i.id === activeInstanceId);
      if (running) backupPlaytime(running, unsavedSeconds);
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
  cleanupLegacyInstanceCache();
  restorePlaytimeBackup();
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

// Start as soon as Firebase Auth is valid and the minimal client/cloud API exists.
// Wait briefly for profile hydration so existing instances/settings are restored,
// but never let a Firestore outage keep the launcher from initializing.
let launcherInitStarted = false;
const wait = setInterval(() => {
  if (launcherInitStarted || !window.SClientCloud || !window.SCLIENT_BOOT) return;
  launcherInitStarted = true;
  clearInterval(wait);
  const hydration = window.SCLIENT_BOOT_READY || Promise.resolve(true);
  Promise.race([
    Promise.resolve(hydration).catch(() => false),
    new Promise(resolve => window.setTimeout(() => resolve(false), 7500))
  ]).finally(() => init());
}, 150);
