(() => {
  'use strict';

  const STORAGE_KEY = 'sclient.mods.v1';
  const GAME_URL_KEY = 'sclient.game-url.v1';
  const SUPPORTED_FEATURES = new Set(['freezeTimer', 'crystalMagnet', 'noDashCooldown', 'superJump']);
  const SUPPORTED_ACTIONS = new Set(['collectCrystal', 'refillTimer', 'setCoins', 'addCoins', 'addScore', 'unlockShips']);
  const STARTER_MOD = {"format":"sclient-mod","formatVersion":1,"id":"swell-hacks","name":"Swell Hacks","version":"1.0.0","author":"S-Client","game":"swell","description":"A local gameplay toolkit for Swell. Toggle movement and round advantages, then use quick actions while playing.","icon":"⚡","features":[{"id":"freezeTimer","name":"Freeze timer","description":"Keep the round timer from counting down.","defaultEnabled":false},{"id":"crystalMagnet","name":"Crystal magnet","description":"Pull the current crystal to your ship.","defaultEnabled":false},{"id":"noDashCooldown","name":"No dash cooldown","description":"Remove the dash cooldown.","defaultEnabled":false},{"id":"superJump","name":"Super jump","description":"Increase jump strength.","defaultEnabled":false}],"actions":[{"id":"collect-crystal","label":"Collect crystal","action":"collectCrystal"},{"id":"refill-timer","label":"Refill 90 sec","action":"refillTimer"},{"id":"add-coins","label":"+100 coins","action":"addCoins","value":100},{"id":"max-coins","label":"Set 999,999 coins","action":"setCoins","value":999999},{"id":"add-score","label":"+100 score","action":"addScore","value":100},{"id":"unlock-ships","label":"Unlock all ships","action":"unlockShips"}]};
  const $ = (id) => document.getElementById(id);
  const frame = $('game-frame');
  let mods = [];
  let gameConnected = false;
  let activeGameUrl = '';
  let activeGameOrigin = '';
  let connectSequence = 0;
  let lastState = null;
  let requestCounter = 0;
  let toastTimer = null;

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
  }

  function normalizeGameUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) throw new Error('Paste your GitHub Pages game URL first.');
    let parsed;
    try { parsed = new URL(value); } catch (_) { throw new Error('Enter a complete URL, including https://'); }
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Only public HTTP or HTTPS game URLs are supported.');
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
      throw new Error('Use the HTTPS GitHub Pages URL for your game.');
    }
    parsed.hash = '';
    return parsed;
  }

  function connectGame(rawUrl, { reload = false } = {}) {
    let target;
    try { target = normalizeGameUrl(rawUrl); }
    catch (error) { toast(error.message); return false; }

    activeGameUrl = target.href;
    activeGameOrigin = target.origin;
    const thisConnection = ++connectSequence;
    $('game-url').value = activeGameUrl;
    $('open-game-tab').disabled = false;
    try { localStorage.setItem(GAME_URL_KEY, activeGameUrl); } catch (_) {}

    gameConnected = false;
    lastState = null;
    setConnection(false, 'Loading GitHub Pages game…');
    $('game-placeholder').classList.remove('hidden');
    $('game-placeholder').innerHTML = '<div class="loader"></div><strong>Connecting to your Swell game…</strong><small>Waiting for the S-Client bridge to respond.</small>';
    if (reload) target.searchParams.set('_sclient_reload', String(Date.now()));
    frame.src = target.href;

    window.setTimeout(() => {
      if (thisConnection === connectSequence && !gameConnected && activeGameOrigin === target.origin) {
        $('game-placeholder').innerHTML = '<div class="placeholder-mark">!</div><strong>Game loaded, but no S-Client bridge was detected</strong><small>Deploy the updated game/app.js from the S-Client package to your GitHub Pages game repository, then reload.</small>';
        setConnection(false, 'Bridge not detected');
      }
    }, 12000);
    return true;
  }

  function setConnection(connected, detail) {
    gameConnected = connected;
    const dotClass = connected ? 'online' : 'offline';
    $('sidebar-dot').className = `status-dot ${dotClass}`;
    $('sidebar-status').textContent = connected ? 'Connected' : 'Disconnected';
    $('sidebar-detail').textContent = detail || (connected ? 'Swell is ready' : 'Waiting for Swell');
    $('top-status').innerHTML = `<i class="status-dot ${dotClass}"></i> ${connected ? 'Swell connected' : 'Game not connected'}`;
    $('game-hint').textContent = connected ? 'Connected · S-Client mod bridge ready' : 'Waiting for game connection…';
    $('round-status').textContent = connected ? (lastState?.running ? 'In a round' : 'At menu') : 'Not connected';
    $('game-placeholder').classList.toggle('hidden', connected);
    renderMods();
  }

  function postToGame(message) {
    if (!gameConnected || !frame.contentWindow) {
      toast('Open the Swell game first to use mod features.');
      return false;
    }
    frame.contentWindow.postMessage({ source: 'sclient', ...message }, activeGameOrigin || '*');
    return true;
  }

  function syncFeatures() {
    if (!gameConnected) return;
    const enabled = new Set();
    for (const item of mods) {
      if (!item.enabled) continue;
      for (const [featureId, isOn] of Object.entries(item.enabledFeatures || {})) {
        if (isOn && SUPPORTED_FEATURES.has(featureId)) enabled.add(featureId);
      }
    }
    for (const featureId of SUPPORTED_FEATURES) {
      postToGame({ type: 'set-feature', id: featureId, enabled: enabled.has(featureId) });
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mods));
      $('mod-count').textContent = String(mods.length);
      $('installed-count').textContent = `${mods.length} INSTALLED`;
      $('installed-summary').textContent = `${mods.length} mod${mods.length === 1 ? '' : 's'} in your local library`;
    } catch (error) {
      toast('Could not save your mod library. Browser storage may be full or disabled.');
    }
  }

  function normalizeInstalled(manifest, enabled = true, enabledFeatures = null) {
    const defaults = {};
    for (const feature of manifest.features || []) {
      defaults[feature.id] = Boolean(feature.defaultEnabled);
    }
    return {
      manifest,
      enabled: Boolean(enabled),
      enabledFeatures: { ...defaults, ...(enabledFeatures || {}) }
    };
  }

  function validateManifest(manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('The file is not a valid mod package.');
    if (manifest.format !== 'sclient-mod' || manifest.formatVersion !== 1) throw new Error('Unsupported .sclient format. This client supports format version 1.');
    if (manifest.game !== 'swell') throw new Error('This mod is not marked as compatible with Swell.');
    if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(manifest.id)) throw new Error('The mod ID must be 2–63 lowercase letters, numbers, or hyphens.');
    if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 80) throw new Error('The mod needs a name of at most 80 characters.');
    if (typeof manifest.version !== 'string' || manifest.version.length > 30) throw new Error('The mod needs a valid version string.');
    if (typeof manifest.description !== 'string' || manifest.description.length > 400) throw new Error('The mod description is missing or too long.');
    if (!Array.isArray(manifest.features) || manifest.features.length > 40) throw new Error('The mod features list is invalid or too large.');
    if (!Array.isArray(manifest.actions) || manifest.actions.length > 40) throw new Error('The mod actions list is invalid or too large.');

    const seenFeatures = new Set();
    for (const feature of manifest.features) {
      if (!feature || typeof feature.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(feature.id)) throw new Error('A feature has an invalid ID.');
      if (seenFeatures.has(feature.id)) throw new Error(`Duplicate feature ID: ${feature.id}`);
      seenFeatures.add(feature.id);
      if (typeof feature.name !== 'string' || !feature.name.trim() || feature.name.length > 80) throw new Error(`Feature ${feature.id} needs a name.`);
    }
    const seenActions = new Set();
    for (const action of manifest.actions) {
      if (!action || typeof action.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,49}$/.test(action.id)) throw new Error('An action has an invalid ID.');
      if (seenActions.has(action.id)) throw new Error(`Duplicate action ID: ${action.id}`);
      seenActions.add(action.id);
      if (typeof action.label !== 'string' || !action.label.trim() || action.label.length > 80) throw new Error(`Action ${action.id} needs a label.`);
      if (typeof action.action !== 'string') throw new Error(`Action ${action.id} has no API action.`);
      if (action.value !== undefined && (!Number.isFinite(Number(action.value)) || Math.abs(Number(action.value)) > 1000000000)) throw new Error(`Action ${action.id} has an invalid numeric value.`);
    }
    return manifest;
  }

  function downloadMod(item) {
    const blob = new Blob([JSON.stringify(item.manifest, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.manifest.id}.sclient`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Downloaded ${item.manifest.name}.sclient`);
  }

  function runAction(item, action) {
    if (!item.enabled) return toast('Enable this mod before using its actions.');
    if (!SUPPORTED_ACTIONS.has(action.action)) return toast('This action is not supported by the current Swell API.');
    const requestId = `sclient-${++requestCounter}`;
    postToGame({ type: 'action', action: action.action, value: action.value, requestId });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderMods() {
    const grid = $('mods-grid');
    grid.replaceChildren();
    $('mod-count').textContent = String(mods.length);
    $('installed-count').textContent = `${mods.length} INSTALLED`;
    $('installed-summary').textContent = `${mods.length} mod${mods.length === 1 ? '' : 's'} in your local library`;
    $('empty-state').classList.toggle('hidden', mods.length !== 0);

    for (const item of mods) {
      const mod = item.manifest;
      const card = el('article', `mod-card${item.enabled ? '' : ' disabled'}`);
      const top = el('div', 'mod-top');
      const icon = el('div', 'mod-icon', typeof mod.icon === 'string' && mod.icon.length <= 4 ? mod.icon : '◇');
      const info = el('div', 'mod-info');
      const titleRow = el('div', 'mod-title-row');
      titleRow.append(el('span', 'mod-title', mod.name), el('span', 'mod-version', `v${mod.version}`));
      info.append(titleRow, el('p', 'mod-desc', mod.description));
      const master = el('label', 'mod-toggle');
      master.append(document.createTextNode(item.enabled ? 'Enabled' : 'Disabled'));
      const masterInput = el('input', 'switch');
      masterInput.type = 'checkbox';
      masterInput.checked = item.enabled;
      masterInput.setAttribute('aria-label', `Enable ${mod.name}`);
      masterInput.addEventListener('change', () => {
        item.enabled = masterInput.checked;
        persist(); syncFeatures(); renderMods();
        toast(`${mod.name} ${item.enabled ? 'enabled' : 'disabled'}.`);
      });
      master.append(masterInput);
      top.append(icon, info, master);
      card.append(top);
      card.append(el('div', 'mod-meta', `${mod.author || 'Unknown author'}  ·  ${mod.game.toUpperCase()}  ·  ${mod.features.length} FEATURES`));
      card.append(el('div', 'mod-divider'));

      const featureHeading = el('div', 'feature-heading', 'FEATURES');
      card.append(featureHeading);
      const featureList = el('div', 'feature-list');
      for (const feature of mod.features) {
        const supported = SUPPORTED_FEATURES.has(feature.id);
        const row = el('div', `feature-row${supported ? '' : ' unsupported'}`);
        const label = el('label', '', feature.name);
        const right = el('div', '', '');
        const isOn = Boolean(item.enabledFeatures?.[feature.id]);
        if (supported) {
          const input = el('input', 'switch');
          input.type = 'checkbox';
          input.checked = isOn;
          input.disabled = !item.enabled;
          input.setAttribute('aria-label', `${feature.name} for ${mod.name}`);
          input.addEventListener('change', () => {
            item.enabledFeatures[feature.id] = input.checked;
            persist(); syncFeatures();
          });
          right.append(input);
        } else {
          right.append(el('span', 'unsupported-tag', 'API NOT AVAILABLE'));
        }
        row.append(label, right);
        if (feature.description) row.title = feature.description;
        featureList.append(row);
      }
      card.append(featureList);

      if (mod.actions.length) {
        card.append(el('div', 'mod-divider'));
        card.append(el('div', 'feature-heading', 'QUICK ACTIONS'));
        const actions = el('div', 'mod-actions');
        for (const action of mod.actions) {
          const button = el('button', 'mod-action-button', action.label);
          button.type = 'button';
          button.disabled = !item.enabled || !SUPPORTED_ACTIONS.has(action.action) || !gameConnected;
          button.title = !SUPPORTED_ACTIONS.has(action.action) ? 'This action is not supported by the current game API.' : (!gameConnected ? 'Connect to the game first.' : action.label);
          button.addEventListener('click', () => runAction(item, action));
          actions.append(button);
        }
        card.append(actions);
      }

      const bottom = el('div', 'mod-bottom');
      bottom.append(el('small', '', `ID: ${mod.id}`));
      const bottomActions = el('div', 'mod-bottom-actions');
      const download = el('button', 'mini-button', '↓ Download');
      download.type = 'button';
      download.addEventListener('click', () => downloadMod(item));
      const remove = el('button', 'mini-button danger', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        if (!window.confirm(`Remove ${mod.name} from this client?`)) return;
        mods = mods.filter((entry) => entry.manifest.id !== mod.id);
        persist(); syncFeatures(); renderMods(); toast(`${mod.name} removed.`);
      });
      bottomActions.append(download, remove);
      bottom.append(bottomActions);
      card.append(bottom);
      grid.append(card);
    }
  }

  function showView(name) {
    const isMods = name === 'mods';
    $('game-view').classList.toggle('hidden', isMods);
    $('mods-view').classList.toggle('hidden', !isMods);
    $('nav-game').classList.toggle('active', !isMods);
    $('nav-mods').classList.toggle('active', isMods);
    $('page-title').textContent = isMods ? 'MODS' : 'GAME';
    if (!isMods && gameConnected) postToGame({ type: 'request-state' });
  }

  function importFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.sclient')) {
      toast('Choose a file with the .sclient extension.'); return;
    }
    if (file.size > 512 * 1024) {
      toast('Mod files must be smaller than 512 KB.'); return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const manifest = validateManifest(JSON.parse(String(reader.result)));
        const duplicateIndex = mods.findIndex((entry) => entry.manifest.id === manifest.id);
        if (duplicateIndex >= 0 && !window.confirm(`${manifest.name} is already installed. Replace it?`)) return;
        const next = normalizeInstalled(manifest, true);
        if (duplicateIndex >= 0) mods[duplicateIndex] = next;
        else mods.push(next);
        persist(); syncFeatures(); renderMods();
        toast(`${manifest.name} imported successfully.`);
        showView('mods');
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not import this mod.');
      } finally {
        $('mod-file').value = '';
      }
    };
    reader.onerror = () => toast('The selected mod file could not be read.');
    reader.readAsText(file);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow || !event.data || event.data.source !== 'swell-game') return;
    if (activeGameOrigin && event.origin !== activeGameOrigin) return;
    const { type, payload } = event.data;
    if (type === 'ready') {
      setConnection(true, 'Game bridge ready');
      syncFeatures();
      postToGame({ type: 'request-state' });
    } else if (type === 'state' && payload) {
      lastState = payload;
      $('stat-coins').textContent = Number(payload.coins || 0).toLocaleString();
      $('stat-score').textContent = Number(payload.score || 0).toLocaleString();
      $('stat-speed').textContent = `${Number(payload.speed || 0).toFixed(1)}`;
      $('round-status').textContent = payload.running ? `In a round · ${payload.time}s left` : 'At menu';
      $('game-hint').textContent = payload.running ? `Playing · ${payload.ship || 'Swell'} · ${payload.time}s remaining` : `Connected · ${payload.ship || 'Swell'} selected`;
    } else if (type === 'action-result' && payload) {
      toast(payload.message || (payload.ok ? 'Action complete.' : 'Action failed.'));
      if (payload.ok) postToGame({ type: 'request-state' });
    }
  });

  $('nav-game').addEventListener('click', () => showView('game'));
  $('nav-mods').addEventListener('click', () => showView('mods'));
  $('open-mods-from-game').addEventListener('click', () => showView('mods'));
  $('browse-mods').addEventListener('click', () => $('mod-file').click());
  $('empty-import').addEventListener('click', () => $('mod-file').click());
  $('mod-file').addEventListener('change', (event) => importFile(event.target.files?.[0]));
  $('connect-game').addEventListener('click', () => connectGame($('game-url').value));
  $('game-url').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') connectGame($('game-url').value);
  });
  $('open-game-tab').addEventListener('click', () => {
    if (activeGameUrl) window.open(activeGameUrl, '_blank', 'noopener,noreferrer');
  });
  $('refresh-game').addEventListener('click', () => {
    if (activeGameUrl) connectGame(activeGameUrl, { reload: true });
    else toast('Paste your GitHub Pages game URL and connect first.');
  });
  frame.addEventListener('error', () => setConnection(false, 'Could not load the game URL'));

  function boot() {
    let hasSavedLibrary = false;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        hasSavedLibrary = true;
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          mods = parsed.filter((entry) => {
            try { validateManifest(entry.manifest); return true; } catch (_) { return false; }
          }).map((entry) => normalizeInstalled(entry.manifest, entry.enabled, entry.enabledFeatures));
        }
      }
    } catch (_) {
      mods = [];
      hasSavedLibrary = false;
      toast('Your saved mod list could not be read. A fresh mod library was created.');
    }

    // Install the bundled starter only on first launch. If a user removes it later,
    // the empty/saved library remains empty instead of silently reinstalling it.
    if (!hasSavedLibrary) {
      mods = [normalizeInstalled(validateManifest(STARTER_MOD), true)];
    }

    persist();
    renderMods();

    let savedGameUrl = '';
    try { savedGameUrl = localStorage.getItem(GAME_URL_KEY) || ''; } catch (_) {}
    const queryGameUrl = new URLSearchParams(window.location.search).get('game');
    const initialGameUrl = queryGameUrl || savedGameUrl;
    if (initialGameUrl) {
      $('game-url').value = initialGameUrl;
      connectGame(initialGameUrl);
    }
  }

  boot();
})();
