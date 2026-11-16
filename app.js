import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB5WMIaadItMKOygz-F47aYSmKoltPluF4',
  authDomain: 'kitacat-s-client.firebaseapp.com',
  projectId: 'kitacat-s-client',
  storageBucket: 'kitacat-s-client.firebasestorage.app',
  messagingSenderId: '460500639532',
  appId: '1:460500639532:web:633ababff0f23633aa5689',
  measurementId: 'G-8LHG10LZYS'
};

const firebaseApp = initializeApp(firebaseConfig);
const firebaseAuth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const authGate = document.getElementById('authGate');
const authStatus = document.getElementById('authStatus');
const signInButton = document.getElementById('googleSignInButton');
const retryButton = document.getElementById('authRetryButton');
const clientShell = document.querySelector('.client-shell');
const cloudStatusElement = document.getElementById('cloudStatus');
let signedInUid = null;
let cloudPendingWrites = 0;
let cloudWriteError = null;
let cloudHasSaved = false;

function showAuthMessage(message, isError = false) {
  authStatus.textContent = message;
  authStatus.classList.toggle('is-error', isError);
}
function updateCloudStatus() {
  if (!cloudStatusElement) return;
  cloudStatusElement.innerHTML = `<span class="live-dot"></span> ${cloudPendingWrites ? 'SYNCING…' : cloudWriteError ? 'SYNC ERROR' : cloudHasSaved ? 'CLOUD SAVED' : 'CLOUD CONNECTED'}`;
  cloudStatusElement.classList.toggle('has-error', !!cloudWriteError);
}
function makeCloudWriter(reference, label) {
  let queue = Promise.resolve();
  return data => {
    // JSON normalization strips undefined values and keeps only Firestore-safe plain data.
    const clean = JSON.parse(JSON.stringify(data));
    cloudPendingWrites++;
    updateCloudStatus();
    queue = queue.catch(() => {}).then(() => setDoc(reference, { ...clean, updatedAt: serverTimestamp() }, { merge: true }));
    queue.then(() => { cloudWriteError = null; cloudHasSaved = true; }).catch(error => {
      cloudWriteError = error;
      console.error(`S-Client ${label} save failed:`, error);
    }).finally(() => {
      cloudPendingWrites = Math.max(0, cloudPendingWrites - 1);
      updateCloudStatus();
    });
    return queue;
  };
}

async function bootstrapSignedInUser(user) {
  showAuthMessage('Loading your S-Client cloud profile…');
  retryButton.hidden = true;
  signInButton.disabled = true;
  const profileRef = doc(firestore, 'users', user.uid);
  const gameRef = doc(firestore, 'users', user.uid, 'game', 'swell');
  const modsRef = doc(firestore, 'users', user.uid, 'client', 'mods');
  try {
    const [profileSnapshot, gameSnapshot, modsSnapshot] = await Promise.all([
      getDoc(profileRef), getDoc(gameRef), getDoc(modsRef)
    ]);
    const now = serverTimestamp();
    const profile = {
      uid: user.uid,
      displayName: user.displayName || 'Swell Player',
      email: user.email || '',
      photoURL: user.photoURL || '',
      lastLoginAt: now
    };
    if (!profileSnapshot.exists()) profile.createdAt = now;
    await setDoc(profileRef, profile, { merge: true });

    const photo = document.getElementById('profilePhoto');
    const avatar = document.getElementById('profileAvatar');
    document.getElementById('profileName').textContent = user.displayName || user.email || 'PLAYER';
    if (user.photoURL) {
      photo.src = user.photoURL;
      photo.hidden = false;
      avatar.hidden = true;
    } else {
      avatar.textContent = (user.displayName || user.email || 'S').trim().charAt(0).toUpperCase();
      photo.hidden = true;
      avatar.hidden = false;
    }

    const modsDocument = modsSnapshot.exists() ? (modsSnapshot.data() || {}) : {};
    // Read the canonical installed[] array, and recover the numeric-key format
    // written by earlier S-Client builds before migrating it to the canonical shape.
    const restoredMods = Array.isArray(modsDocument.installed)
      ? modsDocument.installed
      : Object.keys(modsDocument)
          .filter(key => /^\d+$/.test(key))
          .sort((a, b) => Number(a) - Number(b))
          .map(key => modsDocument[key])
          .filter(Boolean);
    const needsModsMigration = !Array.isArray(modsDocument.installed) && restoredMods.length > 0;

    window.SCLIENT_BOOT = {
      gameSave: gameSnapshot.exists() ? gameSnapshot.data() : null,
      mods: restoredMods
    };
    window.SClientCloud = {
      user: { uid: user.uid, displayName: user.displayName || '', email: user.email || '' },
      saveGame: makeCloudWriter(gameRef, 'game'),
      saveMods: makeCloudWriter(modsRef, 'mods')
    };
    if (needsModsMigration) {
      await setDoc(modsRef, { installed: restoredMods, updatedAt: serverTimestamp() });
    }
    signedInUid = user.uid;
    clientShell.style.display = 'flex';
    authGate.hidden = true;
    showAuthMessage('Signed in. Your cloud profile is ready.');
    updateCloudStatus();
    return true;
  } catch (error) {
    console.error('S-Client Firestore bootstrap failed:', error);
    signInButton.disabled = false;
    retryButton.hidden = false;
    const detail = error?.code === 'permission-denied'
      ? 'Firestore denied access. Publish the S-Client owner-only Firestore rules from the setup instructions.'
      : `Could not load your Firestore data (${error?.code || 'connection error'}). Check Firestore is created and try again.`;
    showAuthMessage(detail, true);
    return false;
  }
}

try {
  await setPersistence(firebaseAuth, browserLocalPersistence);
} catch (persistenceError) {
  // Session persistence is a safe fallback if browser-level persistent storage is disabled.
  try { await setPersistence(firebaseAuth, browserSessionPersistence); }
  catch (error) { console.warn('Firebase Auth persistence fallback:', error || persistenceError); }
}

let resolveAuthReady;
const authReady = new Promise(resolve => { resolveAuthReady = resolve; });
let authReadyResolved = false;
let bootstrapInProgress = false;
let pendingUser = null;
async function tryBootstrap(user) {
  if (!user || bootstrapInProgress || signedInUid === user.uid) return;
  bootstrapInProgress = true;
  pendingUser = user;
  const ok = await bootstrapSignedInUser(user);
  bootstrapInProgress = false;
  if (ok && !authReadyResolved) {
    authReadyResolved = true;
    resolveAuthReady();
  }
}

signInButton.addEventListener('click', async () => {
  signInButton.disabled = true;
  showAuthMessage('Opening Google sign-in…');
  try {
    await signInWithPopup(firebaseAuth, googleProvider);
    showAuthMessage('Google account verified. Loading your cloud data…');
  } catch (error) {
    signInButton.disabled = false;
    const messages = {
      'auth/popup-closed-by-user': 'Sign-in was cancelled. Click the Google button when you are ready.',
      'auth/popup-blocked': 'Your browser blocked the sign-in popup. Allow popups for this GitHub Pages site and try again.',
      'auth/unauthorized-domain': 'This GitHub Pages domain is not authorized in Firebase Authentication settings.',
      'auth/operation-not-allowed': 'Google sign-in is not enabled in the Firebase project yet.'
    };
    showAuthMessage(messages[error?.code] || `Google sign-in failed (${error?.code || 'unknown error'}).`, true);
  }
});
retryButton.addEventListener('click', () => tryBootstrap(firebaseAuth.currentUser || pendingUser));
document.getElementById('signOutButton').addEventListener('click', async () => {
  const button = document.getElementById('signOutButton');
  button.disabled = true;
  try { await signOut(firebaseAuth); }
  catch (error) { button.disabled = false; console.error(error); }
});

onAuthStateChanged(firebaseAuth, user => {
  if (!user) {
    if (signedInUid) {
      // Reloading tears down the game loop before returning to the mandatory sign-in gate.
      window.location.reload();
      return;
    }
    clientShell.style.display = 'none';
    authGate.hidden = false;
    signInButton.disabled = false;
    showAuthMessage('Sign in is required before you can access the client.');
    return;
  }
  tryBootstrap(user);
});

await authReady;

(async () => {
'use strict';
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toastRegion = $('toastRegion');
function toast(message) {
    if (!toastRegion) return;
    const node = document.createElement('div');
    node.className = 'toast';
    node.textContent = String(message);
    toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 3000);
}
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let earlyView = 'play';
document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => {
    earlyView = button.dataset.view;
    document.querySelectorAll('.view').forEach(el => el.classList.toggle('view-active', el.id === `view-${earlyView}`));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === earlyView));
}));
const loadingCover = document.createElement('div');
loadingCover.className = 'renderer-loading';
loadingCover.textContent = 'LOADING SWELL UPDATE…';
$('gameStage').appendChild(loadingCover);
const threeReady = await Promise.race([window.__sclientThreeReady || Promise.resolve(!!window.THREE), new Promise(resolve => window.setTimeout(() => resolve(false), 10000))]);
if (!threeReady || !window.THREE) {
    loadingCover.className = 'renderer-error';
    loadingCover.textContent = 'Swell could not load its 3D renderer. Check your connection to the Three.js CDN and reload this page.';
    console.error('S-Client: Three.js did not load.');
    return;
}
const $stage = $('gameStage');
const $world = $('world');
let R;
try {
    R = new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance'});
} catch (error) {
    loadingCover.className = 'renderer-error';
    loadingCover.textContent = 'Swell needs WebGL. Enable hardware acceleration in Chrome, then reload S-Client.';
    console.error('S-Client WebGL initialization failed:', error);
    return;
}
R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
R.domElement.setAttribute('aria-label', 'Swell game canvas');
R.domElement.tabIndex = 0;
R.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none;';
$world.appendChild(R.domElement);
function worldSize() {
    const rect = $world.getBoundingClientRect();
    return {width:Math.max(1, rect.width), height:Math.max(1, rect.height)};
}
const initialSize = worldSize();
R.setSize(initialSize.width, initialSize.height, false);
const S = new THREE.Scene();
S.background = new THREE.Color(0x28456e);
S.fog = new THREE.Fog(0x28456e,30,60);
const C = new THREE.PerspectiveCamera(60,initialSize.width / initialSize.height,.1,300);
S.add(new THREE.HemisphereLight(0xaed6ff,0x0b2a55,.8));
const sun = new THREE.DirectionalLight(0xffe2b8,1.4);
sun.position.set(-25, 14, -30);
S.add(sun);
// stars
{
    const g = new THREE.BufferGeometry()
      , a = [];
    for (let i = 0; i < 500; i++) {
        const r = 180
          , u = Math.random() * 6.28
          , v = Math.random() * 1.2 + .1;
        a.push(Math.cos(u) * Math.cos(v) * r, Math.sin(v) * r, Math.sin(u) * Math.cos(v) * r)
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(a,3));
    window.stars = new THREE.Points(g,new THREE.PointsMaterial({
        color: 0xe8f4ef,
        size: .5,
        fog: false
    }));
    S.add(window.stars)
}

