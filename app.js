import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, collection, query, where, orderBy, limit, getDocs } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

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
  const clientPrefsRef = doc(firestore, 'users', user.uid, 'client', 'preferences');
  const modsRef = doc(firestore, 'users', user.uid, 'client', 'mods');
  const shadersRef = doc(firestore, 'users', user.uid, 'client', 'shaders');
  try {
    const [profileSnapshot, modsSnapshot, shadersSnapshot, clientPrefsSnapshot] = await Promise.all([
      getDoc(profileRef), getDoc(modsRef), getDoc(shadersRef), getDoc(clientPrefsRef)
    ]);
    const now = serverTimestamp();
    const previousProfile = profileSnapshot.exists() ? (profileSnapshot.data() || {}) : {};
    const publicName = String(previousProfile.publicName || 'S-Client Player').replace(/\s+/g, ' ').trim().slice(0, 24) || 'S-Client Player';
    const showProfilePhoto = previousProfile.showProfilePhoto === true;
    const profile = {
      uid: user.uid,
      // Keep provider identity in the private UID-owned profile only.
      authDisplayName: user.displayName || '',
      email: user.email || '',
      photoURL: user.photoURL || '',
      publicName,
      showProfilePhoto,
      lastLoginAt: now
    };
    if (!profileSnapshot.exists()) profile.createdAt = now;
    await setDoc(profileRef, profile, { merge: true });

    const photo = document.getElementById('profilePhoto');
    const avatar = document.getElementById('profileAvatar');
    document.getElementById('profileName').textContent = publicName;
    document.getElementById('profileName').title = publicName;
    if (showProfilePhoto && user.photoURL) {
      photo.src = user.photoURL;
      photo.hidden = false;
      avatar.hidden = true;
    } else {
      avatar.textContent = publicName.trim().charAt(0).toUpperCase() || 'S';
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

    const shaderDocument = shadersSnapshot.exists() ? (shadersSnapshot.data() || {}) : {};
    window.SCLIENT_BOOT = {
      clientPrefs: clientPrefsSnapshot.exists() ? (clientPrefsSnapshot.data() || {}) : {},
      mods: restoredMods,
      shaders: { customPacks: Array.isArray(shaderDocument.customPacks) ? shaderDocument.customPacks : [], activePackId: String(shaderDocument.activePackId || '') }
    };
    window.SClientCloud = {
      user: { uid: user.uid },
      profile: { publicName, showProfilePhoto, photoURL: user.photoURL || '' },
      saveProfile: makeCloudWriter(profileRef, 'profile'),
      saveClientPrefs: makeCloudWriter(clientPrefsRef, 'client preferences'),
      saveMods: makeCloudWriter(modsRef, 'mods'),
      saveShaders: makeCloudWriter(shadersRef, 'shaders')
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
  await Promise.race([setPersistence(firebaseAuth, browserLocalPersistence), new Promise((_, rej) => setTimeout(() => rej(new Error('persistence timeout')), 4000))]);
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

// Resolve a pending redirect sign-in on page return. Redirect is the fallback
// for browsers/extensions that block Firebase's popup flow.
try {
  await Promise.race([getRedirectResult(firebaseAuth), new Promise(resolve => setTimeout(resolve, 4000))]);
} catch (error) {
  console.error('Google redirect sign-in failed:', error);
  const messages = {
    'auth/unauthorized-domain': 'This GitHub Pages domain is not authorized in Firebase Authentication settings.',
    'auth/operation-not-allowed': 'Google sign-in is not enabled in the S-Client Firebase project.',
    'auth/invalid-api-key': 'The S-Client Firebase API key is invalid or restricted.'
  };
  showAuthMessage(messages[error?.code] || `Google sign-in failed (${error?.code || 'unknown error'}).`, true);
}

signInButton.addEventListener('click', async () => {
  signInButton.disabled = true;
  showAuthMessage('Opening Google sign-in…');
  try {
    await signInWithPopup(firebaseAuth, googleProvider);
    showAuthMessage('Google account verified. Loading your cloud data…');
  } catch (error) {
    console.error('Google popup sign-in failed:', error);
    if (['auth/popup-blocked', 'auth/web-storage-unsupported', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(error?.code)) {
      showAuthMessage('Opening Google sign-in in this tab…');
      try {
        await signInWithRedirect(firebaseAuth, googleProvider);
        return;
      } catch (redirectError) {
        console.error('Google redirect fallback failed:', redirectError);
        error = redirectError;
      }
    }
    signInButton.disabled = false;
    const messages = {
      'auth/popup-closed-by-user': 'Sign-in was cancelled. Click the Google button when you are ready.',
      'auth/unauthorized-domain': 'Add this exact GitHub Pages hostname to Authorized domains in the S-Client Firebase project.',
      'auth/operation-not-allowed': 'Enable the Google provider in S-Client Firebase Authentication.',
      'auth/invalid-api-key': 'The S-Client Firebase API key is invalid or restricted.',
      'auth/network-request-failed': 'Network error while contacting Google/Firebase. Check your connection and try again.'
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

// Separate Aquavoid Firebase project: S-Client credentials never own game progress.
const aquavoidFirebaseConfig = {
  apiKey: 'AIzaSyBlmRBOvrcFDgqjcWVHhSK1yOLs7IInaxI',
  authDomain: 'aquavoid-5a443.firebaseapp.com',
  projectId: 'aquavoid-5a443',
  storageBucket: 'aquavoid-5a443.firebasestorage.app',
  messagingSenderId: '142250543404',
  appId: '1:142250543404:web:5219c5b6ddc7071e590489',
  measurementId: 'G-GWC7BJQ363'
};
const aquavoidFirebaseApp = getApps().find(app => app.name === 'aquavoid-game')
  || initializeApp(aquavoidFirebaseConfig, 'aquavoid-game');
const aquavoidAuth = getAuth(aquavoidFirebaseApp);
const aquavoidFirestore = getFirestore(aquavoidFirebaseApp);
const aquavoidGoogleProvider = new GoogleAuthProvider();
aquavoidGoogleProvider.setCustomParameters({ prompt: 'select_account' });
const aquavoidGate = document.getElementById('aquavoidAuthGate');
const aquavoidGameWindow = document.getElementById('gameWindow');
const aquavoidAccountBar = document.getElementById('aquavoidAccountBar');
const aquavoidStatus = document.getElementById('aquavoidAuthStatus');
const aquavoidSignIn = document.getElementById('aquavoidSignInButton');
const aquavoidRetry = document.getElementById('aquavoidRetryButton');
let aquavoidUser = null;
let aquavoidCloudReady = false;
let aquavoidSaveQueue = Promise.resolve();
let aquavoidWriteError = null;
window.AQUAVOID_BOOT = { authenticated: false, gameSave: null, uid: null };

function setAquavoidStatus(message, error = false) {
  if (!aquavoidStatus) return;
  aquavoidStatus.textContent = message;
  aquavoidStatus.classList.toggle('is-error', !!error);
}
function paintAquavoidAccount(connected, user = null) {
  aquavoidGate.hidden = !!connected;
  aquavoidGameWindow.hidden = !connected;
  aquavoidAccountBar.hidden = !connected;
  if (connected) {
    const label = document.getElementById('aquavoidAccountLabel');
    if (label) label.textContent = `AQUAVOID ACCOUNT CONNECTED · ${user?.displayName ? 'SIGNED IN' : 'CLOUD SAVE READY'}`;
    setAquavoidStatus('Aquavoid account connected. Your progress is stored in Aquavoid Firestore.');
  }
}

window.AquavoidCloud = {
  get user() { return aquavoidUser; },
  async saveGame(data) {
    if (!aquavoidUser || !aquavoidCloudReady) throw new Error('Sign in to your Aquavoid account before saving progress.');
    const uidAtStart = aquavoidUser.uid;
    const safeData = {
      coins: Math.max(0, Math.floor(Number(data.coins) || 0)),
      owned: Array.isArray(data.owned) ? data.owned.filter(n => Number.isInteger(n) && n >= 0 && n < 6) : [0],
      sel: Math.max(0, Math.min(5, Math.floor(Number(data.sel) || 0))),
      unlocked: Math.max(0, Math.min(4, Math.floor(Number(data.unlocked) || 0))),
      bestWave: Math.max(0, Math.floor(Number(data.bestWave) || 0)),
      wown: Array.isArray(data.wown) ? data.wown.filter(n => Number.isInteger(n) && n >= 0 && n < 5) : [0],
      wsel: Math.max(0, Math.min(4, Math.floor(Number(data.wsel) || 0))),
      bestScore: Math.max(0, Math.floor(Number(data.bestScore) || 0)),
      name: String(data.name || 'Captain').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Captain',
      nameSet: data.nameSet === true
    };
    if (!safeData.owned.includes(0)) safeData.owned.unshift(0);
    if (!safeData.wown.includes(0)) safeData.wown.unshift(0);
    aquavoidSaveQueue = aquavoidSaveQueue.catch(() => {}).then(() => setDoc(
      doc(aquavoidFirestore, 'players', uidAtStart),
      { ...safeData, updatedAt: serverTimestamp() },
      { merge: true }
    ));
    try {
      await aquavoidSaveQueue;
      aquavoidWriteError = null;
      const label = document.getElementById('aquavoidAccountLabel');
      if (label) label.textContent = 'AQUAVOID ACCOUNT CONNECTED · CLOUD SAVED';
    } catch (error) {
      aquavoidWriteError = error;
      const label = document.getElementById('aquavoidAccountLabel');
      if (label) label.textContent = 'AQUAVOID CLOUD SAVE ERROR';
      throw error;
    }
  },
  async saveLeaderboardEntry(data) {
    if (!aquavoidUser || !aquavoidCloudReady) throw new Error('Connect your Aquavoid account before posting a leaderboard score.');
    const bestWave = Math.max(0, Math.floor(Number(data?.bestWave) || 0));
    if (bestWave < 1) return false;
    const name = String(data?.name || 'Captain').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Captain';
    await setDoc(doc(aquavoidFirestore, 'leaderboard', aquavoidUser.uid), {
      name,
      bestWave,
      level: Math.max(1, Math.floor(Number(data?.level) || 1)),
      updatedAt: serverTimestamp()
    }, { merge: true });
    return true;
  },
  async getLeaderboard(maxEntries = 10) {
    if (!aquavoidUser || !aquavoidCloudReady) throw new Error('Connect your Aquavoid account to view the leaderboard.');
    const safeLimit = Math.max(1, Math.min(25, Math.floor(Number(maxEntries) || 10)));
    const snapshot = await getDocs(query(
      collection(aquavoidFirestore, 'leaderboard'),
      where('bestWave', '>', 0),
      orderBy('bestWave', 'desc'),
      limit(safeLimit)
    ));
    return snapshot.docs.map(entry => ({ id: entry.id, ...(entry.data() || {}) }));
  }
};

aquavoidSignIn.addEventListener('click', async () => {
  aquavoidSignIn.disabled = true;
  setAquavoidStatus('Opening Aquavoid Google sign-in…');
  try {
    await setPersistence(aquavoidAuth, browserLocalPersistence);
    await signInWithPopup(aquavoidAuth, aquavoidGoogleProvider);
  } catch (error) {
    const messages = {
      'auth/unauthorized-domain': 'Add this GitHub Pages domain to Authorized domains in the AQUAVOID Firebase project too.',
      'auth/operation-not-allowed': 'Enable Google sign-in in the AQUAVOID Firebase Authentication settings.',
      'auth/popup-blocked': 'Allow popups for this GitHub Pages domain and try again.',
      'auth/popup-closed-by-user': 'Sign-in was cancelled. You can try again.'
    };
    setAquavoidStatus(messages[error?.code] || `Aquavoid sign-in failed (${error?.code || 'unknown error'}): ${error.message}`, true);
  } finally {
    aquavoidSignIn.disabled = false;
  }
});
aquavoidRetry.addEventListener('click', () => {
  aquavoidRetry.hidden = true;
  setAquavoidStatus('Retrying Aquavoid cloud connection…');
  if (aquavoidAuth.currentUser) aquavoidAuth.currentUser.getIdToken(true).then(() => onAquavoidUser(aquavoidAuth.currentUser)).catch(error => setAquavoidStatus(`Retry failed: ${error.message}`, true));
});
document.getElementById('aquavoidSignOutButton').addEventListener('click', async () => {
  const button = document.getElementById('aquavoidSignOutButton');
  button.disabled = true;
  try { await signOut(aquavoidAuth); }
  catch (error) { setAquavoidStatus(`Could not switch Aquavoid account: ${error.message}`, true); }
  finally { button.disabled = false; }
});

async function onAquavoidUser(user) {
  aquavoidUser = user;
  aquavoidCloudReady = false;
  if (!user) {
    window.AQUAVOID_BOOT = { authenticated: false, gameSave: null, uid: null };
    paintAquavoidAccount(false);
    setAquavoidStatus('Sign in with your Aquavoid account to play and load your Aquavoid cloud save.');
    aquavoidRetry.hidden = true;
    return;
  }
  setAquavoidStatus('Aquavoid account verified. Loading your Aquavoid Firestore save…');
  try {
    const saveRef = doc(aquavoidFirestore, 'players', user.uid);
    const snapshot = await getDoc(saveRef);
    const gameSave = snapshot.exists() ? (snapshot.data() || {}) : null;
    window.AQUAVOID_BOOT = { authenticated: true, gameSave, uid: user.uid, displayName: user.displayName || '' };
    aquavoidCloudReady = true;
    paintAquavoidAccount(true, user);
    if (window.AquavoidGame?.loadSave) {
      window.AquavoidGame.loadSave(gameSave);
      if (!snapshot.exists()) await window.AquavoidGame.save();
      else if (window.AquavoidGame.syncLeaderboard) {
        // Backfill existing Endless records into the leaderboard collection on
        // sign-in, so returning players do not need to earn another record.
        try { await window.AquavoidGame.syncLeaderboard(); }
        catch (error) { console.warn('Existing Aquavoid leaderboard record could not be synced:', error); }
      }
    }
    setAquavoidStatus('Aquavoid cloud save connected successfully.');
    aquavoidRetry.hidden = true;
  } catch (error) {
    aquavoidCloudReady = false;
    window.AQUAVOID_BOOT = { authenticated: false, gameSave: null, uid: null };
    paintAquavoidAccount(false);
    setAquavoidStatus(error?.code === 'permission-denied'
      ? 'Aquavoid Firestore denied access. Publish the Aquavoid players/{uid} owner-only rules.'
      : `Could not load Aquavoid Firestore (${error?.code || 'connection error'}): ${error.message}`, true);
    aquavoidRetry.hidden = false;
  }
}
onAuthStateChanged(aquavoidAuth, user => { onAquavoidUser(user); });

(async () => {
'use strict';
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toastRegion = $('toastRegion');
let installedMods = Array.isArray(window.SCLIENT_BOOT?.mods) ? window.SCLIENT_BOOT.mods.filter(item => item && item.manifest && item.manifest.format === 'sclient-mod').map(item => ({...item, featureStates:item.featureStates || {}, settings:item.settings || {}, state:item.state || {}})) : [];
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
loadingCover.textContent = 'LOADING AQUAVOID…';
$('gameStage').appendChild(loadingCover);
const threeReady = await Promise.race([window.__sclientThreeReady || Promise.resolve(!!window.THREE), new Promise(resolve => window.setTimeout(() => resolve(false), 10000))]);
if (!threeReady || !window.THREE) {
    loadingCover.className = 'renderer-error';
    loadingCover.textContent = 'Aquavoid could not load its 3D renderer. Check your connection to the Three.js CDN and reload this page.';
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
    loadingCover.textContent = 'Aquavoid needs WebGL. Enable hardware acceleration in Chrome, then reload S-Client.';
    console.error('S-Client WebGL initialization failed:', error);
    return;
}
R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
R.domElement.setAttribute('aria-label', 'Aquavoid game canvas');
R.domElement.tabIndex = 0;
R.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none;';
$world.appendChild(R.domElement);
function worldSize() {
    const rect = $world.getBoundingClientRect();
    return {width:Math.max(1, rect.width), height:Math.max(1, rect.height)};
}
const initialSize = worldSize();
R.setSize(initialSize.width, initialSize.height, false);
const eyesightRenderTarget = new THREE.WebGLRenderTarget(
    Math.max(1, Math.round(initialSize.width * R.getPixelRatio())),
    Math.max(1, Math.round(initialSize.height * R.getPixelRatio())),
    { minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, format:THREE.RGBAFormat, depthBuffer:true, stencilBuffer:false }
);
const eyesightPassUniforms = {
    tDiffuse: { value: eyesightRenderTarget.texture },
    uBrightness: { value: 1 },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uHue: { value: 0 },
    uTint: { value: new THREE.Color('#ffffff') },
    uTintStrength: { value: 0 },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(initialSize.width * R.getPixelRatio(), initialSize.height * R.getPixelRatio()) }
};
const eyesightPassMaterial = new THREE.ShaderMaterial({
    uniforms: eyesightPassUniforms,
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
        }
    `,
    fragmentShader: `
        #include <encodings_pars_fragment>
        uniform sampler2D tDiffuse;
        uniform float uBrightness;
        uniform float uContrast;
        uniform float uSaturation;
        uniform float uHue;
        uniform vec3 uTint;
        uniform float uTintStrength;
        uniform float uVignette;
        uniform float uGrain;
        uniform float uTime;
        uniform vec2 uResolution;
        varying vec2 vUv;

        float randomNoise(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec3 color = texture2D(tDiffuse, vUv).rgb;
            color *= uBrightness;
            color = (color - 0.5) * uContrast + 0.5;

            float luminance = dot(color, vec3(0.299, 0.587, 0.114));
            color = mix(vec3(luminance), color, uSaturation);

            // Rotate hue in YIQ space for predictable, smooth colour grading.
            float angle = radians(uHue);
            float cosine = cos(angle);
            float sine = sin(angle);
            float y = dot(color, vec3(0.299, 0.587, 0.114));
            float i = dot(color, vec3(0.596, -0.274, -0.322));
            float q = dot(color, vec3(0.211, -0.523, 0.312));
            float rotatedI = i * cosine - q * sine;
            float rotatedQ = i * sine + q * cosine;
            color = vec3(
                y + 0.956 * rotatedI + 0.621 * rotatedQ,
                y - 0.272 * rotatedI - 0.647 * rotatedQ,
                y - 1.106 * rotatedI + 1.703 * rotatedQ
            );

            color = mix(color, color * uTint, uTintStrength);
            float vignette = smoothstep(0.34, 0.92, distance(vUv, vec2(0.5)) * 1.4142);
            color *= 1.0 - vignette * uVignette;
            float noise = (randomNoise(vUv * uResolution + vec2(uTime * 13.0, uTime * 7.0)) - 0.5) * uGrain;
            color += noise;
            gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
            // The off-screen render target stores linear RGB. Convert the final
            // post-processed frame to the renderer's configured output encoding.
            #include <encodings_fragment>
        }
    `,
    depthTest:false,
    depthWrite:false,
    toneMapped:false
});
const eyesightPassScene = new THREE.Scene();
const eyesightPassQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), eyesightPassMaterial);
eyesightPassQuad.frustumCulled = false;
eyesightPassScene.add(eyesightPassQuad);
const eyesightPassCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
eyesightPassCamera.position.z = 1;
let eyesightPassEnabled = false;
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
  , surge = 0
  , tidalAmplitudeBoost = false;
const amp = () => base * (1 + surge) * (tidalAmplitudeBoost ? 1.24 : 1);
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
  , nebLo = new THREE.Color(0x100b34)
  , nebMi = new THREE.Color(0x422b83)
  , nebHi = new THREE.Color(0x9b65ff)
  , nebFo = new THREE.Color(0xe9c9ff)
  , aurLo = new THREE.Color(0x102d50)
  , aurMi = new THREE.Color(0x267b8e)
  , aurHi = new THREE.Color(0x7ed8c5)
  , aurFo = new THREE.Color(0xf0e5ff)
  , bathLo = new THREE.Color(0x354c40)
  , bathMi = new THREE.Color(0x66856a)
  , bathHi = new THREE.Color(0xa9bea0)
  , bathFo = new THREE.Color(0xf1edda)
  , col = new THREE.Color()
  , m4 = new THREE.Matrix4()
  , q = new THREE.Quaternion()
  , v3 = new THREE.Vector3()
  , sc = new THREE.Vector3();
function grid2(t, cx, cz) {
    const waveTheme = modFlag('waveThemes') ? getModSetting('wave-themes', 'theme', 'default') : 'default';
    const palette = waveTheme === 'galaxy' ? [nebLo, nebMi, nebHi, nebFo] : waveTheme === 'aurora' ? [aurLo, aurMi, aurHi, aurFo] : waveTheme === 'bathhouse' ? [bathLo, bathMi, bathHi, bathFo] : [lo, mi, hi, fo];
    const [lowColor, midColor, highColor, foamColor] = palette;
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
            if (k < .55) col.copy(lowColor).lerp(midColor, k / .55);
            else if (k < .88) col.copy(midColor).lerp(highColor, (k - .55) / .33);
            else col.copy(highColor).lerp(foamColor, (k - .88) / .12);
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
const auroraPoint = new THREE.Vector3();
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
        // With Keyboard Lock, a normal Escape press pauses Aquavoid but stays in
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
    if (!$stage.contains(e.target) || e.target.closest('button,.game-card,.sheet,.pause-screen')) return;
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
    const pixelWidth = Math.max(1, Math.round(size.width * R.getPixelRatio()));
    const pixelHeight = Math.max(1, Math.round(size.height * R.getPixelRatio()));
    eyesightRenderTarget.setSize(pixelWidth, pixelHeight);
    eyesightPassUniforms.uResolution.value.set(pixelWidth, pixelHeight);
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
}];
const KITACAT_SKIN = { n:'KitaCat Ship', p:0, hull:0x24243a, sail:0x39245f, flag:0x9b65ff, exclusive:true };
let coins = 0
  , owned = [0]
  , sel = 0
  , aquavoidSelectedShip = 0
  , kitacatEquipped = window.SCLIENT_BOOT?.clientPrefs?.kitacatEquipped === true
  , unlocked = 0
  , bestWave = 0
  , playerName = 'Captain' + (100 + Math.floor(Math.random() * 900))
  , nameSet = false
  , aquavoidLeaderboardError = null
  , wown = [0]
  , wsel = 0;
const initialCloudSave = window.AQUAVOID_BOOT?.gameSave || {};
coins = Math.max(0, Number(initialCloudSave.coins) || 0);
owned = Array.isArray(initialCloudSave.owned) ? initialCloudSave.owned : [0];
aquavoidSelectedShip = clamp(Number(initialCloudSave.sel) || 0, 0, SKINS.length - 1);
sel = aquavoidSelectedShip;
unlocked = Number(initialCloudSave.unlocked) || 0;
bestWave = Number(initialCloudSave.bestWave) || 0;
wown = Array.isArray(initialCloudSave.wown) ? initialCloudSave.wown : [0];
wsel = Number(initialCloudSave.wsel) || 0;
function save() {
    saveAquavoidGame();
}
function showCoins() {
    $('coins').textContent = 'Coins: ' + coins;
    $('coins2').textContent = $('coins3').textContent = 'Coins: ' + coins
}
const SHAPE_OF = ['sloop', 'galleon', 'cat', 'long', 'steam', 'ghost', 'kitacat']
  , SHAPES = {};
const KITACAT_LOGO_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAALSklEQVR42u3dX4gd1R3A8e9krcHGChOTUAY3hbQkaUQkPqgPPvg/WBBdbZBowSJNSzVYlGBMifRBMEGkohCKVaQvaVpsXYuwkmrcPvjQ+GAIQdsE60NWLphkc8E2Smx3bx/mlK7rZu/uvWfmztz7/cAl5O7OmTNn5/zmzPnNH5AkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZLUvWaj9U1bwbbotSU2QU92+IuBV5qN1rBt0RoObXGxe4YBYFBsAzJgh03BjtAW22yK8iU2QelHvNXAAeDC8NWWNEveHdC2uBrYH/77BbApzZIT7iWOAPrZzhmdH2BXs9FaMoCdfwmwa8ZXF4a2kQGgb3f6a4FbZ319OXD3ADbH3WHbZ7o1tJE8Bei7zj8E/An47hw/PgXclGbJ2QFpi2XAQWDlHD/+G3BHmiVT7jWOAPrJ5vN0fkJHeHCA2uLB83R+QhttdndxBNBPR7yLgbeBS+f5tXPkk2ATfd4Ww+SToEvn+bVJ4MY0S/7l3uMIoB9sa9P5CR1iENKCO9p0fkJbmRZ0BNAXR7zZab92Ck0LNhutC0IHWwmsCl+fDPMQk2mW/KfAdc9M+7VjWtAA0BcB4Fd8deZ/Pu8Dd6ZZMh0h8NwIrAsdfVXo9MuBofMsNgWcCcHgZPgcA97utiOGtN9rfHXmfz5/TrPkp+5FBoC6dv5rgX0dLPp4miWvdNDBrgRuCp+1kTfnOPnM/UHgyGIDVLPR2gzs6WC996VZ8lf3JgNA3Tr/fGm/dhaUFgzruAG4Ofy7oqTNOw2MA28B4+1Sdm3Sfu2YFiyQk4DF2dxh54cFpAWbjdYtwBjwQljXihK3bUVY5wvAWKjLfB7ssPODaUFHADU8+i8k7dfOnGnBMJH2GLCxYpt9GHh69gTmAtN+7ZgWdARQK9u67PwwKy3YbLTWNxutl8hn0TdWcJs3AvubjdZLzUZr/Yzvd3TZ+cG0oCOAGh39F5v2a+fHwG3AHTUK2NNh/uMN4NeRyjQtaACoRQBYbNqvnX8DX6tpc3wRMRCCaUFPASre+a+N3PmpcecncucH7xZ0BFDhzt9N2m9Q9rVWhHJMCzoCqKTNdv55tSIdcEwLOgKo3NE/RtpPC2da0BFApWyz85fKtKAjgMoc/WOn/ZwTWBjTgo4AKmGnnb8ncwI+RNQA0POjfxFpv0ELAt0wLegpQM86v2m/ajAt2IULbIKO1SntNwl8AEzM+JwAPg4/vwxYDQzP+GygHhOb/0sL/s5d0hFAWUf/uqT9DpE/kOTAYh/1FR4dtgm4D7imBgHOtKABoLQA8DiwtaLVOwuMAvvSLDkeaXvXhkAwAiyr6Ha/mGbJHvdOA0DRnb/Kab/9wO6iXjASnuyzE9hSwW03LdgBswCLV8W03+fA9jRLdhX5dqE0S86mWbIL2B7WWSWmBQ0AhR/9q5j2+wi4K82S0bJWGNZ1V1h3lZgWNAAU1vmH+PLbbKtgjPwR4sfLXnFY552hDlWyK/ytZACIqmppvzHg4V6+UDSs++GKBQHvFlwEJwEXdvSvWtrvo3DkP1uR9llG/tKPNRVpH9OCjgCiqtLdfp8DD1XpVeKhLg9RnYlB7xY0AEQ7uq0G7q9QlZ7oxTn/AucEnqhQle4PfzsZALpSpbTf/jJn+zsIAqMs/OWfRTMtaADo+uhfpbTfWWB3DZptd6hrFZgWNAB03PmrlvYbrdJ5f5v5gCqNUkwLzsO7Ac/vW+Q30xzqooxvAHdHqs++WBvWbLQS8jv+rghfHQUm0ixpRazrDyKV9UfgnxH+lh+5S3+VacBiRxE/JM7E2KE0S+6NUJ9vAz8HrgIumfXjT4H3gKfSLPlHhHX9ljh3ET6ZZslv3Js8BaijdVU4+jcbraFmo7UVeB24fo7OT/jueuD1ZqO1NcKweV/F2lAGgNKtilDGJPndh93MZbwMPM7CXtK5NPzuy10GgQOh7lVoQxkAahsAPljswzxmeQC4roPlrgvLdiTU+QMDgAFgkK2MUMZEl+f8j3Sx7kdCGaXXPXIbygBQrvBIreW9DADkE35Lu1h+aSijlwFgeWhLGQBq5VJgqFcBIKT6roqw/qtCWb0KAEP41iUDwIAO/yF/em8nhpl7tn+xLglllVl3TwMMALUXa/Lq4w6XuyLitlxRct2LaksZACQZAIp3MlI5l3W43NGI23K05LoX1ZYyAJTmVKRyOr2nfYL88t5ufUrnk3mrK9aWMgCUZhKI8b66jibgwo0970VY/3td3CQ0HGH9U8S5olAGgPKEK+HO9CoABE8B57pY/lwogx4GgDNdXgkpA0CtTwM67kThrr5nu1j3s13eGThckTaUAaAnYkxebejySriXgXc6WO6dsGxHQp03VKQNZQCobQC4lPwtvZ2OAqbIb+rZs8DTgXPhdx8Iy3ZqE3Gu4DMAGABq61ikcu7rcj5iKs2SF4Hbgb8wd3bg0/Cz29MsebHLzt91nQtoQ83BJwIVKDyWejxScbdFfN13oY8EC68TfyPSdt/gG3+L411WBUqz5ESz0ToOrI00CvhFpHq1yK/TL6pjxTr6H7fzewpQdwcjlTMSXsFV9VHPMmCkYm0nA0DtA8Ay6vGii52hrgYAA4CAI8DpSGVtaTZaI1Xd0FC3LZGKOx3aTgaAWs8DTBNvIhDgyTDJVrXOvxZ4MmKR46HtZACovbcilnURsLdK8wGhLntD3arYZjIA9NQ48GHE8tYAe7p4VFfMzp+QXzi0JmKxH0YeNckA0NPTgCngmcjFfg94vpcjgbDu50NdYnomwoVIMgBUKgi8CRwuIAi81os5gbDO1wro/IdDW8kA0HeeLqDMNcCrZWYHwrpejTzsL7KNdB5eClz+kfMl4IaCit8P7C7qNeJhyL+TeKm+2cbTLPmRe4kBoJ8DwHryl3QWNfo6C4wC+yLeO7CW/PLeEeJd5DPbNPmNSH93LzEA9HsQeIZ4l8vO5xD5W3oPLPapOuF+/k2h419TQl1H0yzZ7t5hABiEAJCGo/RwSaucJH9R58SMzwn+/9z+y8gf4Dk847OB8t7IMwGMpFnSdO8wAAxKEFgH/AH4+oA3xWfA99Ms8b7/HjAL0CNhh380nPsOqmngUTu/AWBQg8CbwHMD3ATPmfM3AAy6vcDYAG73WNh2OQcw8PMBFwG/By4fkE1+H7gnzZLP/es7AvBUIO8IW0PHGITOv9XObwDQl4PAJ8A9fX46MBaO/J/4F/cUQHOfDiTAQ8DP+ihAT5NPdu6N9eRhGQD6PRDcAvyS+l8n8Bl5qs/ZfgOAFhkE1gEvUN4Vg7FNAD8xz+8cgDqbFzhGfs/AKPW6YGg61HnEzu8IQHFGA+uB7RR3K3Es4+RP9PGuPgOACggEVwOPARsrVrXDwNNplrzrX8kAoOIDwS1hRPCdHlflw3DEd5LPAKCSg8BQOCW4Ofy7oqRVnw5D/bfIn+LjAzwNAOpxMFgCXAncFD6xHxR6nPxVXQeBI760wwCgageE1cCNwDpgVfisBJYDQ+dZbAo4A5wCTobPMeBt39JrAFB/BIYLyJ/0szIEBUJHPwVMLvbRYZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIq5L8KeSr2XvEt1AAAAABJRU5ErkJggg==';
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
function availableShips() {
    return modFlag('kitacatShip') ? [...SKINS, KITACAT_SKIN] : SKINS;
}
function saveClientPreferences() {
    window.SClientCloud?.saveClientPrefs?.({ kitacatEquipped: !!kitacatEquipped }).catch(error => {
        console.error('S-Client preference save failed:', error);
        toast('Could not sync S-Client-only ship settings.');
    });
}
function refreshKitacatShip() {
    const available = modFlag('kitacatShip');
    if (!available && sel === 6) {
        kitacatEquipped = false;
        sel = aquavoidSelectedShip;
        applySkin(sel);
        saveClientPreferences();
    } else if (available && kitacatEquipped) {
        sel = 6;
        applySkin(sel);
    }
    if (typeof drawShop === 'function') drawShop();
}
function applySkin(i) {
    const ships = availableShips();
    if (!ships[i]) i = 0;
    sel = i;
    const s = ships[i];
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
    availableShips().forEach( (s, i) => {
        const b = document.createElement('button')
          , own = i === 6 ? true : owned.includes(i);
        b.className = 'sk' + (i === sel ? ' on' : '') + (s.exclusive ? ' kitacat-skin' : '');
        b.innerHTML = '<i style="background:' + hx(s.hull) + '"></i><i style="background:' + hx(s.sail) + '"></i><span>' + s.n + '</span>' + (s.exclusive ? '<small class="exclusive-note">KITACAT · S-CLIENT EXCLUSIVE</small>' : '') + '<small>' + (i === sel ? 'Equipped' : own ? 'Equip' : s.p + ' coins') + '</small>';
        b.onclick = () => {
            if (i === 6) {
                if (!modFlag('kitacatShip')) return;
                kitacatEquipped = true;
                sel = 6;
                saveClientPreferences();
                $('note').textContent = 'KitaCat Ship equipped. This ship is exclusive to your S-Client account.';
            } else if (own) {
                sel = i;
                aquavoidSelectedShip = i;
                kitacatEquipped = false;
                applySkin(i);
                saveClientPreferences();
                $('note').textContent = s.n + ' equipped.'
            } else if (coins >= s.p) {
                coins -= s.p;
                owned.push(i);
                sel = i;
                aquavoidSelectedShip = i;
                kitacatEquipped = false;
                applySkin(i);
                saveClientPreferences();
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
let best = Number(window.AQUAVOID_BOOT?.gameSave?.bestScore) || 0;
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
    if (!window.AQUAVOID_BOOT?.authenticated || !window.AquavoidCloud?.user) { toast('Sign in with your Aquavoid account before playing.'); return; }
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
    stormStrikeCooldown = 0;
    guardianFireTimer = 0;
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

// S-Client community-mod visuals: orbiting guardian drones and short-lived energy rays.
const guardianDrones = [];
const modRays = [];
let guardianFireTimer = 0;
let stormStrikeCooldown = 0;
for (let i = 0; i < 2; i++) {
    const group = new THREE.Group();
    const coreMat = new THREE.MeshStandardMaterial({color:0xb88cff, emissive:0x6f36d8, emissiveIntensity:1.5, metalness:.5, roughness:.25});
    const ringMat = new THREE.MeshBasicMaterial({color:0x67e7f4, transparent:true, opacity:.9});
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(.27,1), coreMat);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.42,.045,7,18), ringMat);
    ring.rotation.x = Math.PI / 2.4;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.075,8,8), new THREE.MeshBasicMaterial({color:0xffffff}));
    eye.position.set(0,0,-.25);
    group.add(core, ring, eye);
    group.visible = false;
    S.add(group);
    guardianDrones.push(group);
}
function createModRay(from, to, color = 0x9b65ff, life = .18) {
    const geometry = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const material = new THREE.LineBasicMaterial({color, transparent:true, opacity:.95, blending:THREE.AdditiveBlending});
    const line = new THREE.Line(geometry, material);
    S.add(line);
    modRays.push({line, life, maxLife:life});
}
function updateModRays(dt) {
    for (let i = modRays.length - 1; i >= 0; i--) {
        const ray = modRays[i];
        ray.life -= dt;
        ray.line.material.opacity = Math.max(0, ray.life / ray.maxLife);
        if (ray.life <= 0) {
            S.remove(ray.line);
            ray.line.geometry.dispose();
            ray.line.material.dispose();
            modRays.splice(i, 1);
        }
    }
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
function updateGuardianDrones(dt) {
    const active = run && !paused && modFlag('guardianDrones');
    const p = P.position;
    guardianDrones.forEach((drone, index) => {
        drone.visible = active;
        if (!active) return;
        const angle = el * 1.65 + index * Math.PI;
        drone.position.set(p.x + Math.cos(angle) * 2.65, p.y + 1.25 + Math.sin(el * 3 + index) * .22, p.z + Math.sin(angle) * 2.65);
        drone.rotation.y = -angle;
        drone.rotation.z = Math.sin(el * 2 + index) * .12;
    });
    if (!active) { guardianFireTimer = 0; return; }
    guardianFireTimer -= dt;
    if (guardianFireTimer > 0 || !mons.length) return;
    let target = null, targetDistance = 31;
    for (const monster of mons) {
        const distance = Math.hypot(monster.o.position.x - p.x, monster.o.position.z - p.z);
        if (distance < targetDistance) { target = monster; targetDistance = distance; }
    }
    if (!target) { guardianFireTimer = .22; return; }
    const drone = guardianDrones.reduce((best, item) => item.position.distanceTo(target.o.position) < best.position.distanceTo(target.o.position) ? item : best, guardianDrones[0]);
    dmg(target, 2.6);
    emit(target.o.position, 0x9b65ff, 13, 3.6);
    createModRay(drone.position, target.o.position, 0xa879ff, .16);
    beep(680, .07, 'sine', .035);
    guardianFireTimer = 1.05;
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
        // Contact damage must intersect in 3D, not only on the X/Z plane.
        // This prevents a monster below a jumping ship from hitting it through empty air.
        const horizontalContact = Math.hypot(p.x - o.position.x, p.z - o.position.z);
        const playerBottom = p.y - .62;
        const playerTop = p.y + .58;
        const monsterBottom = o.position.y - .78 * m.T.sc;
        const monsterTop = o.position.y + 1.28 * m.T.sc;
        const verticalOverlap = playerBottom <= monsterTop + .08 && playerTop >= monsterBottom - .08;
        if (horizontalContact < m.T.r + 1.3 && verticalOverlap && hurtT <= 0) {
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
    for (const id of ['card', 'shop', 'wp', 'lv', 'lb'])
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
    tidalAmplitudeBoost = modFlag('tidalEngine');
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
        const tidalThrust = modFlag('tidalEngine') ? 1.18 : 1;
        vx += (ix * c + iz * s) * 50 * dt * tidalThrust;
        vz += (-ix * s + iz * c) * 50 * dt * tidalThrust;
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
            vy = (modFlag('superJump') ? 17 : 11) + (modFlag('tidalEngine') ? 1.8 : 0) + Math.max(gv, 0);
            beep(520, .1, 'triangle', .08)
        }
        if (!grounded && Math.hypot(vx, vz) > 3 && Math.random() < .6)
            emit(p, 0x6fd6c4, 1, 1.5);
        const sp = Math.hypot(vx, vz);
        if (modFlag('auroraWake') && sp > 1.2) {
            const aft = auroraPoint.set(p.x + Math.sin(hd) * 1.65, p.y + .16, p.z + Math.cos(hd) * 1.65);
            emit(aft, Math.sin(el * 7) > 0 ? 0x9b65ff : 0x45e7dc, 2, 1.15);
        }
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
            combo = comboT > 0 ? Math.min(combo + 1, modFlag('comboReactor') ? 15 : 9) : 1;
            comboT = modFlag('comboReactor') ? 10 : 7;
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
            score += combo * (modFlag('comboReactor') ? 2 : 1);
            if (modFlag('comboReactor')) emit(X.position, 0xb78cff, 12 + combo, 4);
            shake = .5;
            emit(X.position, teal ? 0x2ec4b6 : 0xffc857, 50, 9);
            beep(500 + combo * 70, .2, 'triangle', .18);
            $('s').textContent = mode === 'level' ? caught + '/' + LV.g : score;
            $('cb').textContent = combo > 1 ? 'x' + combo : '';
            spawn()
        }
        battle(dt);
        updateGuardianDrones(dt);
        stormStrikeCooldown = Math.max(0, stormStrikeCooldown - dt);
        if (mode === 'endless')
            $('s').textContent = score;
        $('t').textContent = mode === 'level' ? Math.ceil(Math.max(left, 0)) : wave;
        if (mode === 'level' && caught >= LV.g)
            endRound(true);
        else if (hp <= 0 || (mode === 'level' && left <= 0))
            endRound(false);
    }
    if (!run && !paused) {
        guardianDrones.forEach(drone => { drone.visible = false; });
        hd += dt * .5;
        p.y = h(p.x, p.z, t) + .6;
        P.rotation.set(0, hd, 0)
    }
    parts(dt);
    updateModRays(dt);
    updateModRadar();
    if (window.stars?.material?.color) {
        const theme = modFlag('waveThemes') ? getModSetting('wave-themes', 'theme', 'default') : 'default';
        window.stars.material.color.setHex(theme === 'galaxy' ? 0xc6a7ff : theme === 'aurora' ? 0xa7f5df : theme === 'bathhouse' ? 0xd9e3c5 : 0xe8f4ef);
    }
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
    if (eyesightPassEnabled) {
        eyesightPassUniforms.uTime.value += dt;
        R.setRenderTarget(eyesightRenderTarget);
        R.render(S, C);
        R.setRenderTarget(null);
        R.render(eyesightPassScene, eyesightPassCamera);
    } else {
        R.setRenderTarget(null);
        R.render(S, C);
    }
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
    for (const id of ['pauseScreen', 'lv', 'shop', 'wp', 'lb']) $(id).style.display = 'none';
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
}
document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));

// Account appearance is deliberately separate from the user's Google identity.
function renderPublicProfile(profile = window.SClientCloud?.profile || {}) {
    const publicName = String(profile.publicName || 'S-Client Player').trim() || 'S-Client Player';
    $('profileName').textContent = publicName;
    $('profileName').title = publicName;
    const photo = $('profilePhoto');
    const avatar = $('profileAvatar');
    if (profile.showProfilePhoto && profile.photoURL) {
        photo.src = profile.photoURL;
        photo.hidden = false;
        avatar.hidden = true;
    } else {
        photo.hidden = true;
        avatar.textContent = publicName.charAt(0).toUpperCase();
        avatar.hidden = false;
    }
}

const profileForm = $('profileSettingsForm');
const profileNameInput = $('publicNameInput');
const profilePhotoToggle = $('showProfilePhotoInput');
const profileSaveButton = $('saveProfileSettingsButton');
const profileSaveStatus = $('settingsSaveStatus');
const bootProfile = window.SClientCloud?.profile || { publicName: 'S-Client Player', showProfilePhoto: false };
profileNameInput.value = bootProfile.publicName || 'S-Client Player';
profilePhotoToggle.checked = bootProfile.showProfilePhoto === true;
renderPublicProfile(bootProfile);

profileForm.addEventListener('submit', async event => {
    event.preventDefault();
    const publicName = profileNameInput.value.replace(/\s+/g, ' ').trim();
    const validName = /^[\p{L}\p{N} _.'-]{2,24}$/u.test(publicName);
    if (!validName) {
        profileNameInput.setCustomValidity('Use 2–24 letters, numbers, spaces, dots, underscores or hyphens.');
        profileNameInput.reportValidity();
        profileNameInput.setCustomValidity('');
        return;
    }
    profileSaveButton.disabled = true;
    profileSaveButton.textContent = 'SAVING…';
    profileSaveStatus.textContent = 'Saving your profile to Firestore…';
    const nextProfile = {
        publicName,
        showProfilePhoto: profilePhotoToggle.checked,
        photoURL: window.SClientCloud?.profile?.photoURL || ''
    };
    try {
        await window.SClientCloud.saveProfile({ publicName, showProfilePhoto: nextProfile.showProfilePhoto });
        window.SClientCloud.profile = nextProfile;
        renderPublicProfile(nextProfile);
        profileSaveStatus.textContent = 'Saved to your account.';
        toast('Your S-Client display name has been updated.');
    } catch (error) {
        console.error('Profile settings save failed:', error);
        profileSaveStatus.textContent = 'Could not save. Check your connection and try again.';
        toast('Profile changes could not be saved to Firestore.');
    } finally {
        profileSaveButton.disabled = false;
        profileSaveButton.textContent = 'SAVE CHANGES';
    }
});
profileNameInput.addEventListener('input', () => { profileSaveStatus.textContent = ''; });
profilePhotoToggle.addEventListener('change', () => { profileSaveStatus.textContent = 'Save changes to apply this preference.'; });
$('settingsGoPlayButton').addEventListener('click', () => setView('play'));

function updateCoins() {
    $('coins').textContent = 'COINS ' + coins.toLocaleString();
    $('coins2').textContent = $('coins3').textContent = 'YOUR BALANCE · ' + coins.toLocaleString() + ' COINS';
}
// Aquavoid game progress belongs to the separate Aquavoid Firebase project.
function saveAquavoidGame() {
    if (!window.AQUAVOID_BOOT?.authenticated || !window.AquavoidCloud?.user) return Promise.resolve(false);
    const data = {
        coins,
        owned: owned.filter(index => Number.isInteger(index) && index >= 0 && index < SKINS.length),
        // The KitaCat Ship is S-Client-only: never write its equipped index or entitlement to Aquavoid.
        sel: aquavoidSelectedShip,
        unlocked,
        bestWave,
        wown,
        wsel,
        bestScore: best,
        name: playerName,
        nameSet
    };
    updateCoins();
    return window.AquavoidCloud.saveGame(data).then(async () => {
        if (bestWave > 0) {
            try { await syncAquavoidLeaderboard(); }
            catch (error) {
                console.warn('Aquavoid leaderboard save failed:', error);
                toast('Progress saved, but your leaderboard entry could not be updated.');
            }
        }
        return true;
    }).catch(error => {
        console.error('Aquavoid cloud save failed:', error);
        toast('Aquavoid progress could not be saved. Check your Aquavoid Firestore rules and connection.');
        throw error;
    });
}
function loadClientGame(raw = window.AQUAVOID_BOOT?.gameSave) {
    coins = Math.max(0, Number(raw?.coins) || 0);
    owned = Array.isArray(raw?.owned) && raw.owned.length
        ? raw.owned.filter(i => Number.isInteger(i) && i >= 0 && i < SKINS.length)
        : [0];
    if (!owned.includes(0)) owned.unshift(0);
    aquavoidSelectedShip = clamp(Number(raw?.sel) || 0, 0, SKINS.length - 1);
    unlocked = clamp(Number(raw?.unlocked) || 0, 0, LEVELS.length - 1);
    bestWave = Math.max(0, Number(raw?.bestWave) || 0);
    if (typeof raw?.name === 'string' && cleanCaptainName(raw.name).length >= 2) {
        playerName = cleanCaptainName(raw.name);
        nameSet = raw.nameSet === true;
    } else if (!nameSet && window.AQUAVOID_BOOT?.displayName) {
        const googleName = cleanCaptainName(window.AQUAVOID_BOOT.displayName.split(' ')[0]);
        if (googleName.length >= 2) playerName = googleName;
    }
    if ($('nameInput')) $('nameInput').value = playerName;
    if ($('nameNote')) $('nameNote').textContent = nameSet
        ? 'Your captain name is saved.'
        : 'This name appears beside your Endless leaderboard score.';
    wown = Array.isArray(raw?.wown) && raw.wown.length
        ? raw.wown.filter(i => Number.isInteger(i) && i >= 0 && i < WEAPONS.length)
        : [0];
    if (!wown.includes(0)) wown.unshift(0);
    wsel = clamp(Number(raw?.wsel) || 0, 0, WEAPONS.length - 1);
    if (!wown.includes(wsel)) wsel = wown[0];
    best = Math.max(0, Number(raw?.bestScore) || 0);

    // Restore client-only cosmetics from S-Client Firestore, not Aquavoid.
    kitacatEquipped = window.SCLIENT_BOOT?.clientPrefs?.kitacatEquipped === true && modFlag('kitacatShip');
    sel = kitacatEquipped ? 6 : aquavoidSelectedShip;
    applySkin(sel);
    showCoins();
    updateCoins();
    drawShop();
    drawW();
}
loadClientGame();
applySkin(sel);
save = saveAquavoidGame;

async function syncAquavoidLeaderboard() {
    if (bestWave < 1 || !window.AquavoidCloud?.saveLeaderboardEntry) return false;
    try {
        const result = await window.AquavoidCloud.saveLeaderboardEntry({ name:playerName, bestWave, level:unlocked + 1 });
        aquavoidLeaderboardError = null;
        return result;
    } catch (error) {
        aquavoidLeaderboardError = error;
        throw error;
    }
}
function cleanCaptainName(value) {
    return String(value || '')
        .replace(/[^\p{L}\p{N} _.\-]/gu, '')
        .replace(/\s+/g, ' ')
        .slice(0, 16)
        .trim();
}
function saveCaptainName() {
    const nextName = cleanCaptainName($('nameInput').value);
    if (nextName.length < 2) {
        $('nameNote').textContent = 'Use 2–16 letters, numbers, spaces, _ . or -.';
        return;
    }
    playerName = nextName;
    nameSet = true;
    $('nameInput').value = playerName;
    $('nameNote').textContent = 'Saving your captain name…';
    Promise.resolve(save()).then(() => {
        $('nameNote').textContent = bestWave > 0
            ? (aquavoidLeaderboardError ? 'Name saved, but leaderboard sync failed. Check the Aquavoid Firestore rules.' : 'Name saved. Your leaderboard entry has been updated.')
            : 'Name saved. Finish an Endless run to appear on the leaderboard.';
    }).catch(() => {
        $('nameNote').textContent = 'Name is set for this session, but cloud save failed.';
    });
}
function renderLeaderboardRows(entries) {
    const list = $('lbList');
    list.replaceChildren();
    entries.forEach((entry, index) => {
        const item = document.createElement('li');
        if (window.AquavoidCloud?.user && entry.id === window.AquavoidCloud.user.uid) item.className = 'me';
        const name = document.createElement('span');
        name.className = 'nm';
        name.textContent = cleanCaptainName(entry.name) || 'Captain';
        const score = document.createElement('span');
        score.className = 'sc';
        score.textContent = `#${index + 1} · Wave ${Math.max(0, Number(entry.bestWave) || 0)} · Level ${Math.max(1, Number(entry.level) || 1)}`;
        item.append(name, score);
        list.appendChild(item);
    });
}
async function showLeaderboard() {
    showOnly('lb');
    $('lbNote').textContent = 'Loading the top captains…';
    $('lbMine').textContent = bestWave > 0 ? `Your best: wave ${bestWave}` : 'Your best: no Endless record yet.';
    $('lbList').replaceChildren();
    if (!window.AQUAVOID_BOOT?.authenticated || !window.AquavoidCloud?.user) {
        $('lbNote').textContent = 'Sign in with your Aquavoid account to view and submit leaderboard scores.';
        return;
    }
    try {
        const entries = await window.AquavoidCloud.getLeaderboard(10);
        renderLeaderboardRows(entries);
        $('lbNote').textContent = entries.length
            ? 'Top captains ranked by their best Endless wave.'
            : 'No scores yet. Be the first to finish an Endless run!';
    } catch (error) {
        console.error('Aquavoid leaderboard load failed:', error);
        $('lbNote').textContent = error?.code === 'permission-denied'
            ? 'Leaderboard access was denied. Check the Aquavoid Firestore rules for public reads and signed-in player writes.'
            : `Could not load the leaderboard: ${error.message || 'connection error'}`;
    }
}
$('nameSave').addEventListener('click', saveCaptainName);
$('nameInput').addEventListener('keydown', event => { if (event.key === 'Enter') saveCaptainName(); });
$('lbb').addEventListener('click', showLeaderboard);
$('lbBack').addEventListener('click', () => showOnly('card'));
$('nameInput').value = playerName;
$('nameNote').textContent = nameSet ? 'Your captain name is saved.' : 'This name appears beside your Endless leaderboard score.';
showCoins();
updateCoins();
drawShop();
drawW();

// S-Client private mod library. SCL source is interpreted; uploaded JavaScript is never executed.
const SUPPORTED_FEATURES = new Set(['freezeTimer','crystalMagnet','noDashCooldown','superJump','auroraWake','waveThemes','tidalEngine','guardianDrones','treasureRadar','comboReactor','eyesightEnabled','kitacatShip']);
const SUPPORTED_ACTIONS = new Set(['collectCrystal','refillTimer','addCoins','setCoins','addScore','unlockShips','stormStrike']);
let activeModId = null;
let currentModsSubpage = 'library';

function modFlag(featureId) {
    return installedMods.some(mod => mod.enabled && mod.featureStates && mod.featureStates[featureId] === true);
}
function getModSetting(modId, settingId, fallback) {
    const record = installedMods.find(mod => mod.manifest?.id === modId && mod.enabled);
    const value = record?.settings?.[settingId];
    return value === undefined || value === null ? fallback : value;
}
function saveMods() {
    const snapshot = installedMods.map(record => ({
        manifest: record.manifest,
        enabled: !!record.enabled,
        featureStates: { ...(record.featureStates || {}) },
        settings: { ...(record.settings || {}) },
        state: { ...(record.state || {}) }
    }));
    return window.SClientCloud.saveMods({ installed: snapshot }).catch(error => {
        console.error('S-Client mod sync failed:', error);
        toast('Could not sync your mods to Firestore. Check your connection.');
        return false;
    });
}
// SCL (S-Client Language) is a small, declarative, event-driven language with bounded conditional flow.
// It is interpreted by this client; uploaded files never run JavaScript or eval().
const SCL_VERSION = 1;
const SCL_PERMISSIONS = new Set(['ui.toast','eyesight.presets','aquavoid.features','aquavoid.actions']);
const SCL_APIS = new Set(['ui.toast','eyesight.selectPreset','eyesight.reset','aquavoid.action']);
const SCL_EVENTS = ['onInstall','onEnable','onDisable','onSettingChange','onFeatureChange'];
const SCL_CONTROL_TYPES = new Set(['text','button','toggle','select','slider','shaderPicker']);
function isSafeSclKey(value, max = 40) {
    const key = String(value || '');
    return new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`).test(key) && !['__proto__','prototype','constructor'].includes(key);
}

function normalizeSetting(setting) {
    if (!setting || !isSafeSclKey(setting.id, 40)) return null;
    const type = String(setting.type || 'select');
    const base = {id:String(setting.id), label:String(setting.label || setting.id).slice(0,60), description:String(setting.description || '').slice(0,150), type};
    if (type === 'select') {
        const options = Array.isArray(setting.options) ? setting.options.slice(0,20).map(option => ({
            value:String(option.value ?? '').slice(0,60), label:String(option.label || option.value || '').slice(0,60)
        })).filter(option => option.value && option.label) : [];
        if (!options.length) return null;
        const defaultValue = options.some(option => option.value === String(setting.defaultValue)) ? String(setting.defaultValue) : options[0].value;
        return {...base, options, defaultValue};
    }
    if (type === 'toggle') return {...base, defaultValue:setting.defaultValue === true};
    if (type === 'slider' || type === 'number') {
        const min = Number.isFinite(Number(setting.min)) ? Number(setting.min) : 0;
        const max = Number.isFinite(Number(setting.max)) ? Number(setting.max) : 100;
        if (max <= min || max - min > 1000000) return null;
        const step = Math.max(0.001, Math.min(max - min, Number(setting.step) || (type === 'number' ? 1 : 0.1)));
        const value = Number.isFinite(Number(setting.defaultValue)) ? Number(setting.defaultValue) : min;
        return {...base, min, max, step, defaultValue:Math.max(min, Math.min(max, value))};
    }
    if (type === 'color') {
        const value = /^#[0-9a-f]{6}$/i.test(String(setting.defaultValue || '')) ? String(setting.defaultValue) : '#ffffff';
        return {...base, defaultValue:value};
    }
    if (type === 'text') return {...base, maxLength:Math.max(1, Math.min(120, Number(setting.maxLength) || 80)), defaultValue:String(setting.defaultValue || '').slice(0,120)};
    return null;
}
function normalizeSclCommands(source, label, depth = 0, budget = {count:0}) {
    if (source === undefined || source === null) return [];
    if (depth > 4) throw new Error(`${label} contains too many nested if statements (maximum depth is 4).`);
    if (!Array.isArray(source) || source.length > 40) throw new Error(`${label} must be an array containing at most 40 SCL statements.`);
    return source.map((item, index) => {
        budget.count += 1;
        if (budget.count > 100) throw new Error(`${label} contains more than 100 total SCL statements.`);
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${label}[${index}] is not a valid SCL statement.`);
        const op = String(item.op || '');
        if (op === 'toast') return {op, message:String(item.message || '').slice(0,200)};
        if (op === 'setSetting') {
            if (!isSafeSclKey(item.setting, 40)) throw new Error(`${label}[${index}] has an invalid setting name.`);
            return {op, setting:String(item.setting), value:item.value};
        }
        if (op === 'setFeature') {
            if (!isSafeSclKey(item.feature, 50)) throw new Error(`${label}[${index}] has an invalid feature name.`);
            return {op, feature:String(item.feature), enabled:item.enabled};
        }
        if (op === 'setState' || op === 'incrementState') {
            const key = String(item.key || '');
            if (!isSafeSclKey(key, 40)) throw new Error(`${label}[${index}] has an invalid state key.`);
            if (op === 'incrementState' && !Number.isFinite(Number(item.by ?? 1))) throw new Error(`${label}[${index}] increment amount must be a number.`);
            return op === 'setState' ? {op, key, value:item.value} : {op, key, by:Number(item.by ?? 1)};
        }
        if (op === 'if') {
            const condition = item.condition;
            if (!condition || typeof condition !== 'object' || Array.isArray(condition)) throw new Error(`${label}[${index}] needs a condition object.`);
            const sourceType = String(condition.source || '');
            if (!['setting','state','feature','value'].includes(sourceType)) throw new Error(`${label}[${index}] uses an unsupported condition source.`);
            const key = String(condition.key || '');
            if (sourceType !== 'value' && !isSafeSclKey(key, sourceType === 'feature' ? 50 : 40)) throw new Error(`${label}[${index}] condition has an invalid key.`);
            const comparators = ['equals','notEquals','greaterThan','lessThan','truthy'].filter(name => Object.prototype.hasOwnProperty.call(condition, name));
            if (comparators.length !== 1) throw new Error(`${label}[${index}] condition must contain exactly one comparator.`);
            const comparator = comparators[0], expected = condition[comparator];
            if (['greaterThan','lessThan'].includes(comparator) && !Number.isFinite(Number(expected))) throw new Error(`${label}[${index}] numeric comparison requires a number.`);
            if (comparator === 'truthy' && typeof expected !== 'boolean') throw new Error(`${label}[${index}] truthy must be true or false.`);
            if (['equals','notEquals'].includes(comparator) && expected !== null && !['string','number','boolean'].includes(typeof expected)) throw new Error(`${label}[${index}] comparisons must use a JSON primitive.`);
            const thenCommands = normalizeSclCommands(item.then, `${label}[${index}].then`, depth + 1, budget);
            const elseCommands = normalizeSclCommands(item.else, `${label}[${index}].else`, depth + 1, budget);
            return {op, condition:{source:sourceType, ...(sourceType === 'value' ? {} : {key}), [comparator]:expected}, then:thenCommands, else:elseCommands};
        }
        if (op === 'call') {
            const api = String(item.api || '');
            if (!SCL_APIS.has(api)) throw new Error(`${label}[${index}] calls an API that this S-Client version does not support: ${api || '(empty)'}.`);
            return {op, api, value:item.value, action:String(item.action || '')};
        }
        throw new Error(`${label}[${index}] uses an unknown SCL operation: ${op || '(empty)'}.`);
    });
}
function normalizeSclControl(control, index) {
    if (!control || typeof control !== 'object' || Array.isArray(control)) throw new Error(`controls[${index}] is invalid.`);
    const type = String(control.type || '');
    const id = String(control.id || `control-${index + 1}`);
    if (!SCL_CONTROL_TYPES.has(type) || !isSafeSclKey(id, 40)) throw new Error(`controls[${index}] has an invalid type or ID.`);
    const result = {
        id, type,
        label:String(control.label || id).slice(0,70),
        description:String(control.description || '').slice(0,200),
        text:String(control.text || '').slice(0,1000),
        setting:String(control.setting || ''),
        min:Number.isFinite(Number(control.min)) ? Number(control.min) : 0,
        max:Number.isFinite(Number(control.max)) ? Number(control.max) : 100,
        step:Number.isFinite(Number(control.step)) ? Number(control.step) : 1,
        options:Array.isArray(control.options) ? control.options.slice(0,20).map(option => ({value:String(option.value ?? '').slice(0,60),label:String(option.label || option.value || '').slice(0,60)})).filter(option => option.value && option.label) : [],
        onClick:normalizeSclCommands(control.onClick, `controls[${index}].onClick`),
        onChange:normalizeSclCommands(control.onChange, `controls[${index}].onChange`)
    };
    if (type === 'slider' && (result.max <= result.min || result.max - result.min > 1000000)) throw new Error(`controls[${index}] has an invalid slider range.`);
    if (['toggle','select','slider'].includes(type) && !/^[a-zA-Z0-9_-]{1,40}$/.test(result.setting)) throw new Error(`controls[${index}] must reference a declared setting.`);
    if (type === 'shaderPicker' && !result.onChange.length) throw new Error(`controls[${index}] shaderPicker needs an onChange SCL handler.`);
    return result;
}
function normalizeManifest(raw) {
    if (!raw || raw.format !== 'sclient-mod') throw new Error('This is not an S-Client mod.');
    if (JSON.stringify(raw).length > 200000) throw new Error('A .sclient mod must be smaller than 200 KB.');
    const formatVersion = Number(raw.formatVersion);
    if (![1,2].includes(formatVersion)) throw new Error('Unsupported .sclient format version. Supported versions are 1 and 2 (SCL).');
    if (!['aquavoid','swell'].includes(String(raw.game || '').toLowerCase())) throw new Error('This mod is not made for Aquavoid.');
    const id = String(raw.id || '').trim(), name = String(raw.name || '').trim();
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(id) || !name || name.length > 70) throw new Error('The mod ID or name is invalid.');
    const features = Array.isArray(raw.features) ? raw.features.slice(0,30).map(f => ({id:String(f.id || ''), name:String(f.name || f.id || 'Feature').slice(0,60), description:String(f.description || '').slice(0,150), defaultEnabled:!!f.defaultEnabled})).filter(f => isSafeSclKey(f.id, 50) && (formatVersion === 2 || SUPPORTED_FEATURES.has(f.id))) : [];
    const actions = Array.isArray(raw.actions) ? raw.actions.slice(0,30).map(a => ({id:String(a.id || ''), label:String(a.label || a.id || 'Action').slice(0,60), action:String(a.action || ''), value:Number.isFinite(Number(a.value)) ? Number(a.value) : undefined})).filter(a => /^[a-zA-Z0-9_-]{1,50}$/.test(a.id) && SUPPORTED_ACTIONS.has(a.action)) : [];
    const settings = Array.isArray(raw.settings) ? raw.settings.slice(0,30).map(normalizeSetting).filter(Boolean) : [];
    const settingIds = new Set(settings.map(item => item.id));
    const permissions = formatVersion === 2 ? (Array.isArray(raw.permissions) ? [...new Set(raw.permissions.map(String))] : []) : [];
    if (permissions.some(permission => !SCL_PERMISSIONS.has(permission))) throw new Error('This mod requests an unknown SCL permission.');
    const controls = formatVersion === 2 ? (Array.isArray(raw.controls) ? raw.controls.slice(0,30).map(normalizeSclControl) : []) : [];
    controls.forEach(control => {
        if (control.setting && !settingIds.has(control.setting)) throw new Error(`Control "${control.id}" references missing setting "${control.setting}".`);
        const setting = settings.find(item => item.id === control.setting);
        if (control.type === 'toggle' && setting?.type !== 'toggle') throw new Error(`Control "${control.id}" requires a toggle setting.`);
        if (control.type === 'select' && setting?.type !== 'select') throw new Error(`Control "${control.id}" requires a select setting.`);
        if (control.type === 'slider' && !['slider','number'].includes(setting?.type)) throw new Error(`Control "${control.id}" requires a slider or number setting.`);
        if (control.type === 'select' && setting?.type === 'select') control.options = setting.options;
        if (control.type === 'shaderPicker' && (id !== 'eyesight' || !permissions.includes('eyesight.presets'))) throw new Error('shaderPicker is reserved for the Eyesight mod and requires the eyesight.presets permission.')
    });
    const program = {};
    if (formatVersion === 2) {
        if (String(raw.language || 'SCL') !== 'SCL') throw new Error('formatVersion 2 mods must declare language "SCL".');
        if (Number(raw.languageVersion || SCL_VERSION) !== SCL_VERSION) throw new Error(`Unsupported SCL language version. This client supports version ${SCL_VERSION}.`);
        for (const event of SCL_EVENTS) program[event] = normalizeSclCommands(raw.program?.[event], `program.${event}`);
    }
    if (formatVersion === 2) {
        if (actions.length && !permissions.includes('aquavoid.actions')) throw new Error('Legacy action buttons in an SCL mod require the aquavoid.actions permission.');
        if (features.some(feature => SUPPORTED_FEATURES.has(feature.id)) && !permissions.includes('aquavoid.features')) throw new Error('Built-in Aquavoid feature IDs require the aquavoid.features permission.');
        const allHandlers = [...Object.values(program), ...controls.flatMap(control => [control.onClick, control.onChange])];
        const validateStatementReferences = statements => statements.forEach(statement => {
            if (statement.op === 'setSetting' && !settingIds.has(statement.setting)) throw new Error(`SCL references missing setting "${statement.setting}".`);
            if (statement.op === 'setFeature' && !features.some(feature => feature.id === statement.feature)) throw new Error(`SCL references missing feature "${statement.feature}".`);
            if (statement.op === 'if') {
                if (statement.condition.source === 'setting' && !settingIds.has(statement.condition.key)) throw new Error(`SCL condition references missing setting "${statement.condition.key}".`);
                if (statement.condition.source === 'feature' && !features.some(feature => feature.id === statement.condition.key)) throw new Error(`SCL condition references missing feature "${statement.condition.key}".`);
                validateStatementReferences(statement.then); validateStatementReferences(statement.else);
            }
            if (statement.op === 'call' && statement.api === 'aquavoid.action' && (!permissions.includes('aquavoid.actions') || !SUPPORTED_ACTIONS.has(statement.action))) throw new Error('aquavoid.action requires aquavoid.actions and a supported action ID.');
            if (statement.op === 'call' && ['eyesight.selectPreset','eyesight.reset'].includes(statement.api) && (id !== 'eyesight' || !permissions.includes('eyesight.presets'))) throw new Error('Eyesight APIs require mod ID "eyesight" and the eyesight.presets permission.');
        });
        allHandlers.forEach(validateStatementReferences);
    }
    const hasV2Behavior = controls.length || Object.values(program).some(commands => commands.length);
    if (!features.length && !actions.length && !hasV2Behavior) throw new Error('This mod contains no features, actions, controls or SCL handlers.');
    return {
        format:'sclient-mod', formatVersion, ...(formatVersion === 2 ? {language:'SCL',languageVersion:SCL_VERSION,permissions,controls,program} : {}),
        id, name, version:String(raw.version || '1.0.0').slice(0,24), author:String(raw.author || 'Unknown').slice(0,60),
        game:'aquavoid', description:String(raw.description || '').slice(0,220), icon:String(raw.icon || '◇').slice(0,4),
        features, actions, settings
    };
}
function waveThemesManifest(defaultTheme = 'default') {
    return {
        format:'sclient-mod', formatVersion:1, id:'wave-themes', name:'Wave Themes', version:'1.0.0',
        author:'S-Client', game:'aquavoid', icon:'🌊',
        description:'Choose the ocean atmosphere: Default, Aurora, Galaxy, or a muted bathhouse-green sea.',
        features:[{id:'waveThemes',name:'Enable wave themes',description:'Apply your selected water palette to the Aquavoid ocean.',defaultEnabled:true}],
        settings:[{id:'theme',label:'Water theme',type:'select',defaultValue:defaultTheme,options:[
            {value:'default',label:'Default waves'},
            {value:'aurora',label:'Aurora waves'},
            {value:'galaxy',label:'Galaxy waves'},
            {value:'bathhouse',label:'Bathhouse green'}
        ]}],
        actions:[]
    };
}
function formatVersionIsScl(manifest) { return Number(manifest?.formatVersion) === 2 && manifest?.language === 'SCL'; }
function upsertManifest(raw) {
    // New imports of the retired Nebula Ocean mod are redirected into Wave Themes.
    if (raw && String(raw.id || '').toLowerCase() === 'nebula-ocean') raw = waveThemesManifest('galaxy');
    const manifest = normalizeManifest(raw);
    const index = installedMods.findIndex(item => item.manifest.id === manifest.id);
    const oldRecord = index >= 0 ? installedMods[index] : null;
    const states = {};
    manifest.features.forEach(feature => { states[feature.id] = oldRecord?.featureStates?.[feature.id] ?? feature.defaultEnabled; });
    const settings = {};
    manifest.settings.forEach(setting => {
        const previous = oldRecord?.settings?.[setting.id];
        try { settings[setting.id] = previous === undefined ? setting.defaultValue : coerceSclSetting(setting, previous); }
        catch (_) { settings[setting.id] = setting.defaultValue; }
    });
    const record = {manifest, enabled:!!oldRecord?.enabled, featureStates:states, settings, state:{ ...(oldRecord?.state || {}) }};
    if (index >= 0) installedMods[index] = record; else installedMods.push(record);
    if (!oldRecord && formatVersionIsScl(manifest)) executeSclEvent(record, 'onInstall');
    return manifest.name;
}
function exportManifest(record) {
    // Export is available only from a mod in this signed-in user's private library.
    if (!record || !installedMods.includes(record)) return;
    downloadJSON(`${record.manifest.id}.sclient`, record.manifest);
}
function downloadJSON(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
}

// No bundled mods are seeded here. A mod appears in the library only after the
// signed-in user explicitly imports it. Older account records are left untouched;
// importing an old Nebula Ocean file explicitly still maps it to Wave Themes.

// Built-in Eyesight looks are safe colour-grade presets, not remotely executed GLSL.
const BUILTIN_SHADERS = [
    {id:'builtin-clearwater',name:'Clearwater',description:'Clean ocean color, crisp contrast and natural brightness.',builtIn:true,settings:{brightness:1.04,contrast:1.04,saturation:1.12,hue:0,tint:'#8bd8dc',tintStrength:.025,vignette:.08,grain:0}},
    {id:'builtin-moonlit',name:'Moonlit',description:'Cool violet night tones with a soft cinematic edge.',builtIn:true,settings:{brightness:.98,contrast:1.12,saturation:1.22,hue:9,tint:'#7861bd',tintStrength:.12,vignette:.28,grain:.015}},
    {id:'builtin-abyss',name:'Abyss',description:'Deep blue shadows, punchier highlights and subtle vignette.',builtIn:true,settings:{brightness:.9,contrast:1.2,saturation:1.18,hue:-9,tint:'#1e527c',tintStrength:.1,vignette:.38,grain:.02}}
];
let customShaderPacks = Array.isArray(window.SCLIENT_BOOT?.shaders?.customPacks) ? window.SCLIENT_BOOT.shaders.customPacks : [];
let activeShaderId = String(window.SCLIENT_BOOT?.shaders?.activePackId || '');
if (![...BUILTIN_SHADERS, ...customShaderPacks].some(pack => pack.id === activeShaderId)) activeShaderId = '';
function normalizeShaderPack(raw) {
    if (!raw || raw.format !== 'sclient-shaderpack' || Number(raw.formatVersion) !== 1) throw new Error('This is not a supported .shadersclient pack.');
    const id = String(raw.id || '').trim(), name = String(raw.name || '').trim();
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(id) || !name || name.length > 70) throw new Error('Shader pack ID or name is invalid.');
    const source = raw.settings || {};
    const hex = /^#[0-9a-f]{6}$/i.test(String(source.tint || '')) ? String(source.tint) : '#6f7dbb';
    const number = (key, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(source[key])) ? Number(source[key]) : fallback));
    return {format:'sclient-shaderpack',formatVersion:1,id,name,author:String(raw.author || 'Unknown').slice(0,60),description:String(raw.description || '').slice(0,180),settings:{brightness:number('brightness',1,.7,1.3),contrast:number('contrast',1,.7,1.5),saturation:number('saturation',1,0,1.8),hue:number('hue',0,-45,45),tint:hex,tintStrength:number('tintStrength',0,0,.35),vignette:number('vignette',.1,0,.7),grain:number('grain',0,0,.1)}};
}
function allShaderPacks() { return [...BUILTIN_SHADERS, ...customShaderPacks]; }
function saveShaders() {
    const data = {activePackId, customPacks:customShaderPacks};
    const size = new Blob([JSON.stringify(data)]).size;
    if (size > 650000) { toast('Your shader library is too large for one cloud save. Remove a large custom pack.'); return Promise.resolve(false); }
    return window.SClientCloud.saveShaders(data).catch(error => { console.error('Shader cloud save failed:', error); toast('Could not sync shader packs to Firestore.'); return false; });
}
function applyEyesightShader() {
    const record = installedMods.find(item => item.manifest?.id === 'eyesight' && item.enabled && item.featureStates?.eyesightEnabled === true);
    const pack = record && activeShaderId ? allShaderPacks().find(item => item.id === activeShaderId) || null : null;
    if (!pack) {
        eyesightPassEnabled = false;
        eyesightPassUniforms.uBrightness.value = 1;
        eyesightPassUniforms.uContrast.value = 1;
        eyesightPassUniforms.uSaturation.value = 1;
        eyesightPassUniforms.uHue.value = 0;
        eyesightPassUniforms.uTint.value.set('#ffffff');
        eyesightPassUniforms.uTintStrength.value = 0;
        eyesightPassUniforms.uVignette.value = 0;
        eyesightPassUniforms.uGrain.value = 0;
        return;
    }
    const fx = pack.settings;
    eyesightPassUniforms.uBrightness.value = fx.brightness;
    eyesightPassUniforms.uContrast.value = fx.contrast;
    eyesightPassUniforms.uSaturation.value = fx.saturation;
    eyesightPassUniforms.uHue.value = fx.hue;
    eyesightPassUniforms.uTint.value.set(fx.tint);
    eyesightPassUniforms.uTintStrength.value = fx.tintStrength;
    eyesightPassUniforms.uVignette.value = fx.vignette;
    eyesightPassUniforms.uGrain.value = fx.grain;
    eyesightPassEnabled = true;
}
function saveAndRenderMods(message) {
    saveMods(); renderInstalledMods(); applyEyesightShader(); refreshKitacatShip();
    if (message) toast(message);
}
function renderModLibrary() {
    currentModsSubpage = 'library';
    $('modsLibraryView').hidden = false;
    $('modDetailView').hidden = true;
    $('installedMods').replaceChildren();
    $('modCount').textContent = String(installedMods.length);
    $('installedLabel').textContent = `${installedMods.length} OWNED`;
    if (!installedMods.length) {
        const empty = document.createElement('div'); empty.className = 'empty-state';
        empty.innerHTML = '<div class="empty-icon">◇</div><h3>Your private mod library is empty</h3><p>Import one or more <code>.sclient</code> files, or import a ZIP containing mods. Only mods in your own account appear here.</p><button class="outline-button" type="button">IMPORT MODS</button>';
        empty.querySelector('button').addEventListener('click', () => $('modFileInput').click());
        $('installedMods').appendChild(empty);
    }
    installedMods.forEach((record, index) => {
        const manifest = record.manifest;
        const card = document.createElement('article'); card.className = 'installed-mod-card owned-mod-card';
        const icon = document.createElement('div'); icon.className = 'mod-icon'; icon.textContent = manifest.icon || '◇';
        const info = document.createElement('div'); info.className = 'available-mod-info';
        info.innerHTML = `<div class="available-title-row"><h3>${escapeHTML(manifest.name)}</h3><span class="optional-chip">${record.enabled ? 'ENABLED' : 'DISABLED'}</span></div><p>${escapeHTML(manifest.description || 'Imported S-Client mod.')}</p><div class="mod-meta"><span>v${escapeHTML(manifest.version)}</span><span>·</span><span>${escapeHTML(manifest.author)}</span>${manifest.formatVersion === 2 ? '<span>·</span><span>SCL v1</span>' : ''}</div>`;
        const buttons = document.createElement('div'); buttons.className = 'owned-mod-actions';
        const configure = document.createElement('button'); configure.type = 'button'; configure.className = 'download-button'; configure.textContent = 'OPEN PAGE'; configure.addEventListener('click', () => openModPage(record.manifest.id));
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = `toggle${record.enabled ? ' on' : ''}`; toggle.setAttribute('aria-label', record.enabled ? 'Disable mod' : 'Enable mod'); toggle.addEventListener('click', () => { record.enabled = !record.enabled; executeSclEvent(record, record.enabled ? 'onEnable' : 'onDisable'); saveAndRenderMods(`${manifest.name} ${record.enabled ? 'enabled' : 'disabled'}.`); });
        const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.className = 'quiet-button'; exportButton.textContent = 'EXPORT'; exportButton.title = 'Export a copy of this mod you own'; exportButton.addEventListener('click', () => exportManifest(record));
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet-button danger-button'; remove.textContent = 'REMOVE'; remove.addEventListener('click', () => { installedMods.splice(index, 1); if (activeModId === manifest.id) activeModId = null; saveAndRenderMods(`${manifest.name} removed from your library.`); });
        buttons.append(configure, toggle, exportButton, remove); card.append(icon, info, buttons); $('installedMods').appendChild(card);
    });
}
function openModPage(modId) {
    const record = installedMods.find(item => item.manifest.id === modId);
    if (!record) return;
    activeModId = modId; currentModsSubpage = 'detail';
    $('modsLibraryView').hidden = true; $('modDetailView').hidden = false;
    renderModPage(record);
}
function addFeatureControl(record, feature, host) {
    const row = document.createElement('div'); row.className = 'mod-setting-row';
    const text = document.createElement('div'); text.className = 'mod-setting-copy';
    text.innerHTML = `<strong>${escapeHTML(feature.name)}</strong><small>${escapeHTML(feature.description || '')}</small>`;
    const control = document.createElement('button'); control.type = 'button'; control.className = `toggle${record.featureStates?.[feature.id] ? ' on' : ''}`;
    control.setAttribute('aria-label', `${record.featureStates?.[feature.id] ? 'Disable' : 'Enable'} ${feature.name}`);
    control.addEventListener('click', () => { record.featureStates[feature.id] = !record.featureStates[feature.id]; executeSclEvent(record, 'onFeatureChange', {feature:feature.id, value:record.featureStates[feature.id], enabled:record.featureStates[feature.id]}); saveMods(); renderModPage(record); applyEyesightShader(); if (feature.id === 'kitacatShip') refreshKitacatShip(); });
    row.append(text, control); host.appendChild(row);
}
function renderSclShaderPicker(host, record, control) {
    const section = document.createElement('section');
    section.className = 'eyesight-page';
    const headingText = document.createElement('div');
    headingText.innerHTML = '<span class="eyebrow">LIVE WEBGL POST-PROCESSING</span>';
    const title = document.createElement('h2'); title.textContent = control.label || 'Choose your visual style';
    const description = document.createElement('p'); description.textContent = control.description || 'Select a look to preview it instantly. No Apply button is needed.';
    headingText.append(title, description);
    const heading = document.createElement('div'); heading.className = 'eyesight-console-heading';
    const status = document.createElement('span'); status.className = 'eyesight-live-status'; status.innerHTML = '<i></i> LIVE PREVIEW';
    heading.append(headingText, status); section.appendChild(heading);
    const builtinHeading = document.createElement('div'); builtinHeading.className = 'shader-library-heading';
    builtinHeading.innerHTML = '<div><h3>Built-in looks</h3><p>Clean, cinematic and deep-ocean colour grades.</p></div>';
    section.appendChild(builtinHeading);
    const builtinGrid = document.createElement('div'); builtinGrid.className = 'shader-grid'; section.appendChild(builtinGrid);
    const original = {id:'',name:'Original',description:'Keep Aquavoid’s natural rendering with no Eyesight colour grade.',settings:{brightness:1,contrast:1,saturation:1,hue:0,tint:'#ffffff',tintStrength:0,vignette:0,grain:0}};
    const choicePacks = [original, ...BUILTIN_SHADERS];
    function selectPack(pack) {
        executeSclCommands(record, control.onChange, {value:pack.id});
        if (activeModId === record.manifest.id) renderModPage(record);
        else applyEyesightShader();
    }
    function makeChoice(pack, custom = false) {
        const active = activeShaderId === pack.id;
        const card = document.createElement('button'); card.type = 'button';
        card.className = `shader-card${active ? ' selected' : ''}${custom ? ' custom-shader-choice' : ''}`;
        card.setAttribute('aria-pressed', active ? 'true' : 'false');
        card.setAttribute('aria-label', `${pack.name}${active ? ', currently selected' : ', select visual style'}`);
        const preview = document.createElement('span'); preview.className = `shader-preview shader-${pack.id ? pack.id.replace('builtin-','') : 'original'}`;
        const copy = document.createElement('span'); copy.className = 'shader-copy';
        const name = document.createElement('strong'); name.textContent = pack.name;
        const detail = document.createElement('small'); detail.textContent = pack.description || 'Custom Eyesight colour grade.';
        copy.append(name, detail);
        const state = document.createElement('span'); state.className = 'shader-choice-state'; state.textContent = active ? '✓ SELECTED' : 'SELECT LOOK';
        card.append(preview, copy, state); card.disabled = !record.enabled;
        card.addEventListener('click', () => selectPack(pack));
        return card;
    }
    choicePacks.forEach(pack => builtinGrid.appendChild(makeChoice(pack)));
    const customHeading = document.createElement('div'); customHeading.className = 'shader-library-heading custom-shader-heading';
    const customTitle = document.createElement('div'); customTitle.innerHTML = '<h3>Your shader packs</h3><p>Import a look or share one with other S-Client players.</p>';
    const importButton = document.createElement('button'); importButton.className = 'import-button'; importButton.type = 'button'; importButton.textContent = '＋ IMPORT SHADERPACK';
    customHeading.append(customTitle, importButton); section.appendChild(customHeading);
    const customRoot = document.createElement('div'); customRoot.className = 'custom-shader-grid'; section.appendChild(customRoot);
    const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = '.shadersclient,application/json,.json'; fileInput.multiple = true; fileInput.hidden = true; section.appendChild(fileInput);
    if (!customShaderPacks.length) {
        const empty = document.createElement('p'); empty.className = 'shader-empty'; empty.textContent = 'No custom looks yet. Import a .shadersclient file to add one here.'; customRoot.appendChild(empty);
    }
    customShaderPacks.forEach((pack, index) => {
        const wrapper = document.createElement('article'); wrapper.className = 'custom-shader-card'; wrapper.appendChild(makeChoice(pack, true));
        const actions = document.createElement('div'); actions.className = 'custom-shader-actions';
        const exportButton = document.createElement('button'); exportButton.className = 'quiet-button'; exportButton.type = 'button'; exportButton.textContent = 'EXPORT';
        exportButton.addEventListener('click', () => downloadJSON(`${pack.id}.shadersclient`, pack));
        const removeButton = document.createElement('button'); removeButton.className = 'quiet-button danger-button'; removeButton.type = 'button'; removeButton.textContent = 'REMOVE';
        removeButton.addEventListener('click', () => {
            customShaderPacks.splice(index, 1); if (activeShaderId === pack.id) activeShaderId = '';
            saveShaders(); applyEyesightShader(); renderModPage(record);
        });
        actions.append(exportButton, removeButton); wrapper.appendChild(actions); customRoot.appendChild(wrapper);
    });
    const eyesightEnabled = !!(record.enabled && record.featureStates?.eyesightEnabled === true && activeShaderId);
    status.classList.toggle('is-off', !eyesightEnabled); status.innerHTML = eyesightEnabled ? '<i></i> LIVE PREVIEW ON' : '<i></i> LIVE PREVIEW OFF';
    importButton.disabled = !record.enabled;
    importButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async event => { await importShaderFiles([...event.target.files]); event.target.value = ''; });
    host.appendChild(section);
}

