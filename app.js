(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeJSON = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
  const toastRegion = $('toastRegion');
  const toast = message => {
    const node = document.createElement('div');
    node.className = 'toast';
    node.textContent = String(message);
    toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 3200);
  };
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // The game save is namespaced to S-Client and never touches the normal Swell save.
  const SAVE_KEY = 'sclient-swell-save-v2';
  const BEST_KEY = 'sclient-swell-best-v2';
  const MOD_KEY = 'sclient-installed-mods-v2';
  const storedSave = safeJSON(localStorage.getItem(SAVE_KEY), {});
  let coins = Math.max(0, Number(storedSave.coins) || 0);
  let ownedShips = Array.isArray(storedSave.ownedShips) ? storedSave.ownedShips : [0];
  let selectedShip = clamp(Number(storedSave.selectedShip) || 0, 0, 5);
  let ownedWeapons = Array.isArray(storedSave.ownedWeapons) ? storedSave.ownedWeapons : [0];
  let selectedWeapon = clamp(Number(storedSave.selectedWeapon) || 0, 0, 3);
  let unlockedLevel = clamp(Number(storedSave.unlockedLevel) || 1, 1, 12);
  let bestScore = Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0);

  const SHIPS = [
    {name:'Sloop',cost:0,hull:0x8a5a34,sail:0xf6efe0,flag:0xff6b8a},
    {name:'Galleon',cost:30,hull:0xc4455f,sail:0xffe3d9,flag:0xffc857},
    {name:'Catamaran',cost:60,hull:0x1b2540,sail:0x8fb8ff,flag:0xe8f4ef},
    {name:'Longship',cost:100,hull:0x1f6b4f,sail:0xd8f5e6,flag:0xffc857},
    {name:'Steamer',cost:200,hull:0xb8860b,sail:0xfff4c2,flag:0xc9184a},
    {name:'Ghost Ship',cost:350,hull:0xdfe9f0,sail:0xaee7ff,flag:0x2ec4b6}
  ];
  const WEAPONS = [
    {name:'Harpoon',cost:0,damage:1,rate:0.85,range:43,speed:42,colour:0xffc857,description:'Balanced starter weapon'},
    {name:'Burst Rifle',cost:90,damage:1,rate:0.48,range:49,speed:54,colour:0x68e0ef,description:'Faster shots and longer reach'},
    {name:'Ion Cannon',cost:170,damage:2,rate:0.95,range:58,speed:48,colour:0x9c9bff,description:'Heavy energy bolts'},
    {name:'Tempest',cost:300,damage:3,rate:0.7,range:64,speed:60,colour:0xff718d,description:'Powerful storm weapon'}
  ];

  function saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({coins, ownedShips, selectedShip, ownedWeapons, selectedWeapon, unlockedLevel}));
      localStorage.setItem(BEST_KEY, String(bestScore));
    } catch (error) { console.warn('S-Client save unavailable:', error); }
    updateCoinLabels();
  }
  function updateCoinLabels() {
    $('coinBalance').textContent = `COINS ${coins.toLocaleString()}`;
    $('shipCoins').textContent = `YOUR BALANCE  ·  ${coins.toLocaleString()} COINS`;
    $('weaponCoins').textContent = `YOUR BALANCE  ·  ${coins.toLocaleString()} COINS`;
  }

  // --------------------------- Navigation and menus ---------------------------
  let activeView = 'play';
  function setView(name) {
    activeView = name;
    document.querySelectorAll('.view').forEach(el => el.classList.toggle('view-active', el.id === `view-${name}`));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === name));
    if (name !== 'play') document.exitPointerLock?.();
    renderCheatPanel();
  }
  document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));

  function hideGameSheets() {
    ['levelPicker','shipShop','weaponShop'].forEach(id => $(id).classList.add('hidden'));
  }
  function showMainMenu() {
    running = false;
    paused = false;
    hideGameSheets();
    $('pauseScreen').classList.add('hidden');
    $('card').classList.remove('hidden');
    $('hud').classList.add('hidden');
    $('healthPanel').classList.add('hidden');
    $('gameHint').classList.add('hidden');
    $('touchControls').classList.remove('active');
    $('pauseButton').disabled = true;
    $('modePill').textContent = 'MENU';
    $('resultText').textContent = '';
    $('card').style.display = 'flex';
    document.exitPointerLock?.();
    updateCoinLabels();
  }
  function openSheet(id) {
    $('card').classList.add('hidden');
    hideGameSheets();
    $(id).classList.remove('hidden');
  }
  function closeSheet() {
    hideGameSheets();
    $('card').classList.remove('hidden');
  }

  $('levelsButton').addEventListener('click', () => { renderLevels(); openSheet('levelPicker'); });
  $('endlessButton').addEventListener('click', () => startGame('endless', 0));
  $('shipShopButton').addEventListener('click', () => { renderShipShop(); openSheet('shipShop'); });
  $('weaponShopButton').addEventListener('click', () => { renderWeaponShop(); openSheet('weaponShop'); });
  $('closeLevels').addEventListener('click', closeSheet);
  $('closeShipShop').addEventListener('click', closeSheet);
  $('closeWeaponShop').addEventListener('click', closeSheet);
  $('pauseButton').addEventListener('click', () => setPaused(!paused));
  $('resumeButton').addEventListener('click', () => setPaused(false));
  $('leaveButton').addEventListener('click', showMainMenu);

  function renderLevels() {
    const grid = $('levelGrid'); grid.replaceChildren();
    for (let level = 1; level <= 12; level++) {
      const unlocked = level <= unlockedLevel;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `shop-item${level === unlockedLevel ? ' selected' : ''}`;
      button.disabled = !unlocked;
      button.innerHTML = `<span class="shop-swatch" style="background:linear-gradient(90deg,#2ec4b6,#ffc857)"></span><strong>LEVEL ${level}</strong><small>${unlocked ? (level === unlockedLevel ? 'NEXT UP' : 'UNLOCKED') : 'LOCKED'}</small>`;
      button.addEventListener('click', () => startGame('level', level));
      grid.appendChild(button);
    }
  }
  function renderShipShop() {
    const grid = $('shipGrid'); grid.replaceChildren();
    SHIPS.forEach((ship, index) => {
      const owned = ownedShips.includes(index);
      const button = document.createElement('button');
      button.type = 'button'; button.className = `shop-item${index === selectedShip ? ' selected' : ''}`;
      button.innerHTML = `<span class="shop-swatch" style="background:linear-gradient(90deg,${hex(ship.hull)},${hex(ship.sail)})"></span><strong>${escapeHTML(ship.name)}</strong><small>${index === selectedShip ? 'EQUIPPED' : owned ? 'EQUIP' : `${ship.cost} COINS`}</small>`;
      button.addEventListener('click', () => {
        if (owned) { selectedShip = index; $('shipNote').textContent = `${ship.name} equipped.`; }
        else if (coins >= ship.cost) { coins -= ship.cost; ownedShips.push(index); selectedShip = index; $('shipNote').textContent = `${ship.name} purchased and equipped.`; }
        else { $('shipNote').textContent = `You need ${(ship.cost - coins).toLocaleString()} more coins.`; }
        saveGame(); applyShip(); renderShipShop();
      });
      grid.appendChild(button);
    });
  }
  function renderWeaponShop() {
    const grid = $('weaponGrid'); grid.replaceChildren();
    WEAPONS.forEach((weapon, index) => {
      const owned = ownedWeapons.includes(index);
      const button = document.createElement('button');
      button.type = 'button'; button.className = `shop-item${index === selectedWeapon ? ' selected' : ''}`;
      button.innerHTML = `<span class="shop-swatch" style="background:${hex(weapon.colour)}"></span><strong>${escapeHTML(weapon.name)}</strong><small>${index === selectedWeapon ? 'EQUIPPED' : owned ? 'EQUIP' : `${weapon.cost} COINS`}</small>`;
      button.title = weapon.description;
      button.addEventListener('click', () => {
        if (owned) { selectedWeapon = index; $('weaponNote').textContent = `${weapon.name} equipped.`; }
        else if (coins >= weapon.cost) { coins -= weapon.cost; ownedWeapons.push(index); selectedWeapon = index; $('weaponNote').textContent = `${weapon.name} purchased and equipped.`; }
        else { $('weaponNote').textContent = `You need ${(weapon.cost - coins).toLocaleString()} more coins.`; }
        saveGame(); renderWeaponShop();
      });
      grid.appendChild(button);
    });
  }
  function hex(n) { return `#${Number(n).toString(16).padStart(6,'0')}`; }

  // --------------------------- Three.js game world ---------------------------
  let renderer, scene, camera, waterMesh, player, crystal, crystalBeam, stars;
  let waterGeometry, waterPositions, waterColours;
  let particles = [], enemies = [], bullets = [];
  let gameTime = 0, baseWave = 1.3, surge = 0, nextSurge = 30;
  let running = false, paused = false, mode = 'level', level = 1;
  let left = 90, score = 0, combo = 0, comboTimer = 0, health = 100;
  let vx = 0, vz = 0, vy = 0, grounded = false, dashCooldown = 0, shake = 0, shipHeading = 0, speedSmoothed = 0;
  let crystalIsTeal = false, spawnedCrystals = 0, roundElapsed = 0, nextEnemyAt = 8, lastFrame = performance.now(), lastFireAt = 0, lastSpace = false, lastDash = false;
  let yaw = 0, pitch = 0.55, joyX = 0, joyZ = 0, leftTouchId = null, rightTouchId = null, lookLastX = 0, lookLastY = 0, joyStartX = 0, joyStartY = 0, mouseDragging = false, mouseLastX = 0, mouseLastY = 0;
  const keys = Object.create(null);
  let audioContext;

  function initThree() {
    if (!window.THREE) { toast('Three.js did not load. Check your internet connection and reload S-Client.'); return false; }
    const stage = $('gameStage');
    try {
      renderer = new THREE.WebGLRenderer({antialias:true, alpha:false, powerPreference:'high-performance'});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(Math.max(1, $('world').clientWidth), Math.max(1, $('world').clientHeight));
      renderer.domElement.setAttribute('aria-label', 'Swell game canvas');
      renderer.domElement.tabIndex = 0;
      $('world').appendChild(renderer.domElement);
    } catch (error) {
      console.error(error); toast('WebGL could not start. Enable hardware acceleration in Chrome.'); return false;
    }
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x28456e);
    scene.fog = new THREE.Fog(0x28456e, 34, 72);
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 320);
    scene.add(new THREE.HemisphereLight(0xb9ddff, 0x0b2a55, 0.9));
    const sun = new THREE.DirectionalLight(0xffe2b8, 1.35); sun.position.set(-25, 18, -30); scene.add(sun);
    const fill = new THREE.DirectionalLight(0x6ad9ee, 0.35); fill.position.set(20, 4, 15); scene.add(fill);

    const starGeometry = new THREE.BufferGeometry(), starPositions = [];
    for (let i = 0; i < 500; i++) {
      const radius = 180, a = Math.random() * Math.PI * 2, b = Math.random() * 1.15 + 0.1;
      starPositions.push(Math.cos(a) * Math.cos(b) * radius, Math.sin(b) * radius, Math.sin(a) * Math.cos(b) * radius);
    }
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({color:0xe8f4ff,size:0.52,fog:false})); scene.add(stars);

    const count = 61, spacing = 1.8, half = (count - 1) / 2;
    waterGeometry = new THREE.PlaneGeometry((count - 1) * spacing, (count - 1) * spacing, count - 1, count - 1);
    waterGeometry.rotateX(-Math.PI / 2);
    waterPositions = waterGeometry.attributes.position;
    waterColours = new Float32Array(count * count * 3);
    waterGeometry.setAttribute('color', new THREE.BufferAttribute(waterColours, 3));
    const low = new THREE.Color(0x06284a), middle = new THREE.Color(0x0f7c8f), high = new THREE.Color(0x6fd0c8), foam = new THREE.Color(0xf2fbff), work = new THREE.Color();
    waterMesh = new THREE.Mesh(waterGeometry, new THREE.MeshStandardMaterial({vertexColors:true, roughness:0.24, metalness:0.1}));
    waterMesh.frustumCulled = false; scene.add(waterMesh);
    waterMesh.userData = {count, spacing, half, low, middle, high, foam, work};

    player = new THREE.Group(); scene.add(player); player.scale.setScalar(1.25);
    buildPlayerModel();

    crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.72, 0), new THREE.MeshLambertMaterial({color:0xffc857,emissive:0xffa000,emissiveIntensity:0.85}));
    scene.add(crystal);
    crystalBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.045,48,6), new THREE.MeshBasicMaterial({color:0xffc857,transparent:true,opacity:0.22,depthWrite:false})); scene.add(crystalBeam);

    // Touch controls and input are scoped to the game stage, not the entire client UI.
    bindGameInput();
    const resize = () => resizeRenderer();
    window.addEventListener('resize', resize);
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
    resizeRenderer();
    applyShip();
    spawnCrystal();
    requestAnimationFrame(frame);
    return true;
  }

  const hullMaterial = new THREE.MeshStandardMaterial({color:0x8a5a34,roughness:0.72});
  const sailMaterial = new THREE.MeshStandardMaterial({color:0xf6efe0,roughness:0.9,side:THREE.DoubleSide});
  let flagMesh;
  function buildPlayerModel() {
    const addMesh = (geometry, material, x, y, z) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x,y,z); player.add(mesh); return mesh; };
    addMesh(new THREE.BoxGeometry(1.3,0.6,2.6), hullMaterial, 0,0.05,0);
    const bow = new THREE.ConeGeometry(0.92,1.3,4); bow.rotateY(Math.PI/4); bow.rotateX(-Math.PI/2); const nose = addMesh(bow,hullMaterial,0,0.05,-1.95); nose.scale.set(1,0.46,1);
    addMesh(new THREE.CylinderGeometry(0.05,0.06,3.2,8),hullMaterial,0,1.9,0);
    addMesh(new THREE.PlaneGeometry(1.7,2.2),sailMaterial,0,2,-0.05);
    flagMesh = addMesh(new THREE.PlaneGeometry(0.55,0.3),new THREE.MeshBasicMaterial({color:0xff6b8a,side:THREE.DoubleSide}),0.3,3.35,0);
  }
  function clearPlayerChildren() {
    while (player.children.length) {
      const child = player.children.pop();
      if (child.parent) child.parent.remove(child);
    }
  }
  function applyShip() {
    const ship = SHIPS[selectedShip] || SHIPS[0];
    hullMaterial.color.setHex(ship.hull); sailMaterial.color.setHex(ship.sail);
    if (flagMesh) flagMesh.material.color.setHex(ship.flag);
  }
  const waveHeight = (x,z,time) => baseWave * (1 + surge) * (0.6*Math.sin(0.28*x+1.1*time) + 0.5*Math.sin(0.23*z-0.8*time+1) + 0.4*Math.sin(0.2*(x+z)+0.6*time));
  function updateWater(time, centerX, centerZ) {
    const data = waterMesh.userData, {count,spacing,half,low,middle,high,foam,work} = data;
    const originX = Math.round(centerX / spacing) * spacing, originZ = Math.round(centerZ / spacing) * spacing;
    waterMesh.position.set(originX,0,originZ);
    let index = 0;
    const waveAmp = baseWave * (1 + surge) * 1.5;
    for (let row=0; row<count; row++) for (let col=0; col<count; col++) {
      const x = (col-half)*spacing, z=(row-half)*spacing;
      const y = waveHeight(originX+x,originZ+z,time);
      waterPositions.setXYZ(index,x,y,z);
      const k = clamp((y/waveAmp+1)/2,0,1);
      if (k < 0.55) work.copy(low).lerp(middle,k/0.55);
      else if (k < 0.88) work.copy(middle).lerp(high,(k-0.55)/0.33);
      else work.copy(high).lerp(foam,(k-0.88)/0.12);
      waterColours[index*3]=work.r; waterColours[index*3+1]=work.g; waterColours[index*3+2]=work.b;
      index++;
    }
    waterPositions.needsUpdate = true; waterGeometry.attributes.color.needsUpdate = true; waterGeometry.computeVertexNormals();
  }
  function spawnCrystal() {
    if (!player || !crystal) return;
    spawnedCrystals++;
    crystalIsTeal = spawnedCrystals % 5 === 0;
    const colour = crystalIsTeal ? 0x2ec4b6 : 0xffc857;
    crystal.material.color.setHex(colour); crystal.material.emissive.setHex(crystalIsTeal ? 0x00a896 : 0xffa000);
    crystalBeam.material.color.setHex(colour);
    const angle = Math.random()*Math.PI*2, radius = 14 + Math.random()*30;
    crystal.position.set(player.position.x+Math.cos(angle)*radius,2+Math.random()*2.5,player.position.z+Math.sin(angle)*radius);
    crystalBeam.position.set(crystal.position.x,crystal.position.y,crystal.position.z);
  }
  function playBeep(frequency, duration=0.12, type='sine', volume=0.12) {
    if (!audioContext) return;
    try { const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type=type;osc.frequency.value=frequency;gain.gain.setValueAtTime(volume,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,audioContext.currentTime+duration);osc.connect(gain).connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+duration); } catch {}
  }
  function emitParticles(position, colour, amount, spread) {
    if (!scene) return;
    for (let i=0; i<Math.min(amount,24); i++) {
      const material = new THREE.MeshBasicMaterial({color:colour,transparent:true,opacity:0.95});
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.055+Math.random()*0.06,5,5),material);
      mesh.position.copy(position); mesh.userData.velocity = new THREE.Vector3((Math.random()-0.5)*spread,(Math.random()-0.3)*spread,(Math.random()-0.5)*spread); mesh.userData.life=0.65+Math.random()*0.45;
      scene.add(mesh); particles.push(mesh);
    }
  }
  function updateParticles(dt) {
    for (let i=particles.length-1;i>=0;i--) {
      const particle=particles[i]; particle.userData.life-=dt; particle.userData.velocity.y-=6*dt; particle.position.addScaledVector(particle.userData.velocity,dt); particle.material.opacity=clamp(particle.userData.life,0,1);
      if (particle.userData.life<=0) { scene.remove(particle); particle.geometry.dispose(); if (particle.material !== undefined) particle.material.dispose(); particles.splice(i,1); }
    }
  }

  // --------------------------- New update systems: hull + weapons ---------------------------
  function makeMonster() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({color:0x9b4b75,roughness:0.5,emissive:0x310b25,emissiveIntensity:0.35});
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.9,12,10),bodyMat); group.add(body);
    const eyeMat = new THREE.MeshBasicMaterial({color:0xffd7a0});
    for (const side of [-1,1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13,8,8),eyeMat); eye.position.set(side*0.36,0.22,-0.72); group.add(eye); }
    const tentacleMat = new THREE.MeshStandardMaterial({color:0x633052,roughness:0.8});
    for (let n=0;n<5;n++) { const tentacle = new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.15,1.45,6),tentacleMat); const a=n/5*Math.PI*2; tentacle.position.set(Math.cos(a)*0.6,-0.75,Math.sin(a)*0.6); tentacle.rotation.z=Math.cos(a)*0.42; tentacle.rotation.x=Math.sin(a)*0.42; group.add(tentacle); }
    const angle=Math.random()*Math.PI*2, radius=30+Math.random()*18;
    group.position.set(player.position.x+Math.cos(angle)*radius,waveHeight(player.position.x,player.position.z,gameTime)+2,player.position.z+Math.sin(angle)*radius);
    scene.add(group);
    enemies.push({mesh:group,hp:2+(level>1?Math.floor(level/3):0),damageClock:0,phase:Math.random()*Math.PI*2});
  }
  function fireAtEnemy(now) {
    if (!enemies.length || now-lastFireAt < WEAPONS[selectedWeapon].rate*1000) return;
    const weapon=WEAPONS[selectedWeapon]; let target=null,dist=weapon.range;
    for (const enemy of enemies) { const d=player.position.distanceTo(enemy.mesh.position); if (d<dist) {dist=d;target=enemy;} }
    if (!target) return;
    lastFireAt=now;
    const direction=target.mesh.position.clone().sub(player.position).normalize();
    const material=new THREE.MeshBasicMaterial({color:weapon.colour});
    const bolt=new THREE.Mesh(new THREE.SphereGeometry(0.16,7,7),material);
    bolt.position.copy(player.position); bolt.position.y+=0.7; scene.add(bolt);
    bullets.push({mesh:bolt,direction,speed:weapon.speed,damage:weapon.damage,life:weapon.range/weapon.speed+0.25});
  }
  function updateCombat(dt, now) {
    if (roundElapsed>=nextEnemyAt) {
      makeMonster(); nextEnemyAt += mode==='endless' ? 13 : Math.max(12,23-level*0.45);
      banner('SEA MONSTER INCOMING');
    }
    fireAtEnemy(now);
    for (let i=bullets.length-1;i>=0;i--) {
      const bullet=bullets[i]; bullet.life-=dt; bullet.mesh.position.addScaledVector(bullet.direction,bullet.speed*dt);
      let hit=false;
      for (let j=enemies.length-1;j>=0;j--) {
        const enemy=enemies[j];
        if (bullet.mesh.position.distanceTo(enemy.mesh.position)<1.15) {
          enemy.hp-=bullet.damage; hit=true; emitParticles(enemy.mesh.position,WEAPONS[selectedWeapon].colour,7,3);
          if (enemy.hp<=0) { scene.remove(enemy.mesh); enemies.splice(j,1); score+=3; $('s').textContent=score; playBeep(680,0.08,'triangle',0.06); }
          break;
        }
      }
      if (hit || bullet.life<=0) { scene.remove(bullet.mesh); bullet.mesh.geometry.dispose(); bullet.mesh.material.dispose(); bullets.splice(i,1); }
    }
    for (let i=enemies.length-1;i>=0;i--) {
      const enemy=enemies[i]; const toward=player.position.clone().sub(enemy.mesh.position); toward.y=0;
      const distance=toward.length(); if (distance>0.001) enemy.mesh.position.addScaledVector(toward.normalize(),(mode==='endless'?2.0:1.3+level*0.04)*dt);
      enemy.phase+=dt*3; enemy.mesh.position.y=waveHeight(enemy.mesh.position.x,enemy.mesh.position.z,gameTime)+1.6+Math.sin(enemy.phase)*0.22;
      enemy.mesh.rotation.y+=dt*0.7;
      enemy.damageClock-=dt;
      if (distance<2.15 && enemy.damageClock<=0) { enemy.damageClock=1.1; damagePlayer(12); }
    }
  }
  function damagePlayer(amount) {
    if (!running || paused) return;
    health=clamp(health-amount,0,100); updateHealth(); shake=0.35;
    banner('HULL DAMAGED');
    if (health<=0) endRound(false,'Your ship was overwhelmed.');
  }
  function updateHealth() {
    $('healthFill').style.width=`${health}%`; $('healthText').textContent=`${Math.ceil(health)}%`;
  }

  // --------------------------- Input fixes ---------------------------
  function bindGameInput() {
    const canvas = renderer.domElement;
    canvas.addEventListener('click', () => {
      if (running && !paused && window.matchMedia('(pointer:fine)').matches && document.pointerLockElement !== canvas) {
        try { canvas.requestPointerLock?.(); } catch {}
      }
    });
    document.addEventListener('mousemove', event => {
      if (!running || paused) return;
      if (document.pointerLockElement === canvas) look(event.movementX,event.movementY);
      else if (mouseDragging) { look(event.clientX-mouseLastX,event.clientY-mouseLastY); mouseLastX=event.clientX; mouseLastY=event.clientY; }
    });
    document.addEventListener('pointerup', event => { if (event.pointerType === 'mouse') mouseDragging=false; });
    canvas.addEventListener('pointerdown', event => {
      if (!running || paused) return;
      if (event.pointerType === 'mouse') { mouseDragging=true; mouseLastX=event.clientX; mouseLastY=event.clientY; return; }
      if (event.pointerType !== 'touch') return;
      event.preventDefault();
      try { canvas.setPointerCapture(event.pointerId); } catch {}
      const rect=canvas.getBoundingClientRect();
      if (event.clientX < rect.left+rect.width*0.5 && leftTouchId===null) { leftTouchId=event.pointerId; joyStartX=event.clientX; joyStartY=event.clientY; joyX=joyZ=0; }
      else if (rightTouchId===null) { rightTouchId=event.pointerId; lookLastX=event.clientX; lookLastY=event.clientY; }
    });
    canvas.addEventListener('pointermove', event => {
      if (!running || paused || event.pointerType!=='touch') return;
      if (event.pointerId===leftTouchId) { joyX=clamp((event.clientX-joyStartX)/55,-1,1); joyZ=clamp((event.clientY-joyStartY)/55,-1,1); }
      if (event.pointerId===rightTouchId) { look(event.clientX-lookLastX,event.clientY-lookLastY); lookLastX=event.clientX; lookLastY=event.clientY; }
    });
    const releaseTouch = event => { if (event.pointerId===leftTouchId) {leftTouchId=null;joyX=joyZ=0;} if(event.pointerId===rightTouchId)rightTouchId=null; };
    canvas.addEventListener('pointerup',releaseTouch); canvas.addEventListener('pointercancel',releaseTouch); canvas.addEventListener('lostpointercapture',releaseTouch);
    document.addEventListener('keydown', event => {
      if (event.code==='F2') { if (activeHackMod()) { event.preventDefault(); setCheatPanelCollapsed(!cheatPanelCollapsed); } return; }
      if (event.code==='Escape' && running && !paused) { event.preventDefault(); document.exitPointerLock?.(); setPaused(true); return; }
      if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
      keys[event.code]=true;
      if (running && ['Space','ShiftLeft','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)) event.preventDefault();
    });
    document.addEventListener('keyup', event => { keys[event.code]=false; });
    window.addEventListener('blur', () => { Object.keys(keys).forEach(key => keys[key]=false); joyX=joyZ=0; });
    bindTouchButton($('jumpButton'),'Space'); bindTouchButton($('dashButton'),'ShiftLeft');
  }
  function bindTouchButton(button, key) {
    const down=event=>{event.preventDefault();event.stopPropagation();keys[key]=true;try{button.setPointerCapture(event.pointerId);}catch{}};
    const up=event=>{event.preventDefault();keys[key]=false;};
    button.addEventListener('pointerdown',down); button.addEventListener('pointerup',up); button.addEventListener('pointercancel',up); button.addEventListener('lostpointercapture',up);
  }
  function look(dx,dy) { yaw-=dx*0.006; pitch=clamp(pitch+dy*0.005,0.06,1.35); }

  // --------------------------- Round state and game loop ---------------------------
  function startGame(nextMode, nextLevel) {
    if (!renderer) { toast('The game could not start because WebGL is unavailable.'); return; }
    try { audioContext=audioContext || new (window.AudioContext||window.webkitAudioContext)(); audioContext.resume?.(); } catch {}
    mode=nextMode; level=nextLevel||1; running=true; paused=false;
    left=90; score=0; combo=0; comboTimer=0; health=100; gameTime=0; roundElapsed=0; baseWave=1.3; surge=0; nextSurge=30; nextEnemyAt=8; spawnedCrystals=0;
    vx=vz=vy=0; grounded=false; dashCooldown=0; shake=0; shipHeading=0; speedSmoothed=0; lastFireAt=0; lastSpace=false; lastDash=false;
    yaw=0; pitch=0.55; joyX=joyZ=0; keys.Space=false; keys.ShiftLeft=false; keys.ShiftRight=false;
    clearDynamicObjects();
    player.position.set(0,3,0); player.rotation.set(0,0,0); spawnCrystal();
    $('card').classList.add('hidden'); hideGameSheets(); $('pauseScreen').classList.add('hidden');
    $('hud').classList.remove('hidden'); $('healthPanel').classList.remove('hidden'); $('gameHint').classList.remove('hidden');
    $('pauseButton').disabled=false; $('pauseButton').textContent='Ⅱ'; $('touchControls').classList.add('active');
    $('modePill').textContent=mode==='endless'?'ENDLESS':`LEVEL ${level}`;
    $('scoreLabel').textContent=mode==='endless'?'SCORE':'CRYSTALS'; $('timeLabel').textContent=mode==='endless'?'TIME':'TIME LEFT';
    $('s').textContent='0'; $('cb').textContent=''; $('t').textContent=mode==='endless'?'∞':'90';
    $('levelProgressWrap').classList.toggle('hidden',mode==='endless'); $('levelProgress').style.width='0%'; updateHealth();
    playBeep(440,0.18,'triangle',0.08);
  }
  function clearDynamicObjects() {
    enemies.forEach(e=>scene.remove(e.mesh)); enemies=[];
    bullets.forEach(b=>scene.remove(b.mesh)); bullets=[];
    particles.forEach(p=>{scene.remove(p);p.geometry.dispose();p.material.dispose();}); particles=[];
  }
  function setPaused(value) {
    if (!running) return;
    paused=!!value; $('pauseScreen').classList.toggle('hidden',!paused); $('pauseButton').textContent=paused?'▶':'Ⅱ';
    if (paused) document.exitPointerLock?.();
    else { lastFrame=performance.now(); $('gameHint').classList.remove('hidden'); }
  }
  function showBanner(message) {
    const node=$('ban'); node.textContent=message; node.classList.add('visible');
    clearTimeout(showBanner.timer); showBanner.timer=setTimeout(()=>node.classList.remove('visible'),1300);
  }
  function endRound(won, reason='') {
    if (!running) return;
    running=false; paused=false; document.exitPointerLock?.();
    const reward=score + (mode==='level' && won ? level*20 : 0);
    coins+=reward;
    let result;
    if (mode==='level' && won) {
      unlockedLevel=Math.max(unlockedLevel,Math.min(12,level+1));
      result=`LEVEL ${level} COMPLETE · +${reward} COINS`;
    } else if (mode==='level') result=`LEVEL ${level} FAILED · ${score}/${levelTarget(level)} CRYSTALS · +${reward} COINS`;
    else result=`ENDLESS OVER · SCORE ${score} · +${reward} COINS`;
    if (score>bestScore) bestScore=score;
    saveGame();
    $('resultText').textContent=reason ? `${reason} ${result}` : result;
    $('card').classList.remove('hidden'); $('card').style.display='flex'; $('hud').classList.add('hidden'); $('healthPanel').classList.add('hidden'); $('touchControls').classList.remove('active'); $('pauseButton').disabled=true; $('modePill').textContent='RESULT'; $('gameHint').classList.add('hidden');
  }
  function levelTarget(n) { return 6 + n*2; }
  function collectCrystal() {
    if (!running || paused) return false;
    combo=comboTimer>0?Math.min(combo+1,9):1; comboTimer=7;
    if (crystalIsTeal) {
      if (mode==='level') { left+=5; showBanner('+5 SECONDS'); }
      else { health=clamp(health+20,0,100); updateHealth(); showBanner('+20 HULL'); }
    }
    score+=combo; $('s').textContent=score; $('cb').textContent=combo>1?`×${combo}`:'';
    $('levelProgress').style.width=`${clamp(score/levelTarget(level)*100,0,100)}%`;
    shake=0.45; emitParticles(crystal.position,crystalIsTeal?0x2ec4b6:0xffc857,18,7); playBeep(500+combo*65,0.16,'triangle',0.14); spawnCrystal();
    if (mode==='level' && score>=levelTarget(level)) endRound(true);
    return true;
  }
  function updateGame(dt, now) {
    roundElapsed+=dt;
    if (mode==='level' && !(modFlag('freezeTimer'))) left-=dt;
    baseWave=1.3+roundElapsed*0.01;
    if (roundElapsed>nextSurge) { surge=0.4; nextSurge+=30; showBanner('WAVE SURGE'); playBeep(110,0.4,'sawtooth',0.11); }
    surge=Math.max(0,surge-dt*0.12);
    if (keys.KeyQ||keys.ArrowLeft) yaw+=2*dt;
    if (keys.KeyE||keys.ArrowRight) yaw-=2*dt;
    if (keys.ArrowUp) pitch=Math.max(0.06,pitch-1.5*dt);
    if (keys.ArrowDown) pitch=Math.min(1.35,pitch+1.5*dt);
    const ix=(keys.KeyD?1:0)-(keys.KeyA?1:0)+joyX;
    const iz=(keys.KeyS?1:0)-(keys.KeyW?1:0)+joyZ;
    const c=Math.cos(yaw),s=Math.sin(yaw);
    vx+=(ix*c+iz*s)*50*dt; vz+=(-ix*s+iz*c)*50*dt;
    const dashDown=!!(keys.ShiftLeft||keys.ShiftRight);
    const dashReady=modFlag('noDashCooldown') || dashCooldown<=0;
    if (dashDown && !lastDash && dashReady && Math.hypot(ix,iz)>0.05) {
      const length=Math.hypot(ix,iz); vx+=(ix*c+iz*s)/length*16; vz+=(-ix*s+iz*c)/length*16;
      dashCooldown=1.5; shake=0.23; playBeep(300,0.13,'square',0.07); emitParticles(player.position,0xe8f4ef,12,6);
    }
    lastDash=dashDown; dashCooldown=Math.max(0,dashCooldown-dt);
    const drag=Math.exp(-3*dt); vx*=drag; vz*=drag;
    player.position.x+=vx*dt; player.position.z+=vz*dt;
    vy-=13*dt; player.position.y+=vy*dt;
    const p=player.position, ground=waveHeight(p.x,p.z,gameTime)+0.6, groundVelocity=(waveHeight(p.x,p.z,gameTime+0.02)-waveHeight(p.x,p.z,gameTime))/0.02;
    const wasGrounded=grounded; grounded=false;
    if (p.y<=ground) { if(!wasGrounded&&vy<-4)emitParticles(p,0xff6b8a,8,4);p.y=ground;vy=Math.max(vy,groundVelocity*1.3);grounded=true; }
    const jumpDown=!!keys.Space;
    if (jumpDown && !lastSpace && grounded) { const boost=modFlag('superJump')?1.8:1; vy=11*boost+Math.max(groundVelocity,0);playBeep(520,0.1,'triangle',0.07);grounded=false; }
    lastSpace=jumpDown;
    const speed=Math.hypot(vx,vz);
    if (!grounded && speed>3 && Math.random()<0.3) emitParticles(p,0x6fd6c4,1,1.5);
    if (speed>1.5) { const targetHeading=Math.atan2(-vx,-vz); let difference=targetHeading-shipHeading; difference=Math.atan2(Math.sin(difference),Math.cos(difference));shipHeading+=difference*Math.min(1,dt*5); }
    const edge=0.6, slopeX=waveHeight(p.x+edge,p.z,gameTime)-waveHeight(p.x-edge,p.z,gameTime), slopeZ=waveHeight(p.x,p.z+edge,gameTime)-waveHeight(p.x,p.z-edge,gameTime);
    const slopeForward=(-slopeX*Math.sin(shipHeading)-slopeZ*Math.cos(shipHeading))/(2*edge), slopeSide=(slopeX*Math.cos(shipHeading)-slopeZ*Math.sin(shipHeading))/(2*edge);
    player.rotation.set(grounded?Math.atan(slopeForward):clamp(vy*0.04,-0.5,0.5),shipHeading,Math.atan(slopeSide),'YXZ');
    if (grounded && speed>3 && Math.random()<0.2) emitParticles(p,0xf2fbff,1,2);

    crystal.rotation.y+=dt*2; crystal.rotation.x+=dt; crystalBeam.position.set(crystal.position.x,crystal.position.y,crystal.position.z);
    if (modFlag('crystalMagnet')) { const d=crystal.position.distanceTo(p); if(d<36)crystal.position.lerp(new THREE.Vector3(p.x,p.y+0.6,p.z),Math.min(1,dt*(d<12?5:2.4))); }
    comboTimer-=dt; if(comboTimer<=0&&combo){combo=0;$('cb').textContent='';}
    if (p.distanceTo(crystal.position)<2.6) collectCrystal();
    updateCombat(dt,now);
    updateParticles(dt);
    if (mode==='level') {
      $('t').textContent=Math.ceil(Math.max(left,0));
      if (left<=0) endRound(score>=levelTarget(level));
    } else { $('t').textContent=`${Math.floor(roundElapsed/60)}:${String(Math.floor(roundElapsed%60)).padStart(2,'0')}`; }
    if (health<=0 && running) endRound(false,'Your hull was destroyed.');
  }
  function updateCamera(dt) {
    const p=player.position, speed=Math.hypot(vx,vz);
    speedSmoothed+=(speed-speedSmoothed)*Math.min(1,dt*5);
    // Keep the speed FOV bounded; the old unbounded speed multiplier could flip the camera.
    camera.fov=clamp(60+speedSmoothed*0.28,60,82); camera.updateProjectionMatrix();
    const cameraDistance=15, horizontal=Math.cos(pitch)*cameraDistance;
    const jitter=shake; shake=Math.max(0,shake-dt*1.5);
    camera.position.set(p.x+Math.sin(yaw)*horizontal+(Math.random()-0.5)*jitter,p.y+Math.sin(pitch)*cameraDistance+(Math.random()-0.5)*jitter,p.z+Math.cos(yaw)*horizontal);
    camera.position.y=Math.max(camera.position.y,waveHeight(camera.position.x,camera.position.z,gameTime)+2);
    camera.lookAt(p.x,p.y,p.z);
    stars.position.set(p.x,0,p.z);
  }
  function frame(now) {
    const dt=clamp((now-lastFrame)/1000,0,0.05); lastFrame=now;
    if (!paused) gameTime+=dt*0.7;
    if (running && !paused) updateGame(dt,now);
    else if (player && !running) { shipHeading+=dt*0.25; player.position.y=waveHeight(player.position.x,player.position.z,gameTime)+0.6; player.rotation.set(0,shipHeading,0); updateParticles(dt); }
    if (scene && renderer && camera) { updateWater(gameTime,player.position.x,player.position.z); updateCamera(dt); renderer.render(scene,camera); }
    requestAnimationFrame(frame);
  }
  function resizeRenderer() {
    if (!renderer || !camera) return;
    const w=Math.max(1,$('world').clientWidth),h=Math.max(1,$('world').clientHeight);
    renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
  }

  // --------------------------- Fullscreen ---------------------------
  $('fullscreenButton').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if ($('gameWindow').requestFullscreen) await $('gameWindow').requestFullscreen();
      else toast('Fullscreen is not available in this browser.');
    } catch (error) { toast('Chrome blocked fullscreen. Use the button again after interacting with the page.'); }
  });
  document.addEventListener('fullscreenchange', () => {
    $('fullscreenButton').textContent=document.fullscreenElement?'⛶':'⛶';
    resizeRenderer();
  });

  // --------------------------- S-Client mod format ---------------------------
  const SUPPORTED_FEATURES = new Set(['freezeTimer','crystalMagnet','noDashCooldown','superJump']);
  const SUPPORTED_ACTIONS = new Set(['collectCrystal','refillTimer','addCoins','setCoins','addScore','unlockShips']);
  let installedMods = safeJSON(localStorage.getItem(MOD_KEY), []);
  if (!Array.isArray(installedMods)) installedMods=[];
  installedMods=installedMods.filter(mod=>mod&&mod.manifest&&mod.manifest.format==='sclient-mod');
  let cheatPanelCollapsed=false;
  let cheatWidget=null;
  function saveMods() { try { localStorage.setItem(MOD_KEY,JSON.stringify(installedMods)); } catch { toast('Browser storage is full; mod settings could not be saved.'); } }
  function activeHackMod() { return installedMods.find(mod=>mod.enabled && (mod.manifest.id==='swell-hacks' || mod.manifest.game==='swell')); }
  function modFlag(featureId) { return installedMods.some(mod=>mod.enabled && mod.featureStates?.[featureId]===true); }
  function modFeatureSupported(id) { return SUPPORTED_FEATURES.has(id); }
  function normalizeManifest(raw) {
    if (!raw || raw.format!=='sclient-mod' || Number(raw.formatVersion)!==1) throw new Error('This is not a supported .sclient mod (format version 1 required).');
    if (String(raw.game||'').toLowerCase()!=='swell') throw new Error('This mod is not marked for Swell.');
    const id=String(raw.id||'').trim(); const name=String(raw.name||'').trim();
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(id) || !name || name.length>70) throw new Error('The mod ID or name is invalid.');
    const features=Array.isArray(raw.features)?raw.features.slice(0,30).map(f=>({id:String(f.id||''),name:String(f.name||f.id||'Feature').slice(0,60),description:String(f.description||'').slice(0,150),defaultEnabled:!!f.defaultEnabled})).filter(f=>/^[a-zA-Z0-9_-]{1,50}$/.test(f.id)):[];
    const actions=Array.isArray(raw.actions)?raw.actions.slice(0,30).map(a=>({id:String(a.id||''),label:String(a.label||a.id||'Action').slice(0,60),action:String(a.action||''),value:Number.isFinite(Number(a.value))?Number(a.value):undefined})).filter(a=>/^[a-zA-Z0-9_-]{1,50}$/.test(a.id)):[];
    if (!features.some(f=>modFeatureSupported(f.id)) && !actions.some(a=>SUPPORTED_ACTIONS.has(a.action))) throw new Error('This mod has no features or actions supported by this Swell build.');
    return {format:'sclient-mod',formatVersion:1,id,name,version:String(raw.version||'1.0.0').slice(0,24),author:String(raw.author||'Unknown').slice(0,60),game:'swell',description:String(raw.description||'').slice(0,220),icon:String(raw.icon||'◇').slice(0,4),features,actions};
  }
  function installManifest(raw) {
    const manifest=normalizeManifest(raw);
    const existing=installedMods.findIndex(mod=>mod.manifest.id===manifest.id);
    const featureStates={}; manifest.features.forEach(feature=>{featureStates[feature.id]=false;});
    const record={manifest,enabled:false,featureStates};
    if (existing>=0) installedMods[existing]=record; else installedMods.push(record);
    saveMods(); renderInstalledMods(); toast(`${manifest.name} imported. Enable it to use the mod.`);
  }
  function downloadManifest(manifest) {
    const blob=new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const anchor=document.createElement('a'); anchor.href=url; anchor.download=`${manifest.id}.sclient`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(()=>URL.revokeObjectURL(url),1200);
  }
  const HACK_MANIFEST = {
    format:'sclient-mod',formatVersion:1,id:'swell-hacks',name:'Swell Hacks',version:'1.1.0',author:'S-Client',game:'swell',icon:'⚡',
    description:'Optional local gameplay toolkit. Enable the mod to open its floating in-game menu, then switch individual features on or use quick actions.',
    features:[
      {id:'freezeTimer',name:'Freeze timer',description:'Keep the Levels timer from counting down.',defaultEnabled:false},
      {id:'crystalMagnet',name:'Crystal magnet',description:'Pull the current crystal toward your ship.',defaultEnabled:false},
      {id:'noDashCooldown',name:'No dash cooldown',description:'Dash whenever you have a movement direction.',defaultEnabled:false},
      {id:'superJump',name:'Super jump',description:'Increase jump strength.',defaultEnabled:false}
    ],
    actions:[
      {id:'collect-crystal',label:'Collect crystal',action:'collectCrystal'},
      {id:'refill-timer',label:'Refill 90 sec',action:'refillTimer'},
      {id:'add-coins',label:'+100 coins',action:'addCoins',value:100},
      {id:'max-coins',label:'Set 999,999 coins',action:'setCoins',value:999999},
      {id:'add-score',label:'+100 score',action:'addScore',value:100},
      {id:'unlock-ships',label:'Unlock all ships',action:'unlockShips'}
    ]
  };
  function runModAction(action) {
    if (!action || !SUPPORTED_ACTIONS.has(action.action)) { toast('This action is not supported by this Swell build.'); return; }
    switch (action.action) {
      case 'collectCrystal':
        if (running && !paused) { crystal.position.copy(player.position); crystal.position.y+=0.5; collectCrystal(); }
        else toast('Start a round before collecting a crystal.');
        break;
      case 'refillTimer':
        if (running && mode==='level') { left=90; $('t').textContent='90'; toast('Timer refilled to 90 seconds.'); }
        else toast('Refill timer is available during Levels.');
        break;
      case 'addCoins': coins+=clamp(Math.floor(action.value||100),0,1000000); saveGame(); toast('Coins added.'); break;
      case 'setCoins': coins=clamp(Math.floor(action.value||0),0,9999999); saveGame(); toast('Coin balance updated.'); break;
      case 'addScore': if(running){score+=clamp(Math.floor(action.value||100),0,100000);$('s').textContent=score;$('levelProgress').style.width=`${clamp(score/levelTarget(level)*100,0,100)}%`;toast('Score added.');}else toast('Start a round before adding score.'); break;
      case 'unlockShips': ownedShips=SHIPS.map((_,index)=>index);saveGame();renderShipShop();toast('All ships unlocked.');break;
    }
  }
  function renderInstalledMods() {
    $('modCount').textContent=String(installedMods.length); $('installedLabel').textContent=`${installedMods.length} INSTALLED`;
    const root=$('installedMods'); root.replaceChildren();
    if (!installedMods.length) {
      const empty=document.createElement('div'); empty.className='empty-state';
      empty.innerHTML='<div class="empty-icon">◇</div><h3>No mods installed</h3><p>Import a <code>.sclient</code> file to add your first mod. Nothing is preinstalled.</p><button class="outline-button" id="emptyImportButton" type="button">IMPORT A MOD</button>';
      empty.querySelector('button').addEventListener('click',()=> $('modFileInput').click()); root.appendChild(empty);
    }
    installedMods.forEach((record,index)=>{
      const manifest=record.manifest;
      const card=document.createElement('article'); card.className='installed-mod-card';
      const icon=document.createElement('div'); icon.className='mod-icon hack-icon'; icon.textContent=manifest.icon||'◇';
      const info=document.createElement('div'); info.className='available-mod-info';
      info.innerHTML=`<div class="available-title-row"><h3>${escapeHTML(manifest.name)}</h3><span class="optional-chip">${record.enabled?'ENABLED':'DISABLED'}</span></div><p>${escapeHTML(manifest.description||'Imported S-Client mod.')}</p><div class="mod-meta"><span>v${escapeHTML(manifest.version)}</span><span>·</span><span>${escapeHTML(manifest.author)}</span></div>`;
      const toggle=document.createElement('button'); toggle.type='button'; toggle.className=`toggle${record.enabled?' on':''}`; toggle.setAttribute('aria-label',record.enabled?'Disable mod':'Enable mod');
      toggle.addEventListener('click',()=>{record.enabled=!record.enabled;saveMods();renderInstalledMods();renderCheatPanel();toast(`${manifest.name} ${record.enabled?'enabled':'disabled'}.`);});
      const remove=document.createElement('button'); remove.type='button'; remove.className='download-button'; remove.textContent='REMOVE'; remove.addEventListener('click',()=>{installedMods.splice(index,1);saveMods();renderInstalledMods();renderCheatPanel();toast(`${manifest.name} removed.`);});
      card.append(icon,info,toggle,remove); root.appendChild(card);
    });
    renderCheatPanel();
  }
  $('importModButton').addEventListener('click',()=> $('modFileInput').click());
  $('emptyImportButton')?.addEventListener('click',()=> $('modFileInput').click());
  $('modFileInput').addEventListener('change',async event=>{
    const file=event.target.files?.[0]; if(!file)return;
    try { const raw=JSON.parse(await file.text()); installManifest(raw); }
    catch(error) { toast(error.message||'Could not import this .sclient file.'); }
    event.target.value='';
  });
  $('downloadHackButton').addEventListener('click',()=>downloadManifest(HACK_MANIFEST));

  function renderCheatPanel() {
    if (cheatWidget) { cheatWidget.remove(); cheatWidget=null; }
    const stage=$('gameStage');
    const enabled=installedMods.filter(mod=>mod.enabled);
    if (!enabled.length || activeView!=='play') return;
    if (cheatPanelCollapsed) {
      cheatWidget=document.createElement('button'); cheatWidget.type='button'; cheatWidget.className='cheat-minimized'; cheatWidget.textContent='⚡ MOD MENU';
      cheatWidget.addEventListener('click',()=>setCheatPanelCollapsed(false)); stage.appendChild(cheatWidget); return;
    }
    cheatWidget=document.createElement('div'); cheatWidget.className='cheat-widget';
    const head=document.createElement('div'); head.className='cheat-head';
    const title=document.createElement('div'); title.className='cheat-brand'; title.innerHTML='<i>⚡</i><span>S-CLIENT MOD MENU</span>';
    const close=document.createElement('button'); close.type='button'; close.className='cheat-close'; close.textContent='−'; close.title='Minimize menu'; close.addEventListener('click',()=>setCheatPanelCollapsed(true));
    head.append(title,close); cheatWidget.appendChild(head);
    enabled.forEach(record=>{
      const label=document.createElement('div');label.className='cheat-section';label.textContent=record.manifest.name.toUpperCase();cheatWidget.appendChild(label);
      record.manifest.features.forEach(feature=>{
        const row=document.createElement('div');row.className='cheat-feature';
        const copy=document.createElement('div');copy.innerHTML=`<span>${escapeHTML(feature.name)}</span><small>${escapeHTML(feature.description||'')}</small>`;
        const toggle=document.createElement('button');toggle.type='button';toggle.className=`toggle${record.featureStates?.[feature.id]?' on':''}`;toggle.setAttribute('aria-label',`${feature.name} ${record.featureStates?.[feature.id]?'on':'off'}`);
        toggle.addEventListener('click',()=>{record.featureStates[feature.id]=!record.featureStates[feature.id];saveMods();renderCheatPanel();});
        row.append(copy,toggle);cheatWidget.appendChild(row);
      });
      if (record.manifest.actions.length) {
        const actions=document.createElement('div');actions.className='cheat-actions';
        record.manifest.actions.forEach(action=>{
          if (!SUPPORTED_ACTIONS.has(action.action)) return;
          const button=document.createElement('button');button.type='button';button.className='cheat-action';button.textContent=action.label;button.addEventListener('click',()=>runModAction(action));actions.appendChild(button);
        });
        cheatWidget.appendChild(actions);
      }
    });
    stage.appendChild(cheatWidget);
  }
  function setCheatPanelCollapsed(value) { cheatPanelCollapsed=!!value;renderCheatPanel(); }

  // Public, narrow API used by declarative mods only. No uploaded JS is executed.
  window.SwellGame = Object.freeze({
    getState: () => Object.freeze({running,paused,mode,level,score,timeLeft:left,health,coins,ownedShips:[...ownedShips],selectedShip,selectedWeapon}),
    addCoins: amount => { coins=clamp(coins+Math.floor(Number(amount)||0),0,9999999);saveGame(); },
    setCoins: amount => { coins=clamp(Math.floor(Number(amount)||0),0,9999999);saveGame(); },
    addScore: amount => { if(running){score=clamp(score+Math.floor(Number(amount)||0),0,10000000);$('s').textContent=score;} },
    refillTimer: () => { if(running&&mode==='level'){left=90;$('t').textContent='90';} },
    collectCrystal: () => { if(running&&!paused){crystal.position.copy(player.position);crystal.position.y+=0.5;collectCrystal();} },
    unlockShips: () => { ownedShips=SHIPS.map((_,i)=>i);saveGame(); },
    getFeature: id => modFlag(String(id))
  });

  // --------------------------- Boot ---------------------------
  updateCoinLabels(); renderLevels(); renderShipShop(); renderWeaponShop(); renderInstalledMods();
  const initialized=initThree();
  if (initialized) showMainMenu();
  else $('card').classList.remove('hidden');
})();