const N = 71
  , G = 1.6
  , H = (N - 1) / 2
  , LIM = H * G - 1;
let base = 1.6
  , surge = 0;
const amp = () => base * (1 + surge);
const h = (x, z, t) => amp() * (.6 * Math.sin(.28 * x + 1.1 * t) + .5 * Math.sin(.23 * z - .8 * t + 1) + .4 * Math.sin(.2 * (x + z) + .6 * t) + .22 * Math.sin(.55 * x - .4 * z - 1.7 * t) + .15 * Math.sin(.8 * z + x * .3 + 2.2 * t));
const pg0 = new THREE.PlaneGeometry((N - 1) * G,(N - 1) * G,N - 1,N - 1);
pg0.rotateX(-Math.PI / 2);
pg0.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * N * 3),3));
const mesh = new THREE.Mesh(pg0,new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: .22,
    metalness: .1
}));
mesh.frustumCulled = false;
S.add(mesh);
const lo = new THREE.Color(0x06284a)
  , mi = new THREE.Color(0x0f7c8f)
  , hi = new THREE.Color(0x6fd0c8)
  , fo = new THREE.Color(0xf2fbff)
  , col = new THREE.Color()
  , m4 = new THREE.Matrix4()
  , q = new THREE.Quaternion()
  , v3 = new THREE.Vector3()
  , sc = new THREE.Vector3();
function grid2(t, cx, cz) {
    const A = amp() * 1.5
      , ox = Math.round(cx / G) * G
      , oz = Math.round(cz / G) * G
      , pa = pg0.attributes.position
      , ca = pg0.attributes.color;
    mesh.position.set(ox, 0, oz);
    let i = 0;
    for (let b = 0; b < N; b++)
        for (let a = 0; a < N; a++) {
            const lx = (a - H) * G
              , lz = (b - H) * G
              , y = h(ox + lx, oz + lz, t);
            pa.setXYZ(i, lx, y, lz);
            const k = THREE.MathUtils.clamp((y / A + 1) / 2, 0, 1);
            if (k < .55)
                col.copy(lo).lerp(mi, k / .55);
            else if (k < .88)
                col.copy(mi).lerp(hi, (k - .55) / .33);
            else
                col.copy(hi).lerp(fo, (k - .88) / .12);
            ca.setXYZ(i, col.r, col.g, col.b);
            i++
        }
    pa.needsUpdate = true;
    ca.needsUpdate = true;
    pg0.computeVertexNormals()
}
const P = new THREE.Group();
S.add(P);
P.scale.setScalar(1.3);
let hd = 0;
let dashWasDown = false;
const wood = new THREE.MeshStandardMaterial({
    color: 0x8a5a34,
    roughness: .8
})
  , cloth = new THREE.MeshStandardMaterial({
    color: 0xf6efe0,
    roughness: .9,
    side: THREE.DoubleSide
});
const hull = new THREE.Mesh(new THREE.BoxGeometry(1.3,.6,2.6),wood);
hull.position.y = .05;
const bg = new THREE.ConeGeometry(.92,1.3,4);
bg.rotateY(Math.PI / 4);
bg.rotateX(-Math.PI / 2);
const bow = new THREE.Mesh(bg,wood);
bow.position.set(0, .05, -1.95);
bow.scale.set(1, .46, 1);
const mast = new THREE.Mesh(new THREE.CylinderGeometry(.05,.06,3.2,8),wood);
mast.position.set(0, 1.9, 0);
const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.7,2.2),cloth);
sail.position.set(0, 2.0, -.05);
const flag = new THREE.Mesh(new THREE.PlaneGeometry(.55,.3),new THREE.MeshBasicMaterial({
    color: 0xff6b8a,
    side: THREE.DoubleSide
}));
flag.position.set(.3, 3.35, 0);
P.add(hull, bow, mast, sail, flag);
const X = new THREE.Mesh(new THREE.OctahedronGeometry(.7),new THREE.MeshLambertMaterial({
    color: 0xffc857,
    emissive: 0xffa000,
    emissiveIntensity: .9
}));
S.add(X);
const beam = new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,60,6),new THREE.MeshBasicMaterial({
    color: 0xffc857,
    transparent: true,
    opacity: .35
}));
S.add(beam);
let teal = false
  , spawned = 0;
function spawn() {
    spawned++;
    teal = spawned % 5 === 0;
    const c = teal ? 0x2ec4b6 : 0xffc857;
    X.material.color.setHex(c);
    X.material.emissive.setHex(teal ? 0x00a896 : 0xffa000);
    beam.material.color.setHex(c);
    const a = Math.random() * 6.283
      , r = 14 + Math.random() * 30
      , c0 = P.position;
    X.position.set(c0.x + Math.cos(a) * r, 2 + Math.random() * 2.5, c0.z + Math.sin(a) * r);
    beam.position.set(X.position.x, X.position.y, X.position.z)
}

// particles
const PN = 400
  , pp = new Float32Array(PN * 3)
  , pv = new Float32Array(PN * 3)
  , pl = new Float32Array(PN)
  , pc = new Float32Array(PN * 3);
let pi = 0;
const pg = new THREE.BufferGeometry();
pg.setAttribute('position', new THREE.BufferAttribute(pp,3));
pg.setAttribute('color', new THREE.BufferAttribute(pc,3));
const pts = new THREE.Points(pg,new THREE.PointsMaterial({
    size: .35,
    vertexColors: true,
    transparent: true,
    opacity: .9,
    depthWrite: false
}));
pts.frustumCulled = false;
S.add(pts);
for (let i = 0; i < PN; i++)
    pp[i * 3 + 1] = -99;
function emit(p, hex, n, sp) {
    const c = new THREE.Color(hex);
    for (let k = 0; k < n; k++) {
        const i = pi++ % PN;
        pp.set([p.x, p.y, p.z], i * 3);
        pv.set([(Math.random() - .5) * sp, (Math.random() - .3) * sp, (Math.random() - .5) * sp], i * 3);
        pl[i] = .7 + Math.random() * .5;
        pc.set([c.r, c.g, c.b], i * 3)
    }
}
function parts(dt) {
    for (let i = 0; i < PN; i++) {
        if (pl[i] > 0) {
            pl[i] -= dt;
            pv[i * 3 + 1] -= 9 * dt;
            for (let a = 0; a < 3; a++)
                pp[i * 3 + a] += pv[i * 3 + a] * dt;
            if (pl[i] <= 0)
                pp[i * 3 + 1] = -99
        }
    }
    pg.attributes.position.needsUpdate = true;
    pg.attributes.color.needsUpdate = true
}

// audio
let AC;
function beep(f, d=.12, ty='sine', v=.15) {
    if (!AC)
        return;
    try {
        const o = AC.createOscillator()
          , g = AC.createGain();
        o.type = ty;
        o.frequency.value = f;
        g.gain.setValueAtTime(v, AC.currentTime);
        g.gain.exponentialRampToValueAtTime(.001, AC.currentTime + d);
        o.connect(g).connect(AC.destination);
        o.start();
        o.stop(AC.currentTime + d)
    } catch (e) {}
}