function sclResolveValue(value, record, context) {
    if (typeof value !== 'string') return value;
    if (value === '$value') return context.value;
    if (value === '$feature') return context.feature;
    if (value === '$enabled') return context.enabled;
    if (value.startsWith('$setting:')) return record.settings?.[value.slice(9)];
    if (value.startsWith('$state:')) return record.state?.[value.slice(7)];
    if (value === '$mod.id') return record.manifest.id;
    if (value === '$mod.name') return record.manifest.name;
    return value;
}
function sclPermission(record, permission) {
    return Array.isArray(record.manifest.permissions) && record.manifest.permissions.includes(permission);
}
function coerceSclSetting(setting, value) {
    if (!setting) throw new Error('SCL referenced a setting that does not exist.');
    if (setting.type === 'toggle') return value === true;
    if (setting.type === 'select') {
        const text = String(value);
        if (!setting.options.some(option => option.value === text)) throw new Error(`Invalid option for ${setting.label}.`);
        return text;
    }
    if (setting.type === 'slider' || setting.type === 'number') {
        const number = Number(value); if (!Number.isFinite(number)) throw new Error(`Invalid number for ${setting.label}.`);
        return Math.max(setting.min, Math.min(setting.max, number));
    }
    if (setting.type === 'color') {
        const text = String(value); if (!/^#[0-9a-f]{6}$/i.test(text)) throw new Error(`Invalid colour for ${setting.label}.`); return text;
    }
    if (setting.type === 'text') return String(value).slice(0, setting.maxLength || 80);
    throw new Error(`Unsupported SCL setting type: ${setting.type}`);
}
function testSclCondition(condition, record, context) {
    let actual;
    if (condition.source === 'setting') actual = record.settings?.[condition.key];
    else if (condition.source === 'state') actual = record.state?.[condition.key];
    else if (condition.source === 'feature') actual = record.featureStates?.[condition.key] === true;
    else actual = context.value;
    if (Object.prototype.hasOwnProperty.call(condition, 'equals')) return actual === condition.equals;
    if (Object.prototype.hasOwnProperty.call(condition, 'notEquals')) return actual !== condition.notEquals;
    if (Object.prototype.hasOwnProperty.call(condition, 'greaterThan')) return Number.isFinite(Number(actual)) && Number(actual) > condition.greaterThan;
    if (Object.prototype.hasOwnProperty.call(condition, 'lessThan')) return Number.isFinite(Number(actual)) && Number(actual) < condition.lessThan;
    if (Object.prototype.hasOwnProperty.call(condition, 'truthy')) return (!!actual) === condition.truthy;
    return false;
}
function executeSclCommands(record, commands, context = {}) {
    if (!record || !Array.isArray(commands)) return;
    let changed = false, executed = 0;
    const run = (list, depth = 0) => {
        if (depth > 4) throw new Error('SCL nesting limit exceeded.');
        for (const statement of list) {
            executed += 1;
            if (executed > 100) throw new Error('SCL execution limit exceeded.');
            const value = sclResolveValue(statement.value, record, context);
            if (statement.op === 'if') {
                run(testSclCondition(statement.condition, record, context) ? statement.then : statement.else, depth + 1);
            } else if (statement.op === 'toast') {
                let message = String(statement.message || '');
                message = message.replaceAll('$mod.name', record.manifest.name).replaceAll('$mod.id', record.manifest.id)
                    .replaceAll('$value', String(context.value ?? '')).replaceAll('$feature', String(context.feature ?? ''))
                    .replaceAll('$enabled', String(context.enabled ?? ''));
                message = message.replace(/\$setting:([a-zA-Z0-9_-]{1,40})/g, (_, key) => String(record.settings?.[key] ?? ''))
                    .replace(/\$state:([a-zA-Z0-9_-]{1,40})/g, (_, key) => String(record.state?.[key] ?? ''));
                if (message) toast(message);
            } else if (statement.op === 'setSetting') {
                const definition = record.manifest.settings.find(item => item.id === statement.setting);
                record.settings[statement.setting] = coerceSclSetting(definition, value); changed = true;
            } else if (statement.op === 'setFeature') {
                if (!record.manifest.features.some(item => item.id === statement.feature)) throw new Error(`Unknown feature: ${statement.feature}`);
                const enabled = statement.enabled === '$value' ? !!context.value : statement.enabled === '$enabled' ? !!context.enabled : statement.enabled === true;
                record.featureStates[statement.feature] = enabled; changed = true;
            } else if (statement.op === 'setState') {
                if (value === undefined || ['object','function'].includes(typeof value)) throw new Error('SCL state values must be simple JSON values.');
                record.state[statement.key] = value; changed = true;
            } else if (statement.op === 'incrementState') {
                const current = Number(record.state?.[statement.key] || 0);
                if (!Number.isFinite(current)) throw new Error(`State key "${statement.key}" is not numeric.`);
                record.state[statement.key] = Math.max(-1000000000, Math.min(1000000000, current + statement.by)); changed = true;
            } else if (statement.op === 'call') {
                if (statement.api === 'ui.toast') {
                    if (value !== undefined && String(value)) toast(String(value).slice(0,200));
                } else if (statement.api === 'eyesight.selectPreset') {
                    if (record.manifest.id !== 'eyesight' || !sclPermission(record, 'eyesight.presets')) throw new Error('The eyesight.presets permission is required.');
                    const presetId = String(value ?? '');
                    if (presetId && !allShaderPacks().some(pack => pack.id === presetId)) throw new Error('That Eyesight preset is not installed.');
                    activeShaderId = presetId; applyEyesightShader(); saveShaders();
                } else if (statement.api === 'eyesight.reset') {
                    if (record.manifest.id !== 'eyesight' || !sclPermission(record, 'eyesight.presets')) throw new Error('The eyesight.presets permission is required.');
                    activeShaderId = ''; applyEyesightShader(); saveShaders();
                } else if (statement.api === 'aquavoid.action') {
                    if (!sclPermission(record, 'aquavoid.actions') || !SUPPORTED_ACTIONS.has(statement.action)) throw new Error('The aquavoid.actions permission or requested action is unavailable.');
                    runModAction({action:statement.action, value:Number(value) || 0});
                }
            }
        }
    };
    try {
        run(commands.slice(0,40));
    } catch (error) {
        console.warn(`SCL runtime error in ${record.manifest.id}:`, error);
        toast(`SCL error: ${error.message}`);
    } finally {
        if (changed) { saveMods(); applyEyesightShader(); if (activeModId === record.manifest.id) renderModPage(record); }
    }
}
function executeSclEvent(record, event, context = {}) {
    const commands = record?.manifest?.program?.[event];
    if (Array.isArray(commands) && commands.length) executeSclCommands(record, commands, context);
}
function updateSclSetting(record, settingId, rawValue, onChange = []) {
    const setting = record.manifest.settings.find(item => item.id === settingId);
    try {
        record.settings[settingId] = coerceSclSetting(setting, rawValue);
        saveMods();
        executeSclCommands(record, onChange, {value:record.settings[settingId], setting:settingId});
        executeSclEvent(record, 'onSettingChange', {value:record.settings[settingId], setting:settingId});
        applyEyesightShader();
        if (activeModId === record.manifest.id) renderModPage(record);
    } catch (error) { toast(`Setting error: ${error.message}`); }
}
function renderSclControls(record, host) {
    const controls = record.manifest.controls || [];
    if (!controls.length) return;
    controls.forEach(control => {
        if (control.type === 'shaderPicker') { renderSclShaderPicker(host, record, control); return; }
        if (control.type === 'text') {
            const section = document.createElement('section'); section.className = 'mod-page-section';
            const paragraph = document.createElement('p'); paragraph.className = 'scl-help-text'; paragraph.textContent = control.text || control.description || control.label;
            section.appendChild(paragraph); host.appendChild(section); return;
        }
        if (control.type === 'button') {
            const section = document.createElement('section'); section.className = 'mod-page-section';
            const button = document.createElement('button'); button.type = 'button'; button.className = 'cheat-action mod-page-action'; button.textContent = control.label; button.disabled = !record.enabled;
            button.addEventListener('click', () => executeSclCommands(record, control.onClick, {control:control.id}));
            if (control.description) { const note = document.createElement('p'); note.className = 'scl-help-text'; note.textContent = control.description; section.appendChild(note); }
            section.appendChild(button); host.appendChild(section); return;
        }
        const row = document.createElement('label'); row.className = 'mod-setting-row';
        const copy = document.createElement('div'); copy.className = 'mod-setting-copy';
        const title = document.createElement('strong'); title.textContent = control.label;
        const detail = document.createElement('small'); detail.textContent = control.description;
        copy.append(title, detail); row.appendChild(copy);
        const setting = record.manifest.settings.find(item => item.id === control.setting);
        const current = record.settings[control.setting] ?? setting.defaultValue;
        let input;
        if (control.type === 'toggle') {
            input = document.createElement('button'); input.type = 'button'; input.className = `toggle${current ? ' on' : ''}`; input.setAttribute('aria-label', control.label);
            input.addEventListener('click', () => updateSclSetting(record, control.setting, !record.settings[control.setting], control.onChange));
        } else if (control.type === 'select') {
            input = document.createElement('select'); input.className = 'mod-select';
            control.options.forEach(option => { const item = document.createElement('option'); item.value = option.value; item.textContent = option.label; input.appendChild(item); });
            input.value = String(current); input.addEventListener('change', () => updateSclSetting(record, control.setting, input.value, control.onChange));
        } else {
            input = document.createElement('input'); input.type = 'range'; input.min = String(setting.min); input.max = String(setting.max); input.step = String(setting.step); input.value = String(current); input.className = 'scl-range';
            input.addEventListener('input', () => { const value = Number(input.value); record.settings[control.setting] = coerceSclSetting(setting, value); const valueLabel = row.querySelector('.scl-value'); if (valueLabel) valueLabel.textContent = String(value); });
            input.addEventListener('change', () => updateSclSetting(record, control.setting, Number(input.value), control.onChange));
            const valueLabel = document.createElement('small'); valueLabel.className = 'scl-value'; valueLabel.textContent = String(current); copy.appendChild(valueLabel);
        }
        input.disabled = !record.enabled; row.appendChild(input); host.appendChild(row);
    });
}

function recordForEyesight() { return installedMods.find(item => item.manifest.id === 'eyesight'); }
function renderModPage(record) {
    const host = $('modDetailContent'); host.replaceChildren();
    const manifest = record.manifest;
    const heading = document.createElement('div'); heading.className = 'mod-detail-heading';
    heading.innerHTML = `<div class="mod-detail-icon">${escapeHTML(manifest.icon || '◇')}</div><div><div class="eyebrow">PRIVATE MOD PAGE · v${escapeHTML(manifest.version)}</div><h1>${escapeHTML(manifest.name)}</h1><p>${escapeHTML(manifest.description || '')}</p></div>`;
    const enabledChip = document.createElement('span'); enabledChip.className = `mod-state-chip${record.enabled ? ' on' : ''}`; enabledChip.textContent = record.enabled ? 'ENABLED' : 'DISABLED'; heading.appendChild(enabledChip); host.appendChild(heading);
    if (!record.enabled) { const note = document.createElement('div'); note.className = 'mod-disabled-note'; note.textContent = 'This mod is disabled. Enable it in your library to apply its settings to Aquavoid.'; host.appendChild(note); }
    if (manifest.features.length) {
        const featureSection = document.createElement('section'); featureSection.className = 'mod-page-section';
        featureSection.innerHTML = `<div class="section-heading"><div><h2>Features</h2><p>Built-in feature IDs activate supported S-Client hooks; custom IDs are available to this mod's SCL handlers.</p></div></div>`;
        manifest.features.forEach(feature => addFeatureControl(record, feature, featureSection)); host.appendChild(featureSection);
    }
    if (Array.isArray(manifest.permissions) && manifest.permissions.length) {
        const permissionLabels = {
            'ui.toast':'Show S-Client notifications',
            'eyesight.presets':'Select Eyesight visual presets',
            'aquavoid.features':'Toggle built-in Aquavoid feature hooks',
            'aquavoid.actions':'Run existing allowlisted Aquavoid actions'
        };
        const permissionSection = document.createElement('section'); permissionSection.className = 'mod-page-section';
        permissionSection.innerHTML = '<div class="section-heading"><div><h2>Requested capabilities</h2><p>This SCL mod declares the following host API permissions.</p></div></div>';
        manifest.permissions.forEach(permission => {
            const row = document.createElement('div'); row.className = 'mod-setting-row';
            const copy = document.createElement('div'); copy.className = 'mod-setting-copy';
            const strong = document.createElement('strong'); strong.textContent = permission;
            const small = document.createElement('small'); small.textContent = permissionLabels[permission] || 'S-Client capability';
            copy.append(strong, small); row.appendChild(copy); permissionSection.appendChild(row);
        });
        host.appendChild(permissionSection);
    }
    const controlledSettingIds = new Set((manifest.controls || []).map(control => control.setting).filter(Boolean));
    const standaloneSettings = (manifest.settings || []).filter(setting => !controlledSettingIds.has(setting.id));
    if (standaloneSettings.length) {
        const settingSection = document.createElement('section'); settingSection.className = 'mod-page-section';
        settingSection.innerHTML = '<div class="section-heading"><div><h2>Mod settings</h2><p>Choose how this mod behaves. Changes save to your account.</p></div></div>';
        standaloneSettings.forEach(setting => {
            const row = document.createElement('label'); row.className = 'mod-setting-row';
            const copy = document.createElement('div'); copy.className = 'mod-setting-copy';
            const strong = document.createElement('strong'); strong.textContent = setting.label;
            const small = document.createElement('small'); small.textContent = setting.description || '';
            copy.append(strong, small); row.appendChild(copy);
            let input;
            const value = record.settings?.[setting.id] ?? setting.defaultValue;
            if (setting.type === 'select') {
                input = document.createElement('select'); input.className = 'mod-select';
                setting.options.forEach(option => { const item = document.createElement('option'); item.value = option.value; item.textContent = option.label; input.appendChild(item); });
                input.value = String(value);
            } else if (setting.type === 'toggle') {
                input = document.createElement('button'); input.type = 'button'; input.className = `toggle${value ? ' on' : ''}`;
                input.addEventListener('click', () => updateSclSetting(record, setting.id, !record.settings[setting.id]));
            } else if (setting.type === 'color') {
                input = document.createElement('input'); input.type = 'color'; input.value = value;
            } else if (setting.type === 'text') {
                input = document.createElement('input'); input.type = 'text'; input.maxLength = setting.maxLength || 80; input.value = value; input.className = 'mod-select';
            } else {
                input = document.createElement('input'); input.type = 'number'; input.min = setting.min; input.max = setting.max; input.step = setting.step; input.value = value; input.className = 'mod-select';
            }
            input.disabled = !record.enabled;
            if (setting.type !== 'toggle') input.addEventListener('change', () => updateSclSetting(record, setting.id, ['slider','number'].includes(setting.type) ? Number(input.value) : input.value));
            row.appendChild(input); settingSection.appendChild(row);
        });
        host.appendChild(settingSection);
    }
    if (manifest.actions.length) {
        const actionSection = document.createElement('section'); actionSection.className = 'mod-page-section';
        actionSection.innerHTML = '<div class="section-heading"><div><h2>Actions</h2><p>Run these actions while playing Aquavoid.</p></div></div>';
        manifest.actions.forEach(action => { const button = document.createElement('button'); button.className = 'cheat-action mod-page-action'; button.type = 'button'; button.textContent = action.label; button.disabled = !record.enabled; button.addEventListener('click', () => runModAction(action)); actionSection.appendChild(button); }); host.appendChild(actionSection);
    }
    renderSclControls(record, host);
    if (record.enabled) applyEyesightShader(); else if (manifest.id === 'eyesight') applyEyesightShader();
}

function renderInstalledMods() {
    renderModLibrary();
    if (activeModId) { const current = installedMods.find(item => item.manifest.id === activeModId); if (current) { $('modsLibraryView').hidden = true; $('modDetailView').hidden = false; renderModPage(current); } else activeModId = null; }
    applyEyesightShader();
}

// ZIP reader: imports only .sclient and .shadersclient files; scripts inside archives are ignored.
async function unzipSupportedFiles(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) { if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('This ZIP archive has no valid directory.');
    const entries = view.getUint16(eocd + 10, true), directoryOffset = view.getUint32(eocd + 16, true);
    let offset = directoryOffset; const results = [];
    for (let i = 0; i < entries; i++) {
        if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('This ZIP archive has a damaged directory.');
        const method = view.getUint16(offset + 10, true), compressedSize = view.getUint32(offset + 20, true);
        const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const localOffset = view.getUint32(offset + 42, true);
        const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
        offset += 46 + nameLength + extraLength + commentLength;
        if (!/\.(sclient|shadersclient)$/i.test(name) || name.endsWith('/')) continue;
        if (compressedSize > 1500000 || uncompressedSize > 1500000) throw new Error(`${name.split('/').pop()} exceeds the 1.5 MB import limit.`);
        if (view.getUint32(localOffset, true) !== 0x04034b50) continue;
        const localNameLength = view.getUint16(localOffset + 26, true), localExtraLength = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const compressed = bytes.slice(dataStart, dataStart + compressedSize);
        let data;
        if (method === 0) data = compressed;
        else if (method === 8 && typeof DecompressionStream !== 'undefined') {
            const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            data = new Uint8Array(await new Response(stream).arrayBuffer());
        } else throw new Error(`ZIP compression method ${method} is not supported in this browser.`);
        if (data.byteLength > 1500000 || data.byteLength !== uncompressedSize) throw new Error(`${name.split('/').pop()} has an invalid or oversized extracted file.`);
        results.push({name:name.split('/').pop(), text:new TextDecoder().decode(data)});
    }
    return results;
}
async function importModFiles(files) {
    let modCount = 0, shaderCount = 0, errors = [];
    for (const file of files) {
        try {
            const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip';
            if (file.size > (isZip ? 8000000 : 1500000)) throw new Error(`${file.name} exceeds the import size limit.`);
            const entries = isZip ? await unzipSupportedFiles(file) : [{name:file.name,text:await file.text()}];
            if (!entries.length) { errors.push(`${file.name}: no supported files found`); continue; }
            for (const entry of entries) {
                try {
                    const parsed = JSON.parse(entry.text);
                    if (/\.shadersclient$/i.test(entry.name) || parsed.format === 'sclient-shaderpack') { upsertShaderPack(parsed); shaderCount++; }
                    else { upsertManifest(parsed); modCount++; }
                } catch (error) { errors.push(`${entry.name}: ${error.message}`); }
            }
        } catch (error) { errors.push(`${file.name}: ${error.message}`); }
    }
    if (modCount) saveMods();
    if (shaderCount) saveShaders();
    renderInstalledMods();
    const summary = [`${modCount} mod${modCount===1?'':'s'} imported`, `${shaderCount} shader pack${shaderCount===1?'':'s'} imported`].join(' · ');
    toast(errors.length ? `${summary}. ${errors.slice(0,2).join('; ')}` : `${summary}. Your library is syncing to Firestore.`);
}
function upsertShaderPack(raw) {
    const pack = normalizeShaderPack(raw);
    const index = customShaderPacks.findIndex(item => item.id === pack.id);
    if (index >= 0) customShaderPacks[index] = pack; else customShaderPacks.push(pack);
    return pack;
}
async function importShaderFiles(files) {
    let imported = 0; const errors = [];
    for (const file of files) {
        try {
            if (file.size > 80000) throw new Error('Shader packs are limited to 80 KB each.');
            upsertShaderPack(JSON.parse(await file.text())); imported++;
        } catch (error) { errors.push(`${file.name}: ${error.message}`); }
    }
    if (imported) { await saveShaders(); activeShaderId = customShaderPacks.at(-1)?.id || activeShaderId; await saveShaders(); applyEyesightShader(); const rec = recordForEyesight(); if (rec && activeModId === 'eyesight') renderModPage(rec); }
    toast(errors.length ? `${imported} shader pack(s) imported. ${errors[0]}` : `${imported} shader pack(s) imported and saved to your account.`);
}
$('importModButton').addEventListener('click', () => $('modFileInput').click());
$('modFileInput').addEventListener('change', async event => { await importModFiles([...event.target.files]); event.target.value = ''; });
$('backToModLibrary').addEventListener('click', () => { activeModId = null; renderModLibrary(); });
$('modsLibraryButton')?.addEventListener('click', () => { activeModId = null; renderModLibrary(); });
$('modFileInput').setAttribute('multiple','');
$('modFileInput').setAttribute('accept','.sclient,.shadersclient,.zip,application/zip,application/json,.json');

// Start with the private mod library and initialize the live WebGL colour-grade pass.
function renderModStart() { renderModLibrary(); }
renderModStart();
applyEyesightShader();

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
        case 'stormStrike': {
            if (!run || paused) { toast('Start a round before calling the storm.'); break; }
            if (stormStrikeCooldown > 0) { toast(`Storm recharging: ${stormStrikeCooldown.toFixed(1)}s`); break; }
            const targets = mons.map(monster => ({monster, distance:Math.hypot(monster.o.position.x - P.position.x, monster.o.position.z - P.position.z)}))
                .filter(item => item.distance < 48).sort((a,b) => a.distance - b.distance).slice(0,3);
            if (!targets.length) { toast('No sea monsters in lightning range.'); break; }
            const origin = new THREE.Vector3(P.position.x, P.position.y + 2.2, P.position.z);
            targets.forEach((item, index) => {
                dmg(item.monster, 7 - index * 1.2);
                emit(item.monster.o.position, 0xa879ff, 24, 6);
                createModRay(origin, item.monster.o.position, 0xb895ff, .28);
            });
            stormStrikeCooldown = 8;
            banner('CHAIN LIGHTNING!');
            beep(120, .28, 'sawtooth', .12);
            toast(`Stormcaller hit ${targets.length} target${targets.length === 1 ? '' : 's'}.`);
            break;
        }
    }
}
const radarWidget = document.createElement('div');
radarWidget.className = 'sclient-crystal-radar';
radarWidget.hidden = true;
const radarArrow = document.createElement('span'); radarArrow.className = 'radar-arrow'; radarArrow.textContent = '↑';
const radarText = document.createElement('span'); radarText.className = 'radar-copy';
radarWidget.append(radarArrow, radarText);
$('gameStage').appendChild(radarWidget);
function updateModRadar() {
    const visible = run && !paused && activeView === 'play' && modFlag('treasureRadar');
    radarWidget.hidden = !visible;
    if (!visible) return;
    const dx = X.position.x - P.position.x, dz = X.position.z - P.position.z;
    const distance = Math.hypot(dx, dz);
    const relativeBearing = Math.atan2(dx, dz) - hd;
    radarArrow.style.transform = `rotate(${relativeBearing}rad)`;
    radarText.textContent = `CRYSTAL · ${Math.round(distance)}m`;
}
loadingCover.remove();

window.AquavoidGame = Object.freeze({
    loadSave: raw => { loadClientGame(raw || {}); applySkin(sel); updateCoins(); drawShop(); drawW(); },
    save: () => saveAquavoidGame(),
    syncLeaderboard: () => syncAquavoidLeaderboard(),
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
if (window.AQUAVOID_BOOT?.authenticated) {
    window.AquavoidGame.loadSave(window.AQUAVOID_BOOT.gameSave || {});
    if (!window.AQUAVOID_BOOT.gameSave) saveAquavoidGame().catch(() => {});
    else window.AquavoidGame.syncLeaderboard().catch(error => console.warn('Existing leaderboard record could not be synced:', error));
}
})();