// Input is scoped to the embedded game viewport so the S-Client navigation and mod page remain usable.
const K = Object.create(null);
let activeView = 'play';
addEventListener('keydown', e => {
    if (e.code === 'Escape' && document.fullscreenElement) {
        // With Keyboard Lock, a normal Escape press pauses Swell but stays in
        // fullscreen. Browsers keep a long-press Escape override for user safety.
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat && run) setPaused(!paused);
        return;
    }
    if (activeView !== 'play') return;
    if (e.code === 'Escape') {
        if (run) { setPaused(!paused); e.preventDefault(); }
        return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
    K[e.code] = 1;
    if (['Space','ShiftLeft','ShiftRight','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
}, true);
addEventListener('keyup', e => { K[e.code] = 0; if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') dashWasDown = false; });
let yaw = 0, pitch = .55, drag = false, jx = 0, jz = 0, tj = null, tl = null, tlx = 0, tly = 0, tsx = 0, tsy = 0;
const look = (dx, dy) => { yaw -= dx * .006; pitch = THREE.MathUtils.clamp(pitch + dy * .005, .05, 1.4); };
let lx = 0, ly = 0;
addEventListener('mousemove', e => {
    const locked = !!document.pointerLockElement;
    if (!locked && !drag) return;
    const dx = locked ? e.movementX : e.clientX - lx;
    const dy = locked ? e.movementY : e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    if (locked || drag) look(dx, dy);
});
R.domElement.addEventListener('click', () => {
    if (!run || paused || activeView !== 'play') return;
    try { R.domElement.requestPointerLock?.(); } catch (e) {}
});
addEventListener('pointerdown', e => {
    if (!$stage.contains(e.target) || e.target.closest('button,.game-card,.sheet,.pause-screen,.cheat-widget,.cheat-minimized')) return;
    if (e.pointerType === 'mouse') { drag = true; lx = e.clientX; ly = e.clientY; }
    else {
        const rect = $stage.getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2 && tj === null) { tj = e.pointerId; tsx = e.clientX; tsy = e.clientY; }
        else if (e.clientX >= rect.left + rect.width / 2 && tl === null) { tl = e.pointerId; tlx = e.clientX; tly = e.clientY; }
    }
});
const releasePointer = e => {
    if (e.pointerType === 'mouse') drag = false;
    if (e.pointerId === tj) { tj = null; jx = jz = 0; }
    if (e.pointerId === tl) tl = null;
};
addEventListener('pointerup', releasePointer);
addEventListener('pointercancel', releasePointer);
addEventListener('pointermove', e => {
    if (e.pointerId === tl) { look(e.clientX - tlx, e.clientY - tly); tlx = e.clientX; tly = e.clientY; }
    if (e.pointerId === tj) { jx = THREE.MathUtils.clamp((e.clientX - tsx) / 50, -1, 1); jz = THREE.MathUtils.clamp((e.clientY - tsy) / 50, -1, 1); }
});
function bindHoldButton(button, code) {
    if (!button) return;
    const down = event => { event.preventDefault(); event.stopPropagation(); K[code] = 1; try { button.setPointerCapture(event.pointerId); } catch (e) {} };
    const up = event => { event.preventDefault(); event.stopPropagation(); K[code] = 0; if (code === 'ShiftLeft') dashWasDown = false; };
    button.addEventListener('pointerdown', down);
    ['pointerup','pointercancel','lostpointercapture'].forEach(type => button.addEventListener(type, up));
    button.addEventListener('contextmenu', e => e.preventDefault());
}
bindHoldButton($('jb'), 'Space');
bindHoldButton($('db'), 'ShiftLeft');
function resizeRenderer() {
    const size = worldSize();
    R.setSize(size.width, size.height, false);
    C.aspect = size.width / size.height;
    C.updateProjectionMatrix();
}
if (window.ResizeObserver) new ResizeObserver(resizeRenderer).observe($world);
addEventListener('resize', resizeRenderer);

const SKINS = [{
    n: 'Sloop',
    p: 0,
    hull: 0x8a5a34,
    sail: 0xf6efe0,
    flag: 0xff6b8a
}, {
    n: 'Galleon',
    p: 30,
    hull: 0xc4455f,
    sail: 0xffe3d9,
    flag: 0xffc857
}, {
    n: 'Catamaran',
    p: 60,
    hull: 0x1b2540,
    sail: 0x8fb8ff,
    flag: 0xe8f4ef
}, {
    n: 'Longship',
    p: 100,
    hull: 0x1f6b4f,
    sail: 0xd8f5e6,
    flag: 0xffc857
}, {
    n: 'Steamer',
    p: 200,
    hull: 0xb8860b,
    sail: 0xfff4c2,
    flag: 0xc9184a
}, {
    n: 'Ghost Ship',
    p: 350,
    hull: 0xdfe9f0,
    sail: 0xaee7ff,
    flag: 0x2ec4b6
}, {
    n: 'KitaCat Ship',
    p: 0,
    hull: 0x24243a,
    sail: 0x39245f,
    flag: 0x9b65ff,
    exclusive: true
}];
let coins = 0
  , owned = [0, 6]
  , sel = 0
  , unlocked = 0
  , bestWave = 0
  , wown = [0]
  , wsel = 0;
const initialCloudSave = window.SCLIENT_BOOT?.gameSave || {};
coins = Math.max(0, Number(initialCloudSave.coins) || 0);
owned = Array.isArray(initialCloudSave.owned) ? initialCloudSave.owned : [0];
sel = clamp(Number(initialCloudSave.sel) || 0, 0, SKINS.length - 1);
unlocked = Number(initialCloudSave.unlocked) || 0;
bestWave = Number(initialCloudSave.bestWave) || 0;
wown = Array.isArray(initialCloudSave.wown) ? initialCloudSave.wown : [0];
wsel = Number(initialCloudSave.wsel) || 0;
function save() {
    window.SClientCloud?.saveGame?.({coins, owned, sel, unlocked, bestWave, wown, wsel});
}
function showCoins() {
    $('coins').textContent = 'Coins: ' + coins;
    $('coins2').textContent = $('coins3').textContent = 'Coins: ' + coins
}
const SHAPE_OF = ['sloop', 'galleon', 'cat', 'long', 'steam', 'ghost', 'kitacat']
  , SHAPES = {};
const KITACAT_LOGO_DATA = 'data:image/png;base64,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';
const kitacatLogoTexture = new THREE.TextureLoader().load(KITACAT_LOGO_DATA);
kitacatLogoTexture.encoding = THREE.sRGBEncoding;
{
    const M = (g, m, x, y, z) => {
        const o = new THREE.Mesh(g,m);
        o.position.set(x, y, z);
        P.add(o);
        return o
    }
    ;
    const bx = (w, h, l) => new THREE.BoxGeometry(w,h,l)
      , cy = (r, h) => new THREE.CylinderGeometry(r,r,h,10)
      , pl = (w, h) => {
        const g = new THREE.PlaneGeometry(w,h,8,8)
          , a = g.attributes.position;
        for (let i = 0; i < a.count; i++)
            a.setZ(i, Math.sin((a.getX(i) / w + .5) * Math.PI) * .32 * (1 - (a.getY(i) / h + .5) * .4));
        g.computeVertexNormals();
        return g
    }
    ;
    const sailPanel = (w, h, x, y, z, rz = 0) => {
        const mesh = M(pl(w, h), cloth, x, y, z);
        // Face the bow. DoubleSide keeps the cloth visible from either camera angle.
        mesh.rotation.y = Math.PI;
        mesh.rotation.z = rz;
        return mesh;
    };
    const tip = (w, l, d) => {
        const g = new THREE.ConeGeometry(w * .7071,l,4);
        g.rotateY(Math.PI / 4);
        g.rotateX(d * Math.PI / 2);
        return g
    }
    ;
    const bow = (x, w, h, l, y, zc, d) => {
        M(tip(w, l, d), wood, x, y, zc).scale.y = h / w
    }
    ;
    SHAPES.sloop = () => {
        M(bx(1.3, .6, 2.6), wood, 0, .05, 0);
        bow(0, 1.3, .6, 1.3, .05, -1.95, -1);
        M(cy(.06, 3.2), wood, 0, 1.9, 0);
        sailPanel(1.7, 2.2, 0, 2, -.05);
        flag.position.set(.3, 3.35, 0);
        P.add(flag)
    }
    ;
    SHAPES.galleon = () => {
        M(bx(1.8, .8, 3), wood, 0, .1, 0);
        bow(0, 1.8, .8, 1.4, .1, -2.2, -1);
        M(bx(1.6, .7, 1), wood, 0, .85, 1.1);
        M(cy(.06, 3.6), wood, 0, 2.1, -.5);
        M(cy(.05, 2.6), wood, 0, 1.6, .9);
        sailPanel(1.9, 2.2, 0, 2.3, -.55);
        sailPanel(1.4, 1.6, 0, 1.9, .85);
        flag.position.set(.3, 3.75, -.5);
        P.add(flag)
    }
    ;
    SHAPES.cat = () => {
        for (const s of [-1, 1]) {
            M(bx(.45, .45, 3), wood, s * .8, 0, 0);
            bow(s * .8, .45, .45, 1, 0, -2, -1)
        }
        M(bx(2.1, .15, 1.8), wood, 0, .45, .1);
        M(cy(.05, 3.4), wood, 0, 2.1, -.2);
        sailPanel(1.2, 2.8, 0, 2.1, -.25);
        flag.position.set(.25, 3.8, -.2);
        P.add(flag)
    }
    ;
    SHAPES.long = () => {
        M(bx(1.1, .5, 3.2), wood, 0, 0, 0);
        bow(0, 1.1, .5, 1.6, 0, -2.4, -1);
        bow(0, 1.1, .5, 1.6, 0, 2.4, 1);
        M(new THREE.ConeGeometry(.2,.8,6), wood, 0, .6, -3.1);
        M(cy(.05, 3), wood, 0, 1.7, 0);
        sailPanel(2.3, 1.5, 0, 2.3, -.05);
        const sm = [new THREE.MeshStandardMaterial({
            color: 0xffc857
        }), new THREE.MeshStandardMaterial({
            color: 0xc4455f
        })];
        for (let k = 0; k < 6; k++)
            for (const s of [-1, 1]) {
                M(cy(.22, .06), sm[k % 2], s * .58, .2, -1.2 + k * .48).rotation.z = Math.PI / 2
            }
        flag.position.set(.3, 3.4, 0);
        P.add(flag)
    }
    ;
    SHAPES.steam = () => {
        M(bx(1.5, .7, 3), wood, 0, .1, 0);
        bow(0, 1.5, .7, 1.3, .1, -2.15, -1);
        M(bx(1.1, .8, 1.2), cloth, 0, .85, .4);
        M(cy(.28, 1.1), new THREE.MeshStandardMaterial({
            color: 0xc9184a
        }), 0, 1.7, .4);
        for (const s of [-1, 1])
            M(cy(.5, .2), wood, s * .85, .1, .6).rotation.z = Math.PI / 2;
        flag.position.set(0, 2.5, .4);
        P.add(flag)
    }
    ;
    SHAPES.ghost = () => {
        M(bx(1, .45, 3), wood, 0, 0, 0);
        bow(0, 1, .45, 1.5, 0, -2.25, -1);
        M(bx(1, .5, .8), wood, 0, .4, 1.3);
        [[-.9, 3.2, 1.6], [.2, 3.8, 1.9], [1.1, 2.8, 1.4]].forEach( ([z,hh,w], n) => {
            M(cy(.05, hh), wood, 0, hh / 2 + .2, z);
            sailPanel(w, hh * .7, 0, hh * .6 + .2, z, (n - 1) * .06)
        }
        );
        M(new THREE.SphereGeometry(.12,10,8), new THREE.MeshBasicMaterial({
            color: 0xaee7ff
        }), 0, .6, -1.7);
        flag.position.set(.3, 3.9, .2);
        P.add(flag)
    }
    ;
    SHAPES.kitacat = () => {
        const hullM = new THREE.MeshStandardMaterial({ color: 0x171a2b, metalness: .88, roughness: .28 });
        const armorM = new THREE.MeshStandardMaterial({ color: 0x34304d, metalness: .78, roughness: .3 });
        const purpleM = new THREE.MeshStandardMaterial({ color: 0x6339a8, metalness: .72, roughness: .26 });
        const glowM = new THREE.MeshStandardMaterial({ color: 0x9b65ff, emissive: 0x5920d6, emissiveIntensity: 1.45, metalness: .35, roughness: .22 });
        const glassM = new THREE.MeshStandardMaterial({ color: 0x92b9ff, emissive: 0x1a3c91, emissiveIntensity: .45, metalness: .65, roughness: .12, transparent: true, opacity: .88 });

        // Angular dark-metal space hull and swept bow.
        M(bx(1.28, .42, 2.8), hullM, 0, .08, .05);
        M(tip(1.26, 1.55, -1), hullM, 0, .05, -1.82).scale.y = .48 / 1.26;
        M(bx(.94, .12, 1.95), armorM, 0, .34, .08);
        M(new THREE.SphereGeometry(.43, 18, 12), glassM, 0, .57, .35).scale.set(1.05, .48, 1.28);

        // Purple side nacelles, violet engine cores and illuminated rails.
        for (const side of [-1, 1]) {
            M(bx(.25, .27, 2.35), armorM, side * .83, .08, .05);
            M(bx(.07, .07, 2.5), glowM, side * .98, .2, .02);
            const engine = M(new THREE.CylinderGeometry(.17, .22, .62, 14), purpleM, side * .72, .08, 1.38);
            engine.rotation.x = Math.PI / 2;
            const nozzle = M(new THREE.CylinderGeometry(.12, .12, .09, 16), glowM, side * .72, .08, 1.74);
            nozzle.rotation.x = Math.PI / 2;
            M(new THREE.BoxGeometry(.34, .06, .72), purpleM, side * .72, -.08, -1.08).rotation.y = side * -.12;
            M(new THREE.SphereGeometry(.075, 10, 8), glowM, side * .73, .08, 1.82);
        }
        M(new THREE.BoxGeometry(.12, .08, 1.8), purpleM, 0, .35, -.15);
        M(new THREE.CylinderGeometry(.055, .07, 3.9, 10), armorM, 0, 2.05, 0);

        // Deep-violet sail faces toward the bow (-Z), with the logo readable from both sides.
        const sailMesh = sailPanel(1.95, 2.55, 0, 2.22, -.08);
        sailMesh.material = cloth;
        M(new THREE.BoxGeometry(.045, 2.65, .06), glowM, -.98, 2.2, -.08);
        M(new THREE.BoxGeometry(.045, 2.65, .06), glowM, .98, 2.2, -.08);
        M(new THREE.BoxGeometry(2.02, .045, .06), purpleM, 0, .94, -.08);
        M(new THREE.BoxGeometry(2.02, .045, .06), purpleM, 0, 3.49, -.08);

        const logoMaterialFront = new THREE.MeshBasicMaterial({ map: kitacatLogoTexture, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
        const logoMaterialBack = new THREE.MeshBasicMaterial({ map: kitacatLogoTexture, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
        const logoFront = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), logoMaterialFront);
        logoFront.position.set(0, 2.2, -.36);
        logoFront.rotation.y = Math.PI;
        P.add(logoFront);
        const logoBack = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), logoMaterialBack);
        logoBack.position.set(0, 2.2, -.30);
        P.add(logoBack);

        // Small purple pennant and a pair of starship antenna lights.
        flag.position.set(.27, 4.12, -.02);
        P.add(flag);
        for (const side of [-1, 1]) {
            const antenna = M(new THREE.CylinderGeometry(.018, .025, .42, 8), armorM, side * .48, .76, 1.05);
            antenna.rotation.z = side * .28;
            M(new THREE.SphereGeometry(.055, 10, 8), glowM, side * .55, .99, 1.05);
        }
    }
    ;
}
const HW = [.65, .9, 1.0, .55, .75, .5, .88]
  , metal = new THREE.MeshStandardMaterial({
    color: 0x2b2b30,
    roughness: .4,
    metalness: .7
})
  , trim = new THREE.MeshStandardMaterial({
    color: 0xd9b45a,
    roughness: .4,
    metalness: .5
})
  , deckM = new THREE.MeshStandardMaterial({
    color: 0xb98a5a,
    roughness: .9
});
function detail(i) {
    const w = HW[i]
      , add = (g, m, x, y, z, rz) => {
        const o = new THREE.Mesh(g,m);
        o.position.set(x, y, z);
        if (rz)
            o.rotation.z = rz;
        P.add(o);
        return o
    }
    ;
    for (const s of [-1, 1]) {
        add(new THREE.BoxGeometry(.04,.07,2.5), trim, s * (w + .01), .14, 0);
        add(new THREE.BoxGeometry(.05,.2,2.2), trim, s * (w - .02), .42, 0);
        for (const z of [-.5, .4])
            add(new THREE.CylinderGeometry(.09,.11,.75,8), metal, s * (w + .1), .34, z, Math.PI / 2)
    }
    add(new THREE.BoxGeometry(w * 1.6,.05,2.2), deckM, 0, .36, 0);
    add(new THREE.SphereGeometry(.1,8,6), new THREE.MeshBasicMaterial({
        color: 0xffd27a
    }), 0, .55, 1.2)
}
function applySkin(i) {
    const s = SKINS[i];
    wood.color.setHex(s.hull);
    cloth.color.setHex(s.sail);
    flag.material.color.setHex(s.flag);
    while (P.children.length)
        P.remove(P.children[0]);
    SHAPES[SHAPE_OF[i]]();
    if (i !== 6) detail(i)
}
const hx = n => '#' + n.toString(16).padStart(6, '0');
function drawShop() {
    const g = $('grid');
    g.innerHTML = '';
    SKINS.forEach( (s, i) => {
        const b = document.createElement('button')
          , own = owned.includes(i);
        b.className = 'sk' + (i === sel ? ' on' : '') + (s.exclusive ? ' kitacat-skin' : '');
        b.innerHTML = '<i style="background:' + hx(s.hull) + '"></i><i style="background:' + hx(s.sail) + '"></i><span>' + s.n + '</span>' + (s.exclusive ? '<small class="exclusive-note">KITACAT · S-CLIENT EXCLUSIVE</small>' : '') + '<small>' + (i === sel ? 'Equipped' : own ? 'Equip' : s.p + ' coins') + '</small>';
        b.onclick = () => {
            if (own) {
                sel = i;
                applySkin(i);
                $('note').textContent = s.n + ' equipped.'
            } else if (coins >= s.p) {
                coins -= s.p;
                owned.push(i);
                sel = i;
                applySkin(i);
                $('note').textContent = 'Bought ' + s.n + '!'
            } else {
                $('note').textContent = 'You need ' + (s.p - coins) + ' more coins for ' + s.n + '. Play a round to earn some.'
            }
            save();
            showCoins();
            drawShop()
        }
        ;
        g.appendChild(b)
    }
    )
}
$('shopb').onclick = () => {
    $('card').style.display = 'none';
    $('shop').style.display = 'flex';
    $('note').textContent = '';
    drawShop()
}
;
$('back').onclick = () => {
    applySkin(sel);
    $('shop').style.display = 'none';
    $('card').style.display = 'flex'
}
;
applySkin(sel);
showCoins();
let best = Number(window.SCLIENT_BOOT?.gameSave?.bestScore) || 0;
let run = false
  , paused = false
  , t = 0
  , left = 90
  , score = 0
  , combo = 0
  , comboT = 0
  , vx = 0
  , vz = 0
  , vy = 0
  , grounded = false
  , dashCd = 0
  , shake = 0
  , nextSurge = 30
  , last = performance.now()
  , spd = 0;
function banner(s) {
    const b = $('ban');
    b.textContent = s;
    b.style.opacity = 1;
    setTimeout( () => b.style.opacity = 0, 1100)
}
function start(m, li) {
    mode = m;
    lvi = li || 0;
    LV = LEVELS[lvi];
    try {
        AC = AC || new (window.AudioContext || window.webkitAudioContext)()
    } catch (e) {}
    run = true;
    paused = false;
    $('pauseScreen').style.display = 'none';
    $('hud').style.display = 'grid';
    $('pauseButton').disabled = false;
    $('pauseButton').textContent = 'Ⅱ';
    $('modePill').textContent = mode === 'level' ? 'LEVEL ' + (lvi + 1) : 'ENDLESS';
    dashWasDown = false;
    jx = jz = 0;
    Object.keys(K).forEach(key => K[key] = 0);
    left = mode === 'level' ? LV.t : 0;
    el = 0;
    score = 0;
    caught = 0;
    combo = 0;
    comboT = 0;
    t = 0;
    base = mode === 'level' ? LV.a : 1.3;
    surge = 0;
    nextSurge = 30;
    spawned = 0;
    hp = maxhp;
    wave = 0;
    queue = 0;
    waveCool = 2;
    killed = 0;
    hurtT = 0;
    fireT = 1;
    spT = 3;
    mons.forEach(m => S.remove(m.o));
    mons.length = 0;
    shots.forEach(b => {
        b.on = false;
        b.o.visible = false
    }
    );
    P.position.set(0, 3, 0);
    vx = vz = vy = 0;
    spawn();
    hideAll();
    $('res').textContent = '';
    $('sl').textContent = mode === 'level' ? 'Crystals' : 'Score';
    $('s').textContent = mode === 'level' ? '0/' + LV.g : 0;
    $('tl').textContent = mode === 'level' ? 'Time' : 'Wave';
    $('t').textContent = mode === 'level' ? LV.t : 0;
    $('hpb').style.display = 'flex';
    $('cb').textContent = '';
    beep(440, .2, 'triangle')
}
const LEVELS = [{
    g: 8,
    t: 80,
    m: 2,
    a: 1.2
}, {
    g: 12,
    t: 80,
    m: 3,
    a: 1.4
}, {
    g: 16,
    t: 75,
    m: 4,
    a: 1.6
}, {
    g: 20,
    t: 75,
    m: 5,
    a: 1.8
}, {
    g: 25,
    t: 70,
    m: 6,
    a: 2
}];
const MT = [{
    hp: 2,
    sp: 5,
    dm: 8,
    sc: 1,
    c: 0x2f7d4f,
    r: 1.1
}, {
    hp: 5,
    sp: 6.5,
    dm: 12,
    sc: 1.35,
    c: 0x5b3f8c,
    r: 1.5
}, {
    hp: 16,
    sp: 3.6,
    dm: 25,
    sc: 2.6,
    c: 0x8c2f3f,
    r: 2.8
}];
const WEAPONS = [{
    n: 'Cannon',
    p: 0,
    dm: 1,
    rate: .9,
    sp: 34,
    rng: 34,
    n1: 1,
    sz: .25
}, {
    n: 'Twin Cannon',
    p: 80,
    dm: 1,
    rate: .7,
    sp: 36,
    rng: 36,
    n1: 2,
    sz: .25
}, {
    n: 'Harpoon',
    p: 150,
    dm: 5,
    rate: 1.5,
    sp: 50,
    rng: 48,
    n1: 1,
    sz: .2,
    pierce: 1
}, {
    n: 'Gatling',
    p: 250,
    dm: .6,
    rate: .14,
    sp: 44,
    rng: 32,
    n1: 1,
    sz: .14
}, {
    n: 'Storm Mortar',
    p: 400,
    dm: 3,
    rate: 1.8,
    sp: 28,
    rng: 40,
    n1: 1,
    sz: .45,
    aoe: 4
}];
let mons = []
  , mode = 'level'
  , LV = LEVELS[0]
  , lvi = 0
  , hp = 100
  , maxhp = 100
  , hurtT = 0
  , wave = 0
  , queue = 0
  , qT = 0
  , waveCool = 0
  , killed = 0
  , caught = 0
  , el = 0
  , spT = 0
  , fireT = 0;
const shots = [];
for (let i = 0; i < 40; i++) {
    const o = new THREE.Mesh(new THREE.SphereGeometry(.25,8,6),new THREE.MeshBasicMaterial({
        color: 0xffd27a
    }));
    o.visible = false;
    S.add(o);
    shots.push({
        o,
        on: false,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        hit: []
    })
}
function mkMon(k) {
    const T = MT[k]
      , g = new THREE.Group()
      , mat = new THREE.MeshStandardMaterial({
        color: T.c,
        roughness: .6,
        emissive: 0
    });
    const b = new THREE.Mesh(new THREE.SphereGeometry(.9,14,10),mat);
    b.scale.set(1, .8, 1.4);
    g.add(b);
    for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(.16,8,6),new THREE.MeshBasicMaterial({
            color: 0xffe14d
        }));
        e.position.set(s * .4, .35, -.95);
        g.add(e)
    }
    const f = new THREE.Mesh(new THREE.ConeGeometry(.3,.9,4),mat);
    f.position.set(0, .8, .1);
    g.add(f);
    for (let i = 1; i <= 3; i++) {
        const q2 = new THREE.Mesh(new THREE.SphereGeometry(.55 - i * .1,10,8),mat);
        q2.position.set(0, .1, .9 + i * .8);
        g.add(q2)
    }
    if (k === 2)
        for (let i = 0; i < 6; i++) {
            const a = i * 1.047
              , c2 = new THREE.Mesh(new THREE.CylinderGeometry(.08,.14,1.8,6),mat);
            c2.position.set(Math.cos(a) * .8, .9, Math.sin(a) * .8);
            c2.rotation.set(Math.sin(a) * .5, 0, -Math.cos(a) * .5);
            g.add(c2)
        }
    g.scale.setScalar(T.sc);
    S.add(g);
    return {
        o: g,
        mat,
        k,
        hp: T.hp,
        T,
        hit: 0,
        back: 0,
        ph: Math.random() * 6
    }
}
function pickType() {
    const r = Math.random();
    if (mode === 'endless') {
        if (wave >= 5 && r < .12)
            return 2;
        if (wave >= 3 && r < .45)
            return 1;
        return 0
    }
    if (lvi >= 4 && r < .06)
        return 2;
    if (lvi >= 2 && r < .35)
        return 1;
    return 0
}
function spawnMon(k) {
    const m = mkMon(k === undefined ? pickType() : k)
      , a = Math.random() * 6.283
      , d = 30 + Math.random() * 10
      , p = P.position;
    m.o.position.set(p.x + Math.cos(a) * d, 0, p.z + Math.sin(a) * d);
    m.hp = Math.ceil(m.T.hp * (mode === 'endless' ? 1 + wave * .12 : 1 + lvi * .1));
    mons.push(m)
}
function dmg(m, d) {
    m.hp -= d;
    m.hit = .12
}
function battle(dt) {
    const p = P.position;
    hurtT -= dt;
    if (mode === 'endless') {
        if (queue > 0) {
            qT -= dt;
            if (qT <= 0) {
                spawnMon(wave % 5 === 0 && queue === 1 ? 2 : undefined);
                queue--;
                qT = .7
            }
        } else if (!mons.length) {
            waveCool -= dt;
            if (waveCool <= 0) {
                wave++;
                queue = Math.min(3 + wave * 2, 26);
                qT = .5;
                waveCool = 3;
                banner('Wave ' + wave);
                beep(220, .4, 'sawtooth', .15);
                if (wave > 1)
                    hp = Math.min(maxhp, hp + 15)
            }
        }
    } else {
        spT -= dt;
        if (spT <= 0 && mons.length < LV.m) {
            spawnMon();
            spT = 5
        }
    }
    for (const m of mons) {
        const o = m.o
          , dx = p.x - o.position.x
          , dz = p.z - o.position.z
          , d = Math.hypot(dx, dz) || 1
          , sp = m.T.sp * (1 + (mode === 'endless' ? wave * .03 : lvi * .05));
        let bk = 1;
        if (m.back > 0) {
            m.back -= dt;
            bk = -1.6
        }
        const sw = Math.sin(el * 2 + m.ph) * .5;
        o.position.x += (dx / d + (-dz / d) * sw) * sp * dt * bk;
        o.position.z += (dz / d + (dx / d) * sw) * sp * dt * bk;
        o.position.y = h(o.position.x, o.position.z, t) - .1;
        o.rotation.y = Math.atan2(-dx, -dz);
        if (m.hit > 0) {
            m.hit -= dt;
            m.mat.emissive.setHex(m.hit > 0 ? 0xff3030 : 0)
        }
        if (d < m.T.r + 1.3 && hurtT <= 0) {
            hp -= m.T.dm;
            hurtT = 1;
            m.back = .6;
            vx -= dx / d * 14;
            vz -= dz / d * 14;
            shake = .6;
            emit(p, 0xff5050, 20, 7);
            beep(120, .25, 'sawtooth', .2)
        }
    }
    fireT -= dt;
    const W = WEAPONS[wsel];
    if (fireT <= 0 && mons.length) {
        let b = null
          , bd = W.rng;
        for (const m of mons) {
            const d = Math.hypot(m.o.position.x - p.x, m.o.position.z - p.z);
            if (d < bd) {
                bd = d;
                b = m
            }
        }
        if (b) {
            fireT = W.rate;
            for (let n = 0; n < W.n1; n++) {
                const s = shots.find(q => !q.on);
                if (!s)
                    break;
                const off = (n - (W.n1 - 1) / 2) * 1.3
                  , tx = b.o.position.x - p.x
                  , tz = b.o.position.z - p.z
                  , ty = b.o.position.y + .5 - (p.y + 1.4)
                  , hl = Math.hypot(tx, tz) || 1
                  , l = Math.hypot(tx, ty, tz) || 1;
                s.o.position.set(p.x - tz / hl * off, p.y + 1.4, p.z + tx / hl * off);
                s.vx = tx / l * W.sp;
                s.vy = ty / l * W.sp;
                s.vz = tz / l * W.sp;
                s.life = W.rng / W.sp + .4;
                s.on = true;
                s.hit = [];
                s.o.visible = true;
                s.o.scale.setScalar(W.sz / .25);
                beep(160 + n * 30, .08, 'square', .06)
            }
        }
    }
    for (const s of shots) {
        if (!s.on)
            continue;
        s.life -= dt;
        s.o.position.x += s.vx * dt;
        s.o.position.y += s.vy * dt;
        s.o.position.z += s.vz * dt;
        if (s.life <= 0) {
            s.on = false;
            s.o.visible = false;
            continue
        }
        for (const m of mons) {
            if (s.hit.includes(m))
                continue;
            const mp = m.o.position
              , dd = Math.hypot(mp.x - s.o.position.x, mp.y + .5 - s.o.position.y, mp.z - s.o.position.z);
            if (dd < m.T.r * .9 + W.sz) {
                dmg(m, W.dm);
                s.hit.push(m);
                emit(s.o.position, 0xffd27a, 6, 5);
                if (W.aoe) {
                    for (const o2 of mons)
                        if (o2 !== m && Math.hypot(o2.o.position.x - mp.x, o2.o.position.z - mp.z) < W.aoe)
                            dmg(o2, W.dm * .7);
                    emit(s.o.position, 0xff9040, 30, 10);
                    beep(90, .3, 'sawtooth', .15)
                }
                if (!W.pierce) {
                    s.on = false;
                    s.o.visible = false
                }
                break
            }
        }
    }
    for (let i = mons.length - 1; i >= 0; i--)
        if (mons[i].hp <= 0) {
            const m = mons[i];
            emit(m.o.position, m.T.c, 40, 10);
            S.remove(m.o);
            mons.splice(i, 1);
            killed++;
            score += m.k + 1;
            beep(260, .2, 'triangle', .12)
        }
    $('hpf').style.width = Math.max(hp, 0) / maxhp * 100 + '%'
}
function endRound(win) {
    run = false;
    paused = false;
    $('pauseScreen').style.display = 'none';
    $('pauseButton').disabled = true;
    $('modePill').textContent = 'RESULT';
    $('hpb').style.display = 'none';
    document.exitPointerLock?.();
    mons.forEach(m => S.remove(m.o));
    mons.length = 0;
    shots.forEach(b => {
        b.on = false;
        b.o.visible = false
    }
    );
    let earn = score + killed * 2, msg;
    if (mode === 'level') {
        if (win) {
            earn += 20 * (lvi + 1);
            if (lvi + 1 > unlocked)
                unlocked = Math.min(lvi + 1, LEVELS.length - 1);
            msg = 'Level ' + (lvi + 1) + ' cleared! '
        } else
            msg = 'Level failed. '
    } else {
        earn += wave * 10;
        const nb = wave > bestWave;
        if (nb)
            bestWave = wave;
        msg = 'You reached wave ' + wave + (nb ? ' - a new record! ' : '. Record: wave ' + bestWave + '. ')
    }
    coins += earn;
    save();
    showCoins();
    $('res').textContent = msg + '+' + earn + ' coins.';
    $('card').style.display = 'flex';
    $('pauseButton').disabled = true;
    $('modePill').textContent = 'RESULT';
    beep(win ? 700 : 200, .6, 'sine', .2)
}
const hideAll = () => {
    for (const id of ['card', 'shop', 'wp', 'lv'])
        $(id).style.display = 'none'
}
;
const showOnly = id => {
    hideAll();
    $(id).style.display = 'flex'
}
;
function drawL() {
    const g = $('lgrid');
    g.innerHTML = '';
    LEVELS.forEach( (l, i) => {
        const b = document.createElement('button')
          , ok = i <= unlocked;
        b.className = 'sk';
        b.innerHTML = '<span>Level ' + (i + 1) + '</span><small>' + (ok ? 'Catch ' + l.g + ' in ' + l.t + 's' : 'Locked') + '</small>';
        b.disabled = !ok;
        b.style.opacity = ok ? 1 : .45;
        b.onclick = () => start('level', i);
        g.appendChild(b)
    }
    )
}
function drawW() {
    const g = $('wgrid');
    g.innerHTML = '';
    WEAPONS.forEach( (w, i) => {
        const b = document.createElement('button')
          , own = wown.includes(i);
        b.className = 'sk' + (i === wsel ? ' on' : '');
        b.innerHTML = '<span>' + w.n + '</span><small>Dmg ' + (w.dm * w.n1) + ' | ' + (1 / w.rate).toFixed(1) + ' shots/s</small><small>' + (i === wsel ? 'Equipped' : own ? 'Equip' : w.p + ' coins') + '</small>';
        b.onclick = () => {
            if (own) {
                wsel = i;
                $('wnote').textContent = w.n + ' equipped.'
            } else if (coins >= w.p) {
                coins -= w.p;
                wown.push(i);
                wsel = i;
                $('wnote').textContent = 'Bought ' + w.n + '!'
            } else
                $('wnote').textContent = 'You need ' + (w.p - coins) + ' more coins for ' + w.n + '.';
            save();
            showCoins();
            drawW()
        }
        ;
        g.appendChild(b)
    }
    )
}
$('lvb').onclick = () => {
    drawL();
    showOnly('lv')
}
;
$('endb').onclick = () => start('endless', 0);
$('wpb').onclick = () => {
    $('wnote').textContent = '';
    drawW();
    showOnly('wp')
}
;
$('wback').onclick = () => showOnly('card');
$('lback').onclick = () => showOnly('card');
function frame(now) {
    const dt = Math.min((now - last) / 1000, .05);
    last = now;
    if (!paused) t += dt * 1.4;
    const p = P.position;
    if (run && !paused) {
        el += dt;
        if (mode === 'level' && !modFlag('freezeTimer'))
            left -= dt;
        base = (mode === 'level' ? LV.a : 1.3) + Math.min(el * .01, 1.8);
        if (el > nextSurge) {
            surge = .4;
            nextSurge += 30;
            banner('Surge!');
            beep(110, .5, 'sawtooth', .2)
        }
        surge = Math.max(0, surge - dt * .12);
        if (K.KeyQ || K.ArrowLeft)
            yaw += 2 * dt;
        if (K.KeyE || K.ArrowRight)
            yaw -= 2 * dt;
        if (K.ArrowUp)
            pitch = Math.max(.05, pitch - 1.5 * dt);
        if (K.ArrowDown)
            pitch = Math.min(1.4, pitch + 1.5 * dt);
        const ix = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0) + jx
          , iz = (K.KeyS ? 1 : 0) - (K.KeyW ? 1 : 0) + jz;
        const c = Math.cos(yaw)
          , s = Math.sin(yaw);
        vx += (ix * c + iz * s) * 50 * dt;
        vz += (-ix * s + iz * c) * 50 * dt;
        const dashDown = !!K.ShiftLeft;
        if (dashDown && !dashWasDown && (modFlag('noDashCooldown') || dashCd <= 0) && (ix || iz)) {
            const l = Math.hypot(ix, iz);
            vx += (ix * c + iz * s) / l * 16;
            vz += (-ix * s + iz * c) / l * 16;
            dashCd = 1.5;
            shake = .25;
            beep(300, .15, 'square', .08);
            emit(p, 0xe8f4ef, 25, 6)
        }
        dashWasDown = dashDown;
        dashCd = Math.max(0, dashCd - dt);
        const d = Math.exp(-3 * dt);
        vx *= d;
        vz *= d;
        p.x += vx * dt;
        p.z += vz * dt;
        vy -= 13 * dt;
        p.y += vy * dt;
        const g = h(p.x, p.z, t) + .6
          , gv = (h(p.x, p.z, t + .02) - h(p.x, p.z, t)) / .02;
        const was = grounded;
        grounded = false;
        if (p.y <= g) {
            if (!was && vy < -4) {
                emit(p, 0xff6b8a, 10, 4)
            }
            p.y = g;
            vy = Math.max(vy, gv * 1.3);
            grounded = true
        }
        if (K.Space && grounded) {
            vy = (modFlag('superJump') ? 17 : 11) + Math.max(gv, 0);
            beep(520, .1, 'triangle', .08)
        }
        if (!grounded && Math.hypot(vx, vz) > 3 && Math.random() < .6)
            emit(p, 0x6fd6c4, 1, 1.5);
        const sp = Math.hypot(vx, vz);
        if (sp > 1.5) {
            const tg = Math.atan2(-vx, -vz);
            let dd = tg - hd;
            dd = Math.atan2(Math.sin(dd), Math.cos(dd));
            hd += dd * Math.min(1, dt * 5)
        }
        const e = .6
          , sx = h(p.x + e, p.z, t) - h(p.x - e, p.z, t)
          , sz = h(p.x, p.z + e, t) - h(p.x, p.z - e, t);
        const sF = (-sx * Math.sin(hd) - sz * Math.cos(hd)) / (2 * e)
          , sR = (sx * Math.cos(hd) - sz * Math.sin(hd)) / (2 * e);
        P.rotation.set(grounded ? Math.atan(sF) : THREE.MathUtils.clamp(vy * .04, -.5, .5), hd, Math.atan(sR), 'YXZ');
        if (grounded && sp > 3 && Math.random() < .5)
            emit(p, 0xf2fbff, 1, 2);
        X.rotation.y += dt * 2;
        X.rotation.x += dt;
        beam.position.set(X.position.x, X.position.y, X.position.z);
        comboT -= dt;
        if (comboT <= 0 && combo) {
            combo = 0;
            $('cb').textContent = ''
        }
        if (modFlag('crystalMagnet')) {
            const dx = p.x - X.position.x, dz = p.z - X.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 1.2 && dist < 60) {
                const pull = Math.min(1, dt * 1.65);
                X.position.x += dx * pull;
                X.position.z += dz * pull;
                X.position.y += (p.y + 1.0 - X.position.y) * pull;
            }
        }
        if (p.distanceTo(X.position) < 2.6) {
            combo = comboT > 0 ? Math.min(combo + 1, 9) : 1;
            comboT = 7;
            if (teal) {
                if (mode === 'level') {
                    left += 5;
                    banner('+5 seconds')
                } else {
                    hp = Math.min(maxhp, hp + 30);
                    banner('+30 health')
                }
            }
            if (mode === 'endless')
                hp = Math.min(maxhp, hp + 10);
            caught++;
            score += combo;
            shake = .5;
            emit(X.position, teal ? 0x2ec4b6 : 0xffc857, 50, 9);
            beep(500 + combo * 70, .2, 'triangle', .18);
            $('s').textContent = mode === 'level' ? caught + '/' + LV.g : score;
            $('cb').textContent = combo > 1 ? 'x' + combo : '';
            spawn()
        }
        battle(dt);
        if (mode === 'endless')
            $('s').textContent = score;
        $('t').textContent = mode === 'level' ? Math.ceil(Math.max(left, 0)) : wave;
        if (mode === 'level' && caught >= LV.g)
            endRound(true);
        else if (hp <= 0 || (mode === 'level' && left <= 0))
            endRound(false);
    }
    if (!run && !paused) {
        hd += dt * .5;
        p.y = h(p.x, p.z, t) + .6;
        P.rotation.set(0, hd, 0)
    }
    parts(dt);
    grid2(t, p.x, p.z);
    spd += (Math.hypot(vx, vz) - spd) * .1;
    C.fov = THREE.MathUtils.clamp(60 + spd * .9, 60, 84);
    C.updateProjectionMatrix();
    const sh = shake;
    shake = Math.max(0, shake - dt * 1.5);
    const cd = 15
      , ch = Math.cos(pitch) * cd;
    C.position.set(p.x + Math.sin(yaw) * ch + (Math.random() - .5) * sh, p.y + Math.sin(pitch) * cd + (Math.random() - .5) * sh, p.z + Math.cos(yaw) * ch);
    C.position.y = Math.max(C.position.y, h(C.position.x, C.position.z, t) + 2);
    C.lookAt(p.x, p.y, p.z);
    stars.position.set(p.x, 0, p.z);
    R.render(S, C);
    requestAnimationFrame(frame)
}
P.position.set(0, 3, 0);
spawn();


// --------------------------- S-Client integration ---------------------------
function setPaused(value) {
    if (!run) return;
    paused = !!value;
    $('pauseScreen').style.display = paused ? 'grid' : 'none';
    $('pauseButton').textContent = paused ? '▶' : 'Ⅱ';
    if (paused) {
        dashWasDown = false;
        Object.keys(K).forEach(key => K[key] = 0);
        jx = jz = 0;
        document.exitPointerLock?.();
    }
}
$('pauseButton').addEventListener('click', () => setPaused(!paused));
$('resumeButton').addEventListener('click', () => setPaused(false));
$('leaveButton').addEventListener('click', () => {
    run = false; paused = false; dashWasDown = false;
    Object.keys(K).forEach(key => K[key] = 0); jx = jz = 0;
    for (const id of ['pauseScreen', 'lv', 'shop', 'wp']) $(id).style.display = 'none';
    $('card').style.display = 'flex';
    $('hud').style.display = 'none';
    $('hpb').style.display = 'none';
    $('pauseButton').disabled = true;
    $('modePill').textContent = 'MENU';
    document.exitPointerLock?.();
    $('gameWindow').focus?.();
});
$('fullscreenButton').addEventListener('click', async () => {
    try {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
            navigator.keyboard?.unlock?.();
        } else {
            // Keyboard Lock keeps a normal Escape press inside the game; the
            // browser still allows a long-press Escape to leave fullscreen.
            try {
                await $('gameWindow').requestFullscreen({ navigationUI: 'hide', keyboardLock: 'browser' });
            } catch (keyboardOptionError) {
                // Older browsers may reject the keyboardLock request option.
                await $('gameWindow').requestFullscreen({ navigationUI: 'hide' });
            }
            try { await navigator.keyboard?.lock?.(['Escape']); } catch (lockError) { console.info('Keyboard Lock unavailable; fullscreen toggle remains available.', lockError); }
        }
    } catch (error) { toast('Fullscreen was blocked by the browser. Click again to allow it.'); }
});
document.addEventListener('fullscreenchange', () => {
    resizeRenderer();
    const active = !!document.fullscreenElement;
    $('fullscreenButton').title = active ? 'Exit fullscreen' : 'Fullscreen game';
    $('fullscreenButton').setAttribute('aria-label', active ? 'Exit fullscreen' : 'Fullscreen game');
    if (!active) navigator.keyboard?.unlock?.();
});

function setView(name) {
    activeView = name;
    document.querySelectorAll('.view').forEach(el => el.classList.toggle('view-active', el.id === `view-${name}`));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === name));
    if (name !== 'play') {
        document.exitPointerLock?.();
        if (run && !paused) setPaused(true);
    }
    renderCheatPanel();
}
document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));

function updateCoins() {
    $('coins').textContent = 'COINS ' + coins.toLocaleString();
    $('coins2').textContent = $('coins3').textContent = 'YOUR BALANCE · ' + coins.toLocaleString() + ' COINS';
}
// All game progress is loaded from the authenticated user's Firestore document.
function saveClientGame() {
    const data = {coins, owned, sel, unlocked, bestWave, wown, wsel, bestScore:best};
    window.SClientCloud.saveGame(data);
    updateCoins();
}
function loadClientGame() {
    const raw = window.SCLIENT_BOOT?.gameSave;
    if (!raw) {
        owned = [0, 6];
        return;
    }
    coins = Math.max(0, Number(raw.coins) || 0);
    owned = Array.isArray(raw.owned) && raw.owned.length ? raw.owned.filter(i => Number.isInteger(i) && i >= 0 && i < SKINS.length) : [0];
    if (!owned.includes(0)) owned.unshift(0);
    // KitaCat Ship is an S-Client-exclusive flagship, unlocked for every S-Client player.
    if (!owned.includes(6)) owned.push(6);
    sel = clamp(Number(raw.sel) || 0, 0, SKINS.length - 1);
    if (!owned.includes(sel)) sel = owned[0];
    unlocked = clamp(Number(raw.unlocked) || 0, 0, LEVELS.length - 1);
    bestWave = Math.max(0, Number(raw.bestWave) || 0);
    wown = Array.isArray(raw.wown) && raw.wown.length ? raw.wown.filter(i => Number.isInteger(i) && i >= 0 && i < WEAPONS.length) : [0];
    if (!wown.includes(0)) wown.unshift(0);
    wsel = clamp(Number(raw.wsel) || 0, 0, WEAPONS.length - 1);
    if (!wown.includes(wsel)) wsel = wown[0];
    best = Math.max(0, Number(raw.bestScore) || 0);
}
loadClientGame();
applySkin(sel);
save = saveClientGame;
showCoins();
updateCoins();
drawShop();
drawW();
saveClientGame();

// Optional .sclient mods. Uploaded JavaScript is never executed; only allowlisted features/actions run.
const SUPPORTED_FEATURES = new Set(['freezeTimer','crystalMagnet','noDashCooldown','superJump']);
const SUPPORTED_ACTIONS = new Set(['collectCrystal','refillTimer','addCoins','setCoins','addScore','unlockShips']);
let installedMods = Array.isArray(window.SCLIENT_BOOT?.mods) ? window.SCLIENT_BOOT.mods : [];
if (!Array.isArray(installedMods)) installedMods = [];
installedMods = installedMods.filter(item => item && item.manifest && item.manifest.format === 'sclient-mod');
let cheatPanelCollapsed = false;
let cheatWidget = null;
function modFlag(featureId) {
    return installedMods.some(mod => mod.enabled && mod.featureStates && mod.featureStates[featureId] === true);
}
function saveMods() {
    // Persist the manifest, enabled flag and per-feature switches together.
    // Firestore expects a named field; spreading a bare array would lose installed[] on reload.
    const snapshot = installedMods.map(record => ({
        manifest: record.manifest,
        enabled: !!record.enabled,
        featureStates: { ...(record.featureStates || {}) }
    }));
    return window.SClientCloud.saveMods({ installed: snapshot }).catch(error => {
        console.error('S-Client mod sync failed:', error);
        toast('Could not sync mods to Firestore. Check your connection and try again.');
        return false;
    });
}
function normalizeManifest(raw) {
    if (!raw || raw.format !== 'sclient-mod' || Number(raw.formatVersion) !== 1) throw new Error('Unsupported .sclient format (version 1 required).');
    if (String(raw.game || '').toLowerCase() !== 'swell') throw new Error('This mod is not made for Swell.');
    const id = String(raw.id || '').trim(), name = String(raw.name || '').trim();
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(id) || !name || name.length > 70) throw new Error('The mod ID or name is invalid.');
    const features = Array.isArray(raw.features) ? raw.features.slice(0,30).map(f => ({id:String(f.id || ''), name:String(f.name || f.id || 'Feature').slice(0,60), description:String(f.description || '').slice(0,150), defaultEnabled:!!f.defaultEnabled})).filter(f => /^[a-zA-Z0-9_-]{1,50}$/.test(f.id)) : [];
    const actions = Array.isArray(raw.actions) ? raw.actions.slice(0,30).map(a => ({id:String(a.id || ''), label:String(a.label || a.id || 'Action').slice(0,60), action:String(a.action || ''), value:Number.isFinite(Number(a.value)) ? Number(a.value) : undefined})).filter(a => /^[a-zA-Z0-9_-]{1,50}$/.test(a.id)) : [];
    if (!features.some(f => SUPPORTED_FEATURES.has(f.id)) && !actions.some(a => SUPPORTED_ACTIONS.has(a.action))) throw new Error('This mod contains no features or actions supported by this S-Client update.');
    return {format:'sclient-mod', formatVersion:1, id, name, version:String(raw.version || '1.0.0').slice(0,24), author:String(raw.author || 'Unknown').slice(0,60), game:'swell', description:String(raw.description || '').slice(0,220), icon:String(raw.icon || '◇').slice(0,4), features, actions};
}
function installManifest(raw) {
    const manifest = normalizeManifest(raw);
    const index = installedMods.findIndex(item => item.manifest.id === manifest.id);
    const oldRecord = index >= 0 ? installedMods[index] : null;
    const states = {};
    manifest.features.forEach(feature => { states[feature.id] = oldRecord?.featureStates?.[feature.id] === true; });
    const record = {manifest, enabled:!!oldRecord?.enabled, featureStates:states};
    if (index >= 0) installedMods[index] = record; else installedMods.push(record);
    saveMods(); renderInstalledMods(); toast(`${manifest.name} imported. Enable it to open its in-game menu.`);
}
function downloadManifest(manifest) {
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${manifest.id}.sclient`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
}
const HACK_MANIFEST = {
    format:'sclient-mod', formatVersion:1, id:'swell-hacks', name:'Swell Hacks', version:'1.2.0', author:'S-Client', game:'swell', icon:'⚡',
    description:'Optional local toolkit for the new Swell update. Enable this mod to open its floating in-game cheat panel.',
    features:[
        {id:'freezeTimer',name:'Freeze timer',description:'Stops the campaign timer from counting down.',defaultEnabled:false},
        {id:'crystalMagnet',name:'Crystal magnet',description:'Pulls the current crystal toward your ship.',defaultEnabled:false},
        {id:'noDashCooldown',name:'No dash cooldown',description:'Dash without waiting for the cooldown (press Shift again).',defaultEnabled:false},
        {id:'superJump',name:'Super jump',description:'Jump higher from the wave surface.',defaultEnabled:false}
    ],
    actions:[
        {id:'collect-crystal',label:'Collect crystal',action:'collectCrystal'},
        {id:'refill-timer',label:'Refill level timer',action:'refillTimer'},
        {id:'add-coins',label:'+100 coins',action:'addCoins',value:100},
        {id:'max-coins',label:'Set 999,999 coins',action:'setCoins',value:999999},
        {id:'add-score',label:'+100 score',action:'addScore',value:100},
        {id:'unlock-ships',label:'Unlock all ships',action:'unlockShips'}
    ]
};
function runModAction(action) {
    if (!action || !SUPPORTED_ACTIONS.has(action.action)) { toast('Action not supported.'); return; }
    switch (action.action) {
        case 'collectCrystal':
            if (run && !paused) { X.position.set(P.position.x, P.position.y + 1, P.position.z); toast('Crystal collected.'); }
            else toast('Start a round before collecting a crystal.');
            break;
        case 'refillTimer':
            if (run && mode === 'level') { left = LV.t; $('t').textContent = String(Math.ceil(left)); toast('Level timer refilled.'); }
            else toast('Timer refill is available during Levels.');
            break;
        case 'addCoins':
            coins = clamp(coins + Math.floor(action.value || 100), 0, 9999999); save(); showCoins(); toast('Coins added.');
            break;
        case 'setCoins':
            coins = clamp(Math.floor(action.value || 0), 0, 9999999); save(); showCoins(); toast('Coin balance updated.');
            break;
        case 'addScore':
            if (run) { score = clamp(score + Math.floor(action.value || 100), 0, 10000000); $('s').textContent = mode === 'level' ? `${caught}/${LV.g}` : String(score); toast('Score added.'); }
            else toast('Start a round before adding score.');
            break;
        case 'unlockShips':
            owned = SKINS.map((_, index) => index); save(); showCoins(); drawShop(); applySkin(sel); toast('All ships unlocked.');
            break;
    }
}
function renderInstalledMods() {
    $('modCount').textContent = String(installedMods.length);
    $('installedLabel').textContent = `${installedMods.length} INSTALLED`;
    const root = $('installedMods'); root.replaceChildren();
    if (!installedMods.length) {
        const empty = document.createElement('div'); empty.className = 'empty-state';
        empty.innerHTML = '<div class="empty-icon">◇</div><h3>No mods installed</h3><p>Import a <code>.sclient</code> file to add your first mod. Nothing is preinstalled.</p><button class="outline-button" type="button">IMPORT A MOD</button>';
        empty.querySelector('button').addEventListener('click', () => $('modFileInput').click());
        root.appendChild(empty);
    }
    installedMods.forEach((record, index) => {
        const manifest = record.manifest;
        const card = document.createElement('article'); card.className = 'installed-mod-card';
        const icon = document.createElement('div'); icon.className = 'mod-icon hack-icon'; icon.textContent = manifest.icon || '◇';
        const info = document.createElement('div'); info.className = 'available-mod-info';
        info.innerHTML = `<div class="available-title-row"><h3>${escapeHTML(manifest.name)}</h3><span class="optional-chip">${record.enabled ? 'ENABLED' : 'DISABLED'}</span></div><p>${escapeHTML(manifest.description || 'Imported S-Client mod.')}</p><div class="mod-meta"><span>v${escapeHTML(manifest.version)}</span><span>·</span><span>${escapeHTML(manifest.author)}</span></div>`;
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = `toggle${record.enabled ? ' on' : ''}`; toggle.setAttribute('aria-label', record.enabled ? 'Disable mod' : 'Enable mod');
        toggle.addEventListener('click', () => { record.enabled = !record.enabled; saveMods(); renderInstalledMods(); toast(`${manifest.name} ${record.enabled ? 'enabled' : 'disabled'}.`); });
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'download-button'; remove.textContent = 'REMOVE';
        remove.addEventListener('click', () => { installedMods.splice(index, 1); saveMods(); renderInstalledMods(); toast(`${manifest.name} removed.`); });
        card.append(icon, info, toggle, remove); root.appendChild(card);
    });
    renderCheatPanel();
}
function renderCheatPanel() {
    if (cheatWidget) { cheatWidget.remove(); cheatWidget = null; }
    const stage = $('gameStage');
    const enabled = installedMods.filter(mod => mod && mod.enabled && mod.manifest);
    if (!stage || !enabled.length || activeView !== 'play') return;
    if (cheatPanelCollapsed) {
        cheatWidget = document.createElement('button'); cheatWidget.type = 'button'; cheatWidget.className = 'cheat-minimized'; cheatWidget.textContent = '⚡ MOD MENU';
        cheatWidget.addEventListener('click', () => { cheatPanelCollapsed = false; renderCheatPanel(); });
        stage.appendChild(cheatWidget); return;
    }
    cheatWidget = document.createElement('div'); cheatWidget.className = 'cheat-widget';
    const head = document.createElement('div'); head.className = 'cheat-head';
    const title = document.createElement('div'); title.className = 'cheat-brand'; title.innerHTML = '<i>⚡</i><span>S-CLIENT MOD MENU</span>';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'cheat-close'; close.textContent = '−'; close.title = 'Minimize menu';
    close.addEventListener('click', () => { cheatPanelCollapsed = true; renderCheatPanel(); });
    head.append(title, close); cheatWidget.appendChild(head);
    enabled.forEach(record => {
        const label = document.createElement('div'); label.className = 'cheat-section'; label.textContent = record.manifest.name.toUpperCase(); cheatWidget.appendChild(label);
        record.manifest.features.forEach(feature => {
            if (!SUPPORTED_FEATURES.has(feature.id)) return;
            const row = document.createElement('div'); row.className = 'cheat-feature';
            const copy = document.createElement('div'); copy.innerHTML = `<span>${escapeHTML(feature.name)}</span><small>${escapeHTML(feature.description || '')}</small>`;
            const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = `toggle${record.featureStates?.[feature.id] ? ' on' : ''}`;
            toggle.addEventListener('click', () => { record.featureStates[feature.id] = !record.featureStates[feature.id]; saveMods(); renderCheatPanel(); });
            row.append(copy, toggle); cheatWidget.appendChild(row);
        });
        if (record.manifest.actions.length) {
            const actions = document.createElement('div'); actions.className = 'cheat-actions';
            record.manifest.actions.forEach(action => {
                if (!SUPPORTED_ACTIONS.has(action.action)) return;
                const button = document.createElement('button'); button.type = 'button'; button.className = 'cheat-action'; button.textContent = action.label;
                button.addEventListener('click', () => runModAction(action)); actions.appendChild(button);
            });
            cheatWidget.appendChild(actions);
        }
    });
    stage.appendChild(cheatWidget);
}
$('importModButton').addEventListener('click', () => $('modFileInput').click());
$('modFileInput').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try { installManifest(JSON.parse(await file.text())); }
    catch (error) { toast(error.message || 'Could not import this .sclient file.'); }
    event.target.value = '';
});
$('downloadHackButton').addEventListener('click', () => downloadManifest(HACK_MANIFEST));
renderInstalledMods();
loadingCover.remove();

window.SwellGame = Object.freeze({
    getState: () => Object.freeze({running:run, paused, mode, level:lvi + 1, score, timeLeft:left, health:hp, coins, ownedShips:[...owned], selectedShip:sel, selectedWeapon:wsel, wave}),
    addCoins: amount => { coins = clamp(coins + Math.floor(Number(amount) || 0), 0, 9999999); save(); showCoins(); },
    setCoins: amount => { coins = clamp(Math.floor(Number(amount) || 0), 0, 9999999); save(); showCoins(); },
    addScore: amount => { if (run) score = clamp(score + Math.floor(Number(amount) || 0), 0, 10000000); },
    refillTimer: () => { if (run && mode === 'level') left = LV.t; },
    collectCrystal: () => { if (run && !paused) X.position.set(P.position.x, P.position.y + 1, P.position.z); },
    unlockShips: () => { owned = SKINS.map((_, index) => index); save(); showCoins(); drawShop(); },
    getFeature: id => modFlag(String(id))
});

// Keep toolbar and menu state in sync with the game view.
$('modePill').textContent = 'MENU';
$('pauseButton').disabled = true;
updateCoins();
requestAnimationFrame(frame);
})();
