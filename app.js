import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithRedirect, initializeAuth, browserPopupRedirectResolver, getRedirectResult, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, serverTimestamp, collection, query, where, orderBy, limit, getDocs } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB5WMIaadItMKOygz-F47aYSmKoltPluF4',
  authDomain: 'kitacat-s-client.firebaseapp.com',
  projectId: 'kitacat-s-client',
  storageBucket: 'kitacat-s-client.firebasestorage.app',
  messagingSenderId: '460500639532',
  appId: '1:460500639532:web:633ababff0f23633aa5689',
  measurementId: 'G-8LHG10LZYS'
};

// S-Client uses its own versioned Firebase app namespace. Earlier builds
// copied an auth-user record from [DEFAULT] into a named app. Firebase auth
// records are implementation-owned state and must not be copied between app
// namespaces: an obsolete refresh token can otherwise be retried on every
// visit and produce securetoken.googleapis.com HTTP 400 responses.
// Starting with a clean namespace forces one fresh S-Client sign-in while
// leaving the separate Aquavoid [DEFAULT] session and all Firestore data alone.
const SCLIENT_AUTH_APP_NAME = 'sclient-account-v2';
const firebaseApp = getApps().find(app => app.name === SCLIENT_AUTH_APP_NAME)
  || initializeApp(firebaseConfig, SCLIENT_AUTH_APP_NAME);
const firebaseAuth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const authGate = document.getElementById('authGate');
const sclientAuthStep = document.getElementById('sclientAuthStep');
const authStatus = document.getElementById('authStatus');
const signInButton = document.getElementById('googleSignInButton');
const retryButton = document.getElementById('authRetryButton');
const clientShell = document.querySelector('.client-shell');
const cloudStatusElement = document.getElementById('cloudStatus');
let signedInUid = null;
let cloudPendingWrites = 0;
let cloudWriteError = null;
let cloudHasSaved = false;

// Use a top-level redirect for Google OAuth. Popup flows inspect popup.closed
// and popup.close; browsers applying Cross-Origin-Opener-Policy can sever that
// window reference and leave Firebase's popup observer stuck indefinitely.
// Redirect auth avoids that cross-window handshake entirely. The pending
// instance ID is held in sessionStorage by launcher.js and resumes on return.
async function googleSignIn(auth, provider) {
  await signInWithRedirect(auth, provider);
}

// Registered immediately so the button works while the rest of startup is still loading.
signInButton.addEventListener('click', async () => {
  signInButton.disabled = true;
  showAuthMessage('Redirecting to Google securely…');
  const rescueTimer = window.setTimeout(() => {
    signInButton.disabled = false;
    showAuthMessage('Google sign-in did not redirect. Check your connection and try again.', true);
  }, 15000);
  try {
    await googleSignIn(firebaseAuth, googleProvider);
  } catch (error) {
    console.error('Google sign-in failed:', error);
    const messages = {
      'auth/unauthorized-domain': 'Add this exact S-Client website hostname to Authorized domains in the S-Client Firebase project.',
      'auth/operation-not-allowed': 'Enable the Google provider in S-Client Firebase Authentication.',
      'auth/invalid-api-key': 'The S-Client Firebase API key is invalid or restricted.',
      'auth/network-request-failed': 'Network error while contacting Google/Firebase. Check your connection and try again.'
    };
    showAuthMessage(messages[error?.code] || `Google sign-in failed (${error?.code || 'unknown error'}): ${error.message}`, true);
  } finally {
    window.clearTimeout(rescueTimer);
    signInButton.disabled = false;
  }
});

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
      saveShaders: makeCloudWriter(shadersRef, 'shaders'),
      // Mods are stored per instance: users/{uid}/client/mods-<instanceId>
      loadInstanceMods: async instanceId => {
        const snap = await getDoc(doc(firestore, 'users', user.uid, 'client', 'mods-' + instanceId));
        const data = snap.exists() ? (snap.data() || {}) : {};
        return Array.isArray(data.installed) ? data.installed : [];
      },
      saveInstanceMods: (() => {
        const writers = {};
        return (instanceId, data) => (writers[instanceId] ||= makeCloudWriter(doc(firestore, 'users', user.uid, 'client', 'mods-' + instanceId), 'instance mods'))(data);
      })(),
      deleteInstanceMods: instanceId => deleteDoc(doc(firestore, 'users', user.uid, 'client', 'mods-' + instanceId))
    };
    if (needsModsMigration) {
      await setDoc(modsRef, { installed: restoredMods, updatedAt: serverTimestamp() });
    }
    signedInUid = user.uid;
    // S-Client account alone does not unlock the launcher. Keep the startup
    // gate open and require the separate Aquavoid account as step two.
    clientShell.style.display = 'none';
    authGate.hidden = false;
    sclientAuthStep.hidden = true;
    authGate.setAttribute('aria-labelledby', 'aquavoidAuthTitle');
    document.getElementById('aquavoidAuthGate').hidden = false;
    showAuthMessage('S-Client connected. Complete the Aquavoid account sign-in to open the launcher.');
    updateCloudStatus();
    return true;
  } catch (error) {
    console.error('S-Client account bootstrap failed:', error);
    signInButton.disabled = false;
    const code = String(error?.code || '');
    const isRejectedAuthSession = [
      'auth/invalid-user-token',
      'auth/user-token-expired',
      'auth/invalid-refresh-token'
    ].includes(code);

    if (isRejectedAuthSession) {
      // Firebase rejected the persisted refresh token. Clear this app's local
      // Auth session so the next attempt starts a new Google OAuth sign-in.
      // This does not delete the user's cloud profile or any game save.
      try { await signOut(firebaseAuth); }
      catch (signOutError) { console.warn('Could not clear the rejected S-Client Auth session:', signOutError); }
      retryButton.hidden = true;
      showAuthMessage(`Firebase rejected the saved S-Client login (${code}). Please sign in with Google again. Your cloud profile and saved data are not deleted.`, true);
      return false;
    }

    retryButton.hidden = false;
    const detail = code === 'permission-denied'
      ? 'Firestore denied access. Check the S-Client owner-only Firestore rules.'
      : code === 'auth/invalid-api-key'
        ? 'Firebase rejected the S-Client API key. Check the Web API key in the kitacat-s-client Firebase project.'
        : `Could not load your S-Client account (${code || 'connection error'}): ${error?.message || 'Check your connection and Firebase configuration.'}`;
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

// Resolve a pending Google redirect sign-in on page return.
try {
  const redirectResult = await Promise.race([getRedirectResult(firebaseAuth), new Promise(resolve => setTimeout(resolve, 4000))]);
} catch (error) {
  console.error('S-Client Google redirect result failed:', error);
  const messages = {
    'auth/unauthorized-domain': 'This website hostname is not authorized in the kitacat-s-client Firebase project.',
    'auth/operation-not-allowed': 'Google sign-in is not enabled in the S-Client Firebase project.',
    'auth/invalid-api-key': 'The S-Client Firebase Web API key is invalid or restricted.',
    'auth/invalid-user-token': 'Firebase rejected the previous S-Client refresh token. Start a fresh Google sign-in.',
    'auth/user-token-expired': 'Your previous S-Client session expired. Start a fresh Google sign-in.'
  };
  showAuthMessage(messages[error?.code] || `Google sign-in failed (${error?.code || 'unknown error'}): ${error?.message || 'Check the Firebase error details.'}`, true);
}

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
    sclientAuthStep.hidden = false;
    authGate.setAttribute('aria-labelledby', 'authTitle');
    document.getElementById('aquavoidAuthGate').hidden = true;
    signInButton.disabled = false;
    showAuthMessage('Step 1 of 2: sign in to S-Client.');
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
// Aquavoid's original app.js calls initializeApp(config) with no name, which
// means it uses [DEFAULT]. Use that exact app name here so its auth session is
// persisted under the same Firebase key as the unmodified game running in the
// same-origin instance iframe.
// A previous S-Client build used the name 'aquavoid-game'. Migrate its
// local user record to Firebase's [DEFAULT] key before the untouched Aquavoid
// game reads that key. Existing default-app sessions are left alone.
try {
  const oldKey = `firebase:authUser:${aquavoidFirebaseConfig.apiKey}:aquavoid-game`;
  const newKey = `firebase:authUser:${aquavoidFirebaseConfig.apiKey}:[DEFAULT]`;
  if (!localStorage.getItem(newKey) && localStorage.getItem(oldKey)) {
    localStorage.setItem(newKey, localStorage.getItem(oldKey));
  }
} catch (error) {
  console.info('Aquavoid login migration was unavailable in this browser context.', error);
}
const aquavoidFirebaseApp = getApps().find(app => app.name === '[DEFAULT]')
  || initializeApp(aquavoidFirebaseConfig);
// Pin Aquavoid auth to localStorage only. The game iframe uses the same key;
// if the two sides used different storages, the game would migrate the user
// out of localStorage on load and sign the launcher out the moment Play is clicked.
let aquavoidAuth;
try {
  aquavoidAuth = initializeAuth(aquavoidFirebaseApp, { persistence: browserLocalPersistence, popupRedirectResolver: browserPopupRedirectResolver });
} catch (error) {
  aquavoidAuth = getAuth(aquavoidFirebaseApp);
}
// Use the Aquavoid project's Firestore instance for player saves and leaderboard
// reads/writes. This must be initialized separately from S-Client's Firestore.
const aquavoidFirestore = getFirestore(aquavoidFirebaseApp);
// initializeAuth above already configures the [DEFAULT] Aquavoid session with
// browserLocalPersistence. Do not run a second persistence migration here:
// waiting for it before registering the Auth observer can strand step 2 on
// storage-restricted browsers.
const aquavoidGoogleProvider = new GoogleAuthProvider();
// Do not force prompt=select_account on every reconnect. Firebase's persisted
// user is authoritative; when a token really expires Google can reuse the
// existing browser session where possible.
const aquavoidGate = document.getElementById('aquavoidAuthGate');
const aquavoidGameWindow = document.getElementById('gameWindow');
const aquavoidAccountBar = document.getElementById('aquavoidAccountBar');
const aquavoidStatus = document.getElementById('aquavoidAuthStatus');
const aquavoidSignIn = document.getElementById('aquavoidSignInButton');
const aquavoidRetry = document.getElementById('aquavoidRetryButton');
const aquavoidCloudRetry = document.getElementById('aquavoidCloudRetryButton');
let aquavoidUser = null;
let aquavoidCloudReady = false;
let aquavoidAuthRevision = 0;
let aquavoidSaveQueue = Promise.resolve();
let aquavoidWriteError = null;
window.AQUAVOID_BOOT = { authenticated: false, gameSave: null, uid: null, cloudReady: false };
// The legacy parent-page renderer is hidden while the launcher iframe is
// active. Authentication and instance launch do not depend on its startup.

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
    if (!aquavoidUser) throw new Error('Connect your Aquavoid account before saving progress.');
    if (!aquavoidCloudReady) throw new Error('Your Aquavoid account is connected, but cloud saving is offline. Use RETRY CLOUD SAVE in the account bar.');
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
      nameSet: data.nameSet === true,
      survival: (() => {
        const keys = ['wood','stone','fiber','berries','planks','rope'];
        const bag = raw => Object.fromEntries(keys.map(key => [key, Math.max(0, Math.min(999999, Math.floor(Number(raw?.[key]) || 0)))]));
        const raw = data.survival || {};
        return {
          inventory:bag(raw.inventory), shipChest:bag(raw.shipChest),
          tools:{axe:raw.tools?.axe === true,pickaxe:raw.tools?.pickaxe === true},
          craftedChests:Math.max(0,Math.min(20,Math.floor(Number(raw.craftedChests)||0))),
          placedChests:Array.isArray(raw.placedChests) ? raw.placedChests.slice(0,40).map((item,index)=>({id:String(item.id||`chest-${index}`).replace(/[^a-z0-9-]/gi,'').slice(0,40),x:Math.max(-1400,Math.min(1400,Number(item.x)||0)),z:Math.max(-1400,Math.min(1400,Number(item.z)||0)),storage:bag(item.storage),kind:item.kind==='lootChest'?'lootChest':'placedChest'})) : [],
          harvested:Array.isArray(raw.harvested) ? [...new Set(raw.harvested.filter(id=>typeof id==='string'&&/^[a-z0-9-]{1,64}$/i.test(id)))].slice(0,600) : [],
          discovered:Array.isArray(raw.discovered) ? [...new Set(raw.discovered.filter(id=>typeof id==='string'&&/^[a-z0-9-]{1,48}$/i.test(id)))].slice(0,64) : [],
          defeatedMonsters:Array.isArray(raw.defeatedMonsters) ? [...new Set(raw.defeatedMonsters.filter(id=>typeof id==='string'&&/^[a-z0-9-]{1,64}$/i.test(id)))].slice(0,240) : [],
          gear:raw.gear&&typeof raw.gear==='object'?Object.fromEntries(Object.entries(raw.gear).filter(([key,value])=>/^[a-z0-9._:-]{1,80}$/i.test(key)&&typeof value==='boolean').slice(0,120)): {},
          modifiers:raw.modifiers&&typeof raw.modifiers==='object'?Object.fromEntries(Object.entries(raw.modifiers).filter(([key,value])=>/^[a-zA-Z0-9._-]{1,40}$/.test(key)&&Number.isFinite(Number(value))).slice(0,40).map(([key,value])=>[key,Math.max(-100,Math.min(500,Number(value)))])): {},
          health:Math.max(1,Math.min(180,Math.floor(Number(raw.health)||100))),
          ship:{x:Math.max(-1400,Math.min(1400,Number(raw.ship?.x)||0)),z:Math.max(-1400,Math.min(1400,Number(raw.ship?.z)||0)),heading:Math.max(-Math.PI,Math.min(Math.PI,Number(raw.ship?.heading)||0))}
        };
      })()
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
    if (!aquavoidUser) throw new Error('Connect your Aquavoid account before posting a leaderboard score.');
    if (!aquavoidCloudReady) throw new Error('Your Aquavoid account is connected, but cloud saving is offline. Retry the cloud connection first.');
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
    if (!aquavoidUser) throw new Error('Connect your Aquavoid account to view the leaderboard.');
    if (!aquavoidCloudReady) throw new Error('Your Aquavoid account is connected, but the cloud leaderboard is offline. Retry the cloud connection first.');
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
  setAquavoidStatus('Redirecting to Google securely…');
  const rescueTimer = window.setTimeout(() => {
    aquavoidSignIn.disabled = false;
    setAquavoidStatus('Google sign-in did not redirect. Check your connection and try again.', true);
  }, 15000);
  try {
    await googleSignIn(aquavoidAuth, aquavoidGoogleProvider);
  } catch (error) {
    console.error('Aquavoid Google redirect sign-in failed:', error);
    const messages = {
      'auth/unauthorized-domain': 'Add this exact S-Client website hostname to Authorized domains in the AQUAVOID Firebase project.',
      'auth/operation-not-allowed': 'Google sign-in is not enabled for the Aquavoid Firebase project.',
      'auth/network-request-failed': 'A network error interrupted Google sign-in. Check your connection and retry.'
    };
    setAquavoidStatus(messages[error?.code] || `Aquavoid sign-in failed (${error?.code || 'unknown error'}): ${error.message}`, true);
  } finally {
    window.clearTimeout(rescueTimer);
    aquavoidSignIn.disabled = false;
  }
});
async function retryAquavoidCloud() {
  const user = aquavoidAuth.currentUser || aquavoidUser;
  if (!user) {
    setAquavoidStatus('Your Aquavoid login is no longer active. Connect your account again.', true);
    return;
  }
  if (aquavoidCloudRetry) aquavoidCloudRetry.disabled = true;
  if (aquavoidRetry) aquavoidRetry.disabled = true;
  setAquavoidStatus('Retrying Aquavoid cloud save connection…');
  try {
    // A token refresh is useful for transient auth/network errors, but the
    // user's authenticated state is kept even if this refresh cannot complete.
    try { await user.getIdToken(true); }
    catch (tokenError) { console.warn('Aquavoid token refresh failed; retrying the save read with the current session.', tokenError); }
    await onAquavoidUser(user);
  } finally {
    if (aquavoidCloudRetry) aquavoidCloudRetry.disabled = false;
    if (aquavoidRetry) aquavoidRetry.disabled = false;
  }
}
aquavoidRetry.addEventListener('click', retryAquavoidCloud);
aquavoidCloudRetry?.addEventListener('click', retryAquavoidCloud);
document.getElementById('aquavoidSignOutButton').addEventListener('click', async () => {
  const button = document.getElementById('aquavoidSignOutButton');
  button.disabled = true;
  try { await signOut(aquavoidAuth); }
  catch (error) { setAquavoidStatus(`Could not switch Aquavoid account: ${error.message}`, true); }
  finally { button.disabled = false; }
});

async function onAquavoidUser(user) {
  const revision = ++aquavoidAuthRevision;
  aquavoidUser = user;
  aquavoidCloudReady = false;

  if (!user) {
    window.AQUAVOID_BOOT = { authenticated: false, gameSave: null, uid: null, cloudReady: false };
    paintAquavoidAccount(false);
    setAquavoidStatus('Step 2 of 2: connect your Aquavoid Google account to open S-Client.');
    aquavoidRetry.hidden = true;
    if (aquavoidCloudRetry) aquavoidCloudRetry.hidden = true;
    clientShell.style.display = 'none';
    authGate.hidden = false;
    sclientAuthStep.hidden = true;
    authGate.setAttribute('aria-labelledby', 'aquavoidAuthTitle');
    window.dispatchEvent(new CustomEvent('sclient:aquavoid-disconnected'));
    return;
  }

  // Firebase Auth is the access gate. Do not hold the launcher behind the
  // hidden parent-page renderer or a Firestore read: the actual game runs in
  // its own iframe and loads its save there. Cloud save availability is a
  // separate, recoverable state.
  window.AQUAVOID_BOOT = {
    authenticated: true,
    gameSave: null,
    uid: user.uid,
    displayName: user.displayName || '',
    cloudReady: false
  };
  paintAquavoidAccount(true, user);
  authGate.hidden = true;
  clientShell.style.display = 'flex';
  setAquavoidStatus('Aquavoid account verified. Opening S-Client while checking your cloud save…');
  if (aquavoidRetry) aquavoidRetry.hidden = true;
  if (aquavoidCloudRetry) aquavoidCloudRetry.hidden = true;
  window.dispatchEvent(new CustomEvent('sclient:aquavoid-ready', {
    detail: { uid: user.uid, cloudReady: false }
  }));

  // This read updates account status only. It is deliberately non-blocking for
  // Play; the selected game iframe independently loads and saves the player's
  // actual game data using the same authenticated Firebase project.
  try {
    let cloudTimeout;
    const snapshot = await Promise.race([
      getDoc(doc(aquavoidFirestore, 'players', user.uid)),
      new Promise((_, reject) => {
        cloudTimeout = window.setTimeout(() => {
          const error = new Error('The Aquavoid cloud save check took too long.');
          error.code = 'sclient/cloud-timeout';
          reject(error);
        }, 10000);
      })
    ]).finally(() => window.clearTimeout(cloudTimeout));

    if (revision !== aquavoidAuthRevision || aquavoidAuth.currentUser?.uid !== user.uid) return;
    const gameSave = snapshot.exists() ? (snapshot.data() || {}) : null;
    aquavoidCloudReady = true;
    window.AQUAVOID_BOOT = {
      authenticated: true,
      gameSave,
      uid: user.uid,
      displayName: user.displayName || '',
      cloudReady: true
    };
    setAquavoidStatus('Aquavoid account connected. Cloud save service is available.');
    if (aquavoidCloudRetry) aquavoidCloudRetry.hidden = true;
    const label = document.getElementById('aquavoidAccountLabel');
    if (label) label.textContent = 'AQUAVOID ACCOUNT CONNECTED · CLOUD READY';
  } catch (error) {
    if (revision !== aquavoidAuthRevision || aquavoidAuth.currentUser?.uid !== user.uid) return;
    aquavoidCloudReady = false;
    window.AQUAVOID_BOOT = {
      authenticated: true,
      gameSave: null,
      uid: user.uid,
      displayName: user.displayName || '',
      cloudReady: false,
      cloudError: error?.code || 'unknown'
    };
    const detail = error?.code === 'permission-denied'
      ? 'Aquavoid account connected, but Firestore denied the player save read. Check the players/{uid} read rule.'
      : `Aquavoid account connected. Cloud save is temporarily unavailable (${error?.code || 'connection error'}): ${error.message}`;
    setAquavoidStatus(detail, true);
    const label = document.getElementById('aquavoidAccountLabel');
    if (label) label.textContent = 'AQUAVOID ACCOUNT CONNECTED · CLOUD SAVE OFFLINE';
    if (aquavoidCloudRetry) aquavoidCloudRetry.hidden = false;
    // Keep the launcher open: retrying cloud access must not require another login.
    authGate.hidden = true;
    clientShell.style.display = 'flex';
  }
}

onAuthStateChanged(aquavoidAuth, user => {
  void onAquavoidUser(user);
});
// Consume the redirect result so Firebase can finish the OAuth handoff. The
// Auth observer above is the source of truth for whether a user is signed in;
// a redirect-result warning must not sign out a user or re-open the login gate.
getRedirectResult(aquavoidAuth).then(result => {
  if (result?.user) console.info('Aquavoid Google redirect completed for:', result.user.uid);
}).catch(error => {
  console.warn('Aquavoid Google redirect result could not be read:', error);
  if (!aquavoidAuth.currentUser) {
    setAquavoidStatus(`Aquavoid sign-in did not complete (${error?.code || 'unknown error'}): ${error.message}. Please try connecting once more.`, true);
  }
});

(async () => {
'use strict';
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toastRegion = $('toastRegion');
let installedMods = []; // mods of the instance currently selected in the Mods tab
let currentModInstanceId = null;
let currentModInstanceVersion = window.__sclientModVersion || null;
let externalGameWindow = null;
let externalGameInstanceId = null;
let activeSessionMods = [];
let modSessionActive = false;
let modSessionLoadPromise = null;
let modInstanceLoadPromise = Promise.resolve(true);
let modInstanceLoadKey = null;
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
R.shadowMap.enabled = true;
R.shadowMap.type = THREE.PCFSoftShadowMap;
R.outputEncoding = THREE.sRGBEncoding;
R.toneMapping = THREE.ACESFilmicToneMapping;
R.toneMappingExposure = 1.16;
R.shadowMap.autoUpdate = true;
if ('outputColorSpace' in R && THREE.SRGBColorSpace) R.outputColorSpace = THREE.SRGBColorSpace;
if ('toneMapping' in R && THREE.ACESFilmicToneMapping !== undefined) { R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.12; }
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
const eyesightTargetOptions = { minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, format:THREE.RGBAFormat, depthBuffer:false, stencilBuffer:false };
const shaderRenderTarget = new THREE.WebGLRenderTarget(
    Math.max(1, Math.round(initialSize.width * R.getPixelRatio())),
    Math.max(1, Math.round(initialSize.height * R.getPixelRatio())),
    eyesightTargetOptions
);
const shaderPingTarget = new THREE.WebGLRenderTarget(
    Math.max(1, Math.round(initialSize.width * R.getPixelRatio())),
    Math.max(1, Math.round(initialSize.height * R.getPixelRatio())),
    eyesightTargetOptions
);
const shaderFrameUniforms = {
    tDiffuse: { value: shaderRenderTarget.texture },
    uBrightness: { value: 1 },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uHue: { value: 0 },
    uTint: { value: new THREE.Color('#ffffff') },
    uTintStrength: { value: 0 },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(initialSize.width * R.getPixelRatio(), initialSize.height * R.getPixelRatio()) },
    uMouse: { value: new THREE.Vector2(.5, .5) },
    uIntensity: { value: 1 },
    uFrame: { value: 0 }
};
const shaderOutputMaterial = new THREE.ShaderMaterial({
    uniforms: shaderFrameUniforms,
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
        }
    `,
    fragmentShader: `
        // Self-contained GLSL ES 1.00 shader. Avoid renderer-version-specific
        // encoding chunks so a failed include can never blank the game canvas.
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
            color = clamp(color, 0.0, 1.0);
            // Render targets contain linear RGB. Convert to display sRGB here.
            vec3 lower = 12.92 * color;
            vec3 upper = 1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055;
            vec3 srgb = mix(upper, lower, 1.0 - step(vec3(0.0031308), color));
            gl_FragColor = vec4(srgb, 1.0);
        }
    `,
    depthTest:false,
    depthWrite:false,
    toneMapped:false
});
const shaderPassScene = new THREE.Scene();
const shaderPassQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shaderOutputMaterial);
shaderPassQuad.frustumCulled = false;
shaderPassScene.add(shaderPassQuad);
const shaderPassCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
shaderPassCamera.position.z = 1;
let shaderPassEnabled = false;
let shaderPassFailed = false;
let shaderFallbackSettings = null;
let shaderFallbackNoticeShown = false;

// Three.js exposes shader diagnostics through renderer.debug. If a GPU/driver
// rejects the optional post-process shader, draw the game normally and apply a
// safe CSS colour-grade fallback instead of ever leaving a black canvas.
if (R.debug) {
    R.debug.checkShaderErrors = true;
    const previousShaderErrorHandler = R.debug.onShaderError;
    R.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
        if (shaderCompileInProgress) { shaderPassFailed = true; shaderCompileError = true; }
        console.error('Eyesight shader compile failed; the pack will be rolled back safely.');
        if (typeof previousShaderErrorHandler === 'function') {
            try { previousShaderErrorHandler(gl, program, vertexShader, fragmentShader); } catch (_) {}
        }
    };
}

function shaderFallbackFilter(settings) {
    if (!settings) return 'none';
    const n = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    return `brightness(${n(settings.brightness, 1)}) contrast(${n(settings.contrast, 1)}) saturate(${n(settings.saturation, 1)}) hue-rotate(${n(settings.hue, 0)}deg)`;
}

let activeShaderPack = null;
let shaderPassMaterials = [];
let shaderFrame = 0;
let shaderMouse = new THREE.Vector2(.5, .5);
let shaderCompileInProgress = false;
let shaderCompileError = false;

function disposeShaderPasses() {
    shaderPassMaterials.forEach(material => material.dispose());
    shaderPassMaterials = [];
}
function shaderUniformValue(definition) {
    const value = definition.value;
    if (definition.type === 'float') return {value:Number(value) || 0};
    if (definition.type === 'vec2') return {value:new THREE.Vector2(Number(value[0]) || 0, Number(value[1]) || 0)};
    if (definition.type === 'vec3') return {value:new THREE.Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0)};
    if (definition.type === 'vec4') return {value:new THREE.Vector4(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0, Number(value[3]) || 0)};
    if (definition.type === 'color') return {value:new THREE.Color(value)};
    return {value:0};
}
function buildShaderPassMaterial(pass) {
    const uniforms = {
        tDiffuse:{value:shaderRenderTarget.texture},
        uTime:{value:0},
        uResolution:{value:new THREE.Vector2(initialSize.width * R.getPixelRatio(), initialSize.height * R.getPixelRatio())},
        uMouse:{value:new THREE.Vector2(.5,.5)},
        uIntensity:{value:1},
        uFrame:{value:0},
        uCameraPosition:{value:new THREE.Vector3()},
        uCameraDirection:{value:new THREE.Vector3(0,0,-1)}
    };
    const declarations = [
        ['tDiffuse','uniform sampler2D tDiffuse;'],
        ['uTime','uniform float uTime;'],
        ['uResolution','uniform vec2 uResolution;'],
        ['uMouse','uniform vec2 uMouse;'],
        ['uIntensity','uniform float uIntensity;'],
        ['uFrame','uniform float uFrame;'],
        ['uCameraPosition','uniform vec3 uCameraPosition;'],
        ['uCameraDirection','uniform vec3 uCameraDirection;']
    ];
    const sourceUniforms = [];
    for (const definition of pass.uniforms || []) {
        uniforms[definition.name] = shaderUniformValue(definition);
        const type = definition.type === 'color' ? 'vec3' : definition.type;
        sourceUniforms.push(`uniform ${type} ${definition.name};`);
    }
    const fragmentSource = String(pass.fragmentShader || '');
    const missing = declarations.filter(([name]) => !new RegExp('\\buniform\\s+\\w+\\s+' + name + '\\b').test(fragmentSource)).map(([,declaration]) => declaration);
    const userMissing = sourceUniforms.filter(declaration => {
        const name = declaration.match(/\s(\w+);$/)?.[1];
        return name && !new RegExp('\\buniform\\s+\\w+\\s+' + name + '\\b').test(fragmentSource);
    });
    const normalizedSource=fragmentSource.replace(/precision\s+(?:lowp|mediump|highp)\s+float\s*;/g,'');
    const fragmentShader = `precision highp float;\n${missing.join('\n')}\n${userMissing.join('\n')}\n${/varying\s+vec2\s+vUv\s*;/.test(normalizedSource) ? '' : 'varying vec2 vUv;'}\n${normalizedSource}`;
    const defaultVertex = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
    return new THREE.ShaderMaterial({
        uniforms,
        vertexShader:pass.vertexShader || defaultVertex,
        fragmentShader,
        depthTest:false,
        depthWrite:false,
        transparent:false,
        toneMapped:false
    });
}
function rebuildShaderPasses(pack) {
    disposeShaderPasses();
    shaderCompileError = false;
    shaderPassFailed = false;
    const passes = Array.isArray(pack?.passes) ? pack.passes : [];
    shaderPassMaterials = passes.map(buildShaderPassMaterial);
}
function renderShaderFallback(settings) {
    R.setRenderTarget(null);
    R.domElement.style.filter = settings ? shaderFallbackFilter(settings) : 'none';
    R.render(S, C);
}
function renderGameWithShaderPipeline(deltaTime) {
    if (!shaderPassEnabled || !activeShaderPack) {
        R.setRenderTarget(null);
        R.domElement.style.filter = 'none';
        R.render(S, C);
        return;
    }
    if (shaderPassFailed || shaderCompileError) {
        renderShaderFallback(shaderFallbackSettings);
        if (!shaderFallbackNoticeShown) {
            shaderFallbackNoticeShown = true;
            console.warn('Eyesight shader pack failed safely; drawing the unmodified game frame.');
            toast('Eyesight shader pack is incompatible. Original rendering restored; check the pack.');
        }
        return;
    }
    try {
        shaderFrame += 1;
        shaderFrameUniforms.uTime.value += deltaTime;
        shaderFrameUniforms.uFrame.value = shaderFrame;
        shaderFrameUniforms.uMouse.value.copy(shaderMouse);
        // Stage 0: render the actual Aquavoid scene into a linear colour target.
        R.domElement.style.filter = 'none';
        R.setRenderTarget(shaderRenderTarget);
        R.clear(true, true, true);
        R.render(S, C);
        let inputTarget = shaderRenderTarget;
        const previousMaterial = shaderPassQuad.material;
        const cameraDirection = new THREE.Vector3();
        C.getWorldDirection(cameraDirection);
        // Stage 1..N: execute author-supplied, bounded GLSL ES shader passes.
        for (let index = 0; index < shaderPassMaterials.length; index++) {
            const material = shaderPassMaterials[index];
            material.uniforms.tDiffuse.value = inputTarget.texture;
            material.uniforms.uTime.value = shaderFrameUniforms.uTime.value;
            material.uniforms.uResolution.value.copy(shaderFrameUniforms.uResolution.value);
            material.uniforms.uMouse.value.copy(shaderMouse);
            material.uniforms.uIntensity.value = Number(activeShaderPack.settings.intensity ?? 1);
            material.uniforms.uFrame.value = shaderFrame;
            material.uniforms.uCameraPosition.value.copy(C.position);
            material.uniforms.uCameraDirection.value.copy(cameraDirection);
            const outputTarget = inputTarget === shaderRenderTarget ? shaderPingTarget : shaderRenderTarget;
            R.setRenderTarget(outputTarget);
            R.clear(true, true, true);
            shaderPassQuad.material = material;
            shaderCompileInProgress = true;
            R.render(shaderPassScene, shaderPassCamera);
            shaderCompileInProgress = false;
            if (shaderPassFailed || shaderCompileError) throw new Error('GLSL compilation failed in pass ' + (index + 1));
            inputTarget = outputTarget;
        }
        // Final stage: Eyesight's calibrated colour-grade/output pass.
        shaderPassQuad.material = shaderOutputMaterial;
        shaderFrameUniforms.tDiffuse.value = inputTarget.texture;
        R.setRenderTarget(null);
        R.clear(true, true, true);
        shaderCompileInProgress = true;
        R.render(shaderPassScene, shaderPassCamera);
        shaderCompileInProgress = false;
        if (shaderPassFailed || shaderCompileError) throw new Error('Eyesight final output pass failed');
        shaderPassQuad.material = previousMaterial === shaderOutputMaterial ? shaderOutputMaterial : shaderOutputMaterial;
    } catch (error) {
        shaderCompileInProgress = false;
        shaderPassFailed = true;
        shaderPassQuad.material = shaderOutputMaterial;
        console.error('Eyesight pipeline failed; restoring normal frame:', error);
        renderShaderFallback(shaderFallbackSettings);
    }
}

const S = new THREE.Scene();
S.background = new THREE.Color(0x87b9d1);
S.fog = new THREE.Fog(0x9bc9d4,115,560);
const C = new THREE.PerspectiveCamera(60,initialSize.width / initialSize.height,.1,1800);
S.add(new THREE.HemisphereLight(0xd9f0ff,0x26445a,1.12));
const sun = new THREE.DirectionalLight(0xffe9c8,2.25);
sun.position.set(-65, 90, -45);
sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.left=-190; sun.shadow.camera.right=190; sun.shadow.camera.top=190; sun.shadow.camera.bottom=-190;
sun.shadow.camera.near=1; sun.shadow.camera.far=420; sun.shadow.bias=-0.00012;
S.add(sun);
const fillLight = new THREE.DirectionalLight(0x85cfff,.48); fillLight.position.set(70,30,65); S.add(fillLight);
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
const oceanMaterial = THREE.MeshPhysicalMaterial ? new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.13,metalness:.24,clearcoat:.9,clearcoatRoughness:.12,reflectivity:.72}) : new THREE.MeshStandardMaterial({vertexColors:true,roughness:.18,metalness:.16});
const mesh = new THREE.Mesh(pg0,oceanMaterial);
mesh.receiveShadow = true;
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

const WORLD_RESOURCE_KEYS = ['wood','stone','fiber','berries','planks','rope'];
function worldRuntimeBag(raw = {}) {
    const bag = {};
    WORLD_RESOURCE_KEYS.forEach(key => { bag[key] = Math.max(0, Math.min(999999, Math.floor(Number(raw?.[key]) || 0))); });
    return bag;
}
function normalizeWorldRuntimeSave(raw = {}) {
    const placed = Array.isArray(raw?.placedChests) ? raw.placedChests.slice(0, 40).map((item, index) => ({
        id:String(item?.id || `chest-${index}`).replace(/[^a-z0-9-]/gi,'').slice(0,40) || `chest-${index}`,
        x:Math.max(-1400,Math.min(1400,Number(item?.x)||0)), z:Math.max(-1400,Math.min(1400,Number(item?.z)||0)),
        storage:worldRuntimeBag(item?.storage), kind:item?.kind==='lootChest'?'lootChest':'placedChest'
    })) : [];
    return {
        inventory:worldRuntimeBag(raw?.inventory || {wood:3,stone:2,fiber:3,berries:2}), shipChest:worldRuntimeBag(raw?.shipChest),
        tools:{axe:raw?.tools?.axe === true,pickaxe:raw?.tools?.pickaxe === true},
        craftedChests:Math.max(0,Math.min(40,Math.floor(Number(raw?.craftedChests)||0))), placedChests:placed,
        harvested:Array.isArray(raw?.harvested) ? [...new Set(raw.harvested.filter(id => typeof id === 'string' && /^[a-z0-9-]{1,64}$/i.test(id)))].slice(0,600) : [],
        discovered:Array.isArray(raw?.discovered) ? [...new Set(raw.discovered.filter(id => typeof id === 'string' && /^[a-z0-9-]{1,48}$/i.test(id)))].slice(0,64) : [],
        defeatedMonsters:Array.isArray(raw?.defeatedMonsters) ? [...new Set(raw.defeatedMonsters.filter(id => typeof id === 'string' && /^[a-z0-9-]{1,64}$/i.test(id)))].slice(0,240) : [],
        gear: raw?.gear && typeof raw.gear==='object' ? Object.fromEntries(Object.entries(raw.gear).filter(([key,value])=>/^[a-z0-9._:-]{1,80}$/i.test(key)&&typeof value==='boolean').slice(0,120)) : {},
        modifiers: raw?.modifiers && typeof raw.modifiers==='object' ? Object.fromEntries(Object.entries(raw.modifiers).filter(([key,value])=>/^[a-z0-9._-]{1,48}$/i.test(key)&&Number.isFinite(Number(value))).slice(0,40).map(([key,value])=>[key,clamp(Number(value),-100,500)])) : {},
        health:Math.max(1,Math.min(180,Math.floor(Number(raw?.health)||100))),
        ship:{x:clamp(Number(raw?.ship?.x)||0,-1400,1400),z:clamp(Number(raw?.ship?.z)||0,-1400,1400),heading:clamp(Number(raw?.ship?.heading)||0,-Math.PI,Math.PI)}
    };
}
let worldRuntimeSave = normalizeWorldRuntimeSave(window.AQUAVOID_BOOT?.gameSave?.survival || {});
let worldSessionActive = false;
let worldRuntimeYaw = 0, worldRuntimePitch = .24;
let worldRuntimeVelocity = new THREE.Vector3();
let worldRuntimePlayerPosition = new THREE.Vector3(0,.62,1.8);
let worldRuntimePlayer = null;
let worldRuntimeWorld = null;
let worldRuntimeDeck = null;
let worldRuntimeInteractables = [];
let worldRuntimeSurfaces = [];
let worldRuntimeActiveChest = null;
let worldRuntimeInventoryOpen = false;
let worldRuntimeChestOpen = false;
let worldRuntimeCurrentIsland = 'ship';
let worldRuntimeInteractionTarget = null;
let worldRuntimeLastSave = 0;
let worldRuntimeModeDefinition = null;
let worldRuntimeWorldSeed = 8128;
let worldRuntimeMonsters = [];
let worldRuntimeSailingMode = false;
let worldRuntimeSailingFirstPerson = false;
let worldRuntimeShipHeading = 0;
let worldRuntimeShipSpeed = 0;
let worldRuntimePlayerHealth = 100;
let worldRuntimeVerticalVelocity = 0;
let worldRuntimeJumpWasDown = false;
let worldRuntimeAttackCooldown = 0;
let worldRuntimeViewModel = null;
let worldRuntimeStepClock = 0;
let worldRuntimeActiveMerchant = null;
let worldRuntimeGeneratedIslandCount = 0;

// Island WorldRuntimes world: a low-poly 3D survival sandbox that shares the same
// Three.js scene, renderer, camera and cloud-save account as Aquavoid.
worldRuntimeWorld = new THREE.Group();
worldRuntimeWorld.visible = false;
S.add(worldRuntimeWorld);
worldRuntimeDeck = new THREE.Group();
worldRuntimeDeck.visible = false;
const worldRuntimeWoodMat = new THREE.MeshStandardMaterial({color:0x805232,roughness:.92});
const worldRuntimeWoodLightMat = new THREE.MeshStandardMaterial({color:0xb17a48,roughness:.88});
const worldRuntimeRopeMat = new THREE.MeshStandardMaterial({color:0xd4c08a,roughness:1});
const worldRuntimeSandMat = new THREE.MeshStandardMaterial({color:0xe0c58a,roughness:1});
const worldRuntimeGrassMat = new THREE.MeshStandardMaterial({color:0x438754,roughness:1});
const worldRuntimeLeafMat = new THREE.MeshStandardMaterial({color:0x24764f,roughness:1});
const worldRuntimeStoneMat = new THREE.MeshStandardMaterial({color:0x687b84,roughness:1});
const worldRuntimeFiberMat = new THREE.MeshStandardMaterial({color:0x83a56a,roughness:1});
const worldRuntimeBerryMat = new THREE.MeshStandardMaterial({color:0xb94c68,roughness:.65});
const worldRuntimeChestWood = new THREE.MeshStandardMaterial({color:0x8b572e,roughness:.82});
const worldRuntimeMetal = new THREE.MeshStandardMaterial({color:0x9aa8ae,metalness:.72,roughness:.3});
const worldRuntimeSharedMaterials = new Set([worldRuntimeWoodMat,worldRuntimeWoodLightMat,worldRuntimeRopeMat,worldRuntimeSandMat,worldRuntimeGrassMat,worldRuntimeLeafMat,worldRuntimeStoneMat,worldRuntimeFiberMat,worldRuntimeBerryMat,worldRuntimeChestWood,worldRuntimeMetal]);
function clearWorldRuntimeGroup(group) {
    group.traverse(object=>{
        if(object.geometry)object.geometry.dispose();
        if(object.material){const materials=Array.isArray(object.material)?object.material:[object.material];materials.forEach(material=>{if(!worldRuntimeSharedMaterials.has(material))material.dispose();});}
    });
    group.clear();
}
function worldRuntimeMesh(parent, geometry, material, x, y, z, sx=1, sy=1, sz=1) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x,y,z); mesh.scale.set(sx,sy,sz); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
}
function buildWorldRuntimeDeck() {
    clearWorldRuntimeGroup(worldRuntimeDeck);
    const floor = worldRuntimeMesh(worldRuntimeDeck,new THREE.BoxGeometry(4.6,.32,7.8),worldRuntimeWoodMat,0,.34,0);
    worldRuntimeMesh(worldRuntimeDeck,new THREE.BoxGeometry(4.35,.06,7.5),worldRuntimeWoodLightMat,0,.53,0);
    for (let x=-1.95;x<=1.951;x+=.65) worldRuntimeMesh(worldRuntimeDeck,new THREE.BoxGeometry(.035,.035,7.35),worldRuntimeRopeMat,x,.57,0);
    for (const side of [-1,1]) {
        worldRuntimeMesh(worldRuntimeDeck,new THREE.BoxGeometry(.13,.8,7.55),worldRuntimeWoodMat,side*2.2,.88,0);
        for (let z=-3.4;z<=3.401;z+=1.25) worldRuntimeMesh(worldRuntimeDeck,new THREE.BoxGeometry(.15,.9,.15),worldRuntimeWoodLightMat,side*2.2,.9,z);
        worldRuntimeMesh(worldRuntimeDeck,new THREE.BoxGeometry(.15,.1,7.7),worldRuntimeRopeMat,side*2.2,1.28,0);
    }
    worldRuntimeMesh(worldRuntimeDeck,new THREE.BoxGeometry(4.45,.13,.15),worldRuntimeWoodLightMat,0,.8,-3.75);
    worldRuntimeMesh(worldRuntimeDeck,new THREE.BoxGeometry(4.45,.13,.15),worldRuntimeWoodLightMat,0,.8,3.75);
    // Hatch, helm, mast footing and deck details.
    worldRuntimeMesh(worldRuntimeDeck,new THREE.BoxGeometry(1.1,.08,1.2),worldRuntimeWoodMat,-.8,.62,-.75);
    worldRuntimeMesh(worldRuntimeDeck,new THREE.CylinderGeometry(.45,.5,.22,10),worldRuntimeMetal,0,.72,2.55);
    worldRuntimeMesh(worldRuntimeDeck,new THREE.CylinderGeometry(.08,.1,1.1,8),worldRuntimeWoodLightMat,0,1.35,2.55);
    const wheel = worldRuntimeMesh(worldRuntimeDeck,new THREE.TorusGeometry(.52,.06,10,18),worldRuntimeWoodLightMat,0,1.85,2.55); wheel.rotation.x=Math.PI/2;
    for(let spoke=0;spoke<8;spoke++){const a=spoke*Math.PI/4;const handle=worldRuntimeMesh(worldRuntimeDeck,new THREE.CylinderGeometry(.035,.035,.82,6),worldRuntimeWoodLightMat,Math.sin(a)*.22,1.85+Math.cos(a)*.22,2.55);handle.rotation.z=-a;}
    const mast=worldRuntimeMesh(worldRuntimeDeck,new THREE.CylinderGeometry(.12,.18,8,12),worldRuntimeWoodMat,0,4.5,-.75);
    const yard=worldRuntimeMesh(worldRuntimeDeck,new THREE.CylinderGeometry(.07,.07,5.4,8),worldRuntimeWoodLightMat,0,6.1,-.75); yard.rotation.z=Math.PI/2;
    const sailMat=new THREE.MeshStandardMaterial({color:0xe9e2cd,roughness:.95,side:THREE.DoubleSide});
    const canvas=worldRuntimeMesh(worldRuntimeDeck,new THREE.PlaneGeometry(4.2,3.2),sailMat,0,5.9,-.8); canvas.rotation.y=Math.PI;
    for(const side of [-1,1]){const rope=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(side*2.25,.9,-3.2),new THREE.Vector3(0,8,-.75)]),new THREE.LineBasicMaterial({color:0xcbbd9b}));worldRuntimeDeck.add(rope);}
    const lantern=worldRuntimeMesh(worldRuntimeDeck,new THREE.SphereGeometry(.16,10,8),new THREE.MeshBasicMaterial({color:0xffd18a}),-1.65,1.35,-2.6); lantern.material.emissive=new THREE.Color(0xff9a35);
    const helmMarker=new THREE.Group();helmMarker.position.set(0,1.9,2.55);helmMarker.visible=true;worldRuntimeDeck.add(helmMarker);
    P.add(worldRuntimeDeck);
    let helmNode=worldRuntimeInteractables.find(node=>node.id==='ship-helm');
    if(!helmNode){helmNode={id:'ship-helm',type:'helm',object:helmMarker,x:0,z:2.55,localToShip:true,active:true};worldRuntimeInteractables.push(helmNode);}else{helmNode.object=helmMarker;helmNode.active=true;}
    const locker=createWorldRuntimeChestVisual(worldRuntimeDeck,-.92,.62,-1.52);
    let lockerNode=worldRuntimeInteractables.find(node=>node.id==='ship-locker');
    if(!lockerNode){lockerNode={id:'ship-locker',type:'shipChest',object:locker,x:-.92,z:-1.52,localToShip:true,storage:worldRuntimeSave.shipChest,active:true};worldRuntimeInteractables.push(lockerNode);}
    else {lockerNode.object=locker;lockerNode.storage=worldRuntimeSave.shipChest;lockerNode.active=true;}
}
function createWorldRuntimeChestVisual(parent, x, y, z) {
    const group = new THREE.Group(); group.position.set(x,y,z); parent.add(group);
    worldRuntimeMesh(group,new THREE.BoxGeometry(1.15,.62,.82),worldRuntimeChestWood,0,.35,0);
    worldRuntimeMesh(group,new THREE.BoxGeometry(1.18,.12,.88),worldRuntimeWoodLightMat,0,.68,0);
    worldRuntimeMesh(group,new THREE.BoxGeometry(.13,.72,.09),worldRuntimeMetal,0,.37,.46);
    worldRuntimeMesh(group,new THREE.BoxGeometry(.22,.18,.1),worldRuntimeMetal,0,.42,.52);
    return group;
}
function addWorldRuntimeResource(id,type,x,z,amount=1) {
    const group = new THREE.Group(); group.position.set(x,1.55,z); worldRuntimeWorld.add(group);
    if (type === 'wood') {
        worldRuntimeMesh(group,new THREE.CylinderGeometry(.22,.34,2.4,8),worldRuntimeWoodMat,0,1.2,0);
        worldRuntimeMesh(group,new THREE.ConeGeometry(1.15,2.1,8),worldRuntimeLeafMat,0,2.8,0);
        worldRuntimeMesh(group,new THREE.ConeGeometry(.92,1.75,8),worldRuntimeGrassMat,0,3.45,0);
        for (let i=0;i<3;i++) { const branch=worldRuntimeMesh(group,new THREE.CylinderGeometry(.07,.11,.9,6),worldRuntimeWoodLightMat,Math.cos(i*2.1)*.45,1.6,Math.sin(i*2.1)*.45); branch.rotation.z=(i-1)*.6; }
    } else if (type === 'stone') {
        worldRuntimeMesh(group,new THREE.DodecahedronGeometry(.8,1),worldRuntimeStoneMat,0,.65,0,1.2,.9,1);
        worldRuntimeMesh(group,new THREE.DodecahedronGeometry(.36,0),worldRuntimeMetal,.5,.35,.15,.6,.45,.55);
    } else if (type === 'fiber') {
        for (let i=0;i<4;i++) { const leaf=worldRuntimeMesh(group,new THREE.ConeGeometry(.18,1.25,5),worldRuntimeFiberMat,Math.cos(i*1.57)*.32,.62,Math.sin(i*1.57)*.32); leaf.rotation.z=Math.cos(i*1.57)*.5; leaf.rotation.x=Math.sin(i*1.57)*.5; }
    } else if (type === 'berries') {
        worldRuntimeMesh(group,new THREE.SphereGeometry(.45,9,8),worldRuntimeFiberMat,0,.55,0,1.35,.9,1.1);
        for (let i=0;i<5;i++) worldRuntimeMesh(group,new THREE.SphereGeometry(.095,8,7),worldRuntimeBerryMat,Math.cos(i*1.25)*.45,.6+(i%2)*.22,Math.sin(i*1.25)*.38);
    }
    const marker = worldRuntimeMesh(group,new THREE.OctahedronGeometry(.12),new THREE.MeshBasicMaterial({color:type==='wood'?0x81c987:type==='stone'?0xb0c5d0:type==='fiber'?0xc6dc86:0xff9cbd,transparent:true,opacity:.82}),0, type==='wood'?4.15:1.65,0);
    group.userData.marker = marker;
    worldRuntimeInteractables.push({id,type,amount,object:group,x,z,active:!worldRuntimeSave.harvested.includes(id)});
    group.visible = !worldRuntimeSave.harvested.includes(id);
}
function worldRuntimeRandom(seed) { let state=(Number(seed)>>>0)||1; return () => { state=(state*1664525+1013904223)>>>0; return state/4294967296; }; }
function createWorldRuntimeIslandTerrain(radius,biome,rng){
    const segments=64,rings=12,positions=[],colours=[],indices=[];
    const sand=new THREE.Color(biome==='arctic'?'#bdc8c5':biome==='volcanic'?'#786c72':'#ddc68f');
    const grass=new THREE.Color(biome==='arctic'?'#9fb8b5':biome==='volcanic'?'#4d6459':'#3e8a57');
    const moss=new THREE.Color(biome==='arctic'?'#c6d6d0':biome==='volcanic'?'#697b63':'#6d9e58');
    const phase=rng()*Math.PI*2;
    for(let ring=0;ring<=rings;ring++){
        const t=ring/rings;
        for(let seg=0;seg<=segments;seg++){
            const a=seg/segments*Math.PI*2;
            const edgeNoise=1+Math.sin(a*3+phase)*.035+Math.sin(a*7-phase*.7)*.018+Math.cos(a*11+phase)*.012;
            const r=radius*t*edgeNoise;
            const height=1.08+Math.pow(1-t,1.65)*.72+Math.sin(a*4+phase)*Math.sin(t*Math.PI)*.055+(rng()-.5)*.012;
            positions.push(Math.cos(a)*r,height,Math.sin(a)*r*.84);
            const shore=THREE.MathUtils.smoothstep(t,.72,.94);
            const colour=(t<.52?moss:grass).clone().lerp(sand,shore*.96);
            colours.push(colour.r,colour.g,colour.b);
        }
    }
    const row=segments+1;
    for(let ring=0;ring<rings;ring++)for(let seg=0;seg<segments;seg++){
        const a=ring*row+seg,b=a+row;indices.push(a,b,a+1,b,b+1,a+1);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
function addWorldRuntimeIsland(definition,index=0) {
    const {id,name,x,z,radius,biome='tropical'}=definition;
    const rng=worldRuntimeRandom(worldRuntimeWorldSeed ^ [...id].reduce((n,c)=>Math.imul(n^c.charCodeAt(0),16777619),2166136261));
    const island=new THREE.Group();island.position.set(x,0,z);island.userData.worldIslandId=id;island.userData.worldIslandName=name;worldRuntimeWorld.add(island);
    const sand=biome==='volcanic'?new THREE.MeshStandardMaterial({color:0x66545a,roughness:1}):worldRuntimeSandMat;
    const grass=biome==='arctic'?new THREE.MeshStandardMaterial({color:0x8faeae,roughness:1}):biome==='volcanic'?new THREE.MeshStandardMaterial({color:0x475b52,roughness:1}):worldRuntimeGrassMat;
    worldRuntimeMesh(island,new THREE.SphereGeometry(1,56,32),sand,0,.55,0,radius,.68,radius*.86);
    const terrainMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96,metalness:0});
    const terrainMesh=new THREE.Mesh(createWorldRuntimeIslandTerrain(radius*.88,biome,rng),terrainMaterial);terrainMesh.castShadow=true;terrainMesh.receiveShadow=true;island.add(terrainMesh);
    const foam=new THREE.Mesh(new THREE.TorusGeometry(radius*.78,.16,8,64),new THREE.MeshStandardMaterial({color:0xe5f7ef,transparent:true,opacity:.48,roughness:.22,metalness:.08}));foam.rotation.x=Math.PI/2;foam.position.y=1.18;foam.scale.y=.82;island.add(foam);
    // Natural shoreline shelves, reef stones and driftwood.
    for(let i=0;i<Math.max(8,Math.floor(radius*.9));i++){const a=rng()*Math.PI*2,r=radius*(.62+rng()*.3),px=Math.cos(a)*r,pz=Math.sin(a)*r*.82;const rock=worldRuntimeMesh(island,new THREE.DodecahedronGeometry(.28+rng()*.5,1),worldRuntimeStoneMat,px,1.65,pz,.8+rng()*.8,.55+rng()*.6,.8+rng()*.8);rock.rotation.set(rng(),rng(),rng());}
    const palms=Math.max(2,Math.min(9,Math.floor(radius/3.6)));
    for(let i=0;i<palms;i++){
        const a=rng()*Math.PI*2,r=radius*(.18+rng()*.43),tx=Math.cos(a)*r,tz=Math.sin(a)*r*.7;
        const trunk=worldRuntimeMesh(island,new THREE.CylinderGeometry(.12,.22,2.8+rng(),9),worldRuntimeWoodMat,tx,2.8,tz);trunk.rotation.z=(rng()-.5)*.28;trunk.rotation.x=(rng()-.5)*.25;
        const crown=new THREE.Group();crown.position.set(tx,4.2,tz);island.add(crown);
        for(let f=0;f<8;f++){const angle=f*Math.PI/4,leaf=worldRuntimeMesh(crown,new THREE.ConeGeometry(.22,2.3,6),worldRuntimeLeafMat,Math.cos(angle)*.78,0,Math.sin(angle)*.78);leaf.rotation.z=Math.cos(angle)*.92;leaf.rotation.x=-Math.sin(angle)*.92;}
    }
    // Dense shoreline shrubs and driftwood provide scale and silhouettes between palms.
    for(let bush=0;bush<Math.max(5,Math.floor(radius*.55));bush++){
        const a=rng()*Math.PI*2,r=radius*(.2+rng()*.58),bx=Math.cos(a)*r,bz=Math.sin(a)*r*.7;
        const bushMat=biome==='arctic'?worldRuntimeStoneMat:worldRuntimeLeafMat;
        worldRuntimeMesh(island,new THREE.IcosahedronGeometry(.42+rng()*.28,1),bushMat,bx,1.72,bz,1.2,.72,1.35);
        if(rng()>.55){const log=worldRuntimeMesh(island,new THREE.CylinderGeometry(.08,.11,1.2,7),worldRuntimeWoodLightMat,bx+.4,1.48,bz+.2);log.rotation.z=Math.PI/2+(rng()-.5)*.25;}
    }
    // Low-poly landmark and sheltered camp, placed at a deterministic point.
    const camp=new THREE.Group();camp.position.set(-radius*.22,1.55,-radius*.18);island.add(camp);
    worldRuntimeMesh(camp,new THREE.CylinderGeometry(.56,.7,.16,12),worldRuntimeStoneMat,0,.08,0);
    for(let a=0;a<3;a++){const log=worldRuntimeMesh(camp,new THREE.CylinderGeometry(.09,.09,1.22,8),worldRuntimeWoodLightMat,Math.cos(a*2.1)*.19,.23,Math.sin(a*2.1)*.19);log.rotation.z=Math.PI/2;}
    const fire=worldRuntimeMesh(camp,new THREE.ConeGeometry(.3,.7,8),new THREE.MeshBasicMaterial({color:0xffa24d}),0,.5,0);
    const fireLight=new THREE.PointLight(0xff8c45,1.2,12,2);fireLight.position.set(0,1.1,0);camp.add(fireLight);
    // Resource counts and placement come from the .sclient game-mode declaration.
    const counts=definition.resources||{};let resourceIndex=0;
    for(const type of ['wood','stone','fiber','berries']){
        const count=clamp(Math.floor(Number(counts[type])||0),0,16);
        for(let n=0;n<count;n++){
            const a=rng()*Math.PI*2,r=radius*(.22+rng()*.46),px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r*.68;
            addWorldRuntimeResource(`${id}-${type}-${n+1}`,type,px,pz,2+Math.floor(rng()*3));resourceIndex++;
        }
    }
    // Visual island namepost so destinations are readable from the beach.
    const postX=radius*.12,postZ=-radius*.28;
    worldRuntimeMesh(island,new THREE.BoxGeometry(1.7,.12,.13),worldRuntimeWoodLightMat,postX,2.05,postZ);
    worldRuntimeMesh(island,new THREE.BoxGeometry(.13,1.05,.13),worldRuntimeWoodMat,postX,1.55,postZ);
    const plaque=worldRuntimeMesh(island,new THREE.BoxGeometry(1.48,.42,.06),worldRuntimeWoodMat,postX,2.34,postZ-.04);
    worldRuntimeSurfaces.push({type:'island',id,name,x,z,r:radius*.82,y:1.55,biome});
    if(definition.cache!==false){
        const cacheId=`${id}-cache`,saved=worldRuntimeSave.placedChests.find(chest=>chest.id===cacheId);
        const cx=x+radius*.16,cz=z+radius*.28,visual=createWorldRuntimeChestVisual(worldRuntimeWorld,cx,1.55,cz);
        const stash=saved?.storage||{wood:2+index%3,stone:index%2?2:1,fiber:2,berries:1,planks:0,rope:0};
        worldRuntimeInteractables.push({id:cacheId,type:saved?.kind==='placedChest'?'placedChest':'lootChest',object:visual,x:cx,z:cz,storage:worldRuntimeBag(stash),active:true});
    }
    (definition.merchants||[]).forEach((merchant,merchantIndex)=>createWorldRuntimeMerchant(island,merchant,merchantIndex));
    return island;
}

function createWorldRuntimeMerchant(island,definition,index=0){
    const group=new THREE.Group();group.position.set(Number(definition.x)||0,1.56,Number(definition.z)||0);island.add(group);
    const coat=new THREE.MeshStandardMaterial({color:definition.coatColor||'#34465c',roughness:.82});
    const skin=new THREE.MeshStandardMaterial({color:definition.skinColor||'#d49a76',roughness:.88});
    const gold=new THREE.MeshStandardMaterial({color:0xd7ad58,metalness:.55,roughness:.34});
    worldRuntimeMesh(group,new THREE.CylinderGeometry(.26,.34,.92,10),coat,0,.75,0);
    worldRuntimeMesh(group,new THREE.SphereGeometry(.25,16,14),skin,0,1.4,-.02);
    worldRuntimeMesh(group,new THREE.CylinderGeometry(.3,.33,.13,10),gold,0,1.63,0);
    const brim=worldRuntimeMesh(group,new THREE.CylinderGeometry(.46,.46,.07,16),coat,0,1.68,0);
    worldRuntimeMesh(group,new THREE.BoxGeometry(.5,.1,.08),gold,0,1.43,-.24);
    for(const side of [-1,1]){const arm=worldRuntimeMesh(group,new THREE.CylinderGeometry(.09,.11,.58,8),coat,side*.34,.82,0);arm.rotation.z=side*.4;}
    const stall=worldRuntimeMesh(group,new THREE.BoxGeometry(1.45,.12,.72),worldRuntimeWoodLightMat,0,.48,-.85);
    for(const side of [-1,1])worldRuntimeMesh(group,new THREE.CylinderGeometry(.045,.045,1.4,7),worldRuntimeWoodMat,side*.6,1.1,-.85);
    const awning=worldRuntimeMesh(group,new THREE.BoxGeometry(1.55,.09,.85),gold,0,1.75,-.85);awning.rotation.x=-.12;
    const id=`${island.userData.worldIslandId||'island'}-merchant-${index+1}`;
    worldRuntimeInteractables.push({id,type:'merchant',object:group,x:island.position.x+group.position.x,z:island.position.z+group.position.z,active:true,merchant:definition,islandName:island.userData.worldIslandName||'Island'});
}
function worldRuntimeOpenMerchant(node){
    if(!node?.merchant)return;
    worldRuntimeActiveMerchant=node;
    $('worldRuntimeMerchantTitle').textContent=node.merchant.name.toUpperCase();
    $('worldRuntimeMerchantGreeting').textContent=node.merchant.greeting;
    $('worldRuntimeMerchantWares').replaceChildren();
    node.merchant.wares.forEach(ware=>{
        const button=document.createElement('button');button.type='button';button.className='worldRuntime-ware';
        const owned=worldRuntimeSave.gear[`${node.id}:${ware.id}`]===true;
        button.disabled=(owned&&ware.kind!=='resource')||coins<ware.price;
        button.innerHTML=`<span class="worldRuntime-ware-icon">${ware.icon}</span><span class="worldRuntime-ware-copy"><strong>${escapeHTML(ware.name)}</strong><small>${escapeHTML(ware.description||ware.kind)}</small></span><b>${owned&&ware.kind!=='resource'?'OWNED':`${ware.price} COINS`}</b>`;
        button.addEventListener('click',()=>worldRuntimePurchaseWare(node,ware));
        $('worldRuntimeMerchantWares').appendChild(button);
    });
    $('worldRuntimeMerchantBalance').textContent=`YOUR PURSE · ${coins.toLocaleString()} COINS`;
    $('worldRuntimeMerchantPanel').hidden=false;
}
function worldRuntimePurchaseWare(node,ware){
    if(!node||!ware||coins<ware.price){toast('Not enough coins for that trade.');return;}
    const key=`${node.id}:${ware.id}`;
    if(worldRuntimeSave.gear[key]===true&&ware.kind!=='resource'){toast('You already own this gear.');return;}
    coins-=ware.price;
    if(ware.kind==='resource')worldRuntimeSave.inventory[ware.resource]=Math.min(999999,worldRuntimeSave.inventory[ware.resource]+ware.quantity);
    else if(ware.kind==='tool')worldRuntimeSave.tools[ware.tool]=true;
    else {worldRuntimeSave.gear[key]=true;Object.entries(ware.effects||{}).forEach(([effect,value])=>{worldRuntimeSave.modifiers[effect]=clamp((worldRuntimeSave.modifiers[effect]||0)+Number(value),-100,500);});}
    save();showCoins();worldRuntimeFormatInventory();worldRuntimeOpenMerchant(node);worldRuntimeSetPrompt(`TRADE COMPLETE · ${ware.name.toUpperCase()}`);toast(`Purchased ${ware.name}.`);
}
function worldRuntimeCloseMerchant(){ $('worldRuntimeMerchantPanel').hidden=true;worldRuntimeActiveMerchant=null; }

function addWorldRuntimeMonster(species,island,index=0){
    const id=`${island.id}-${species.id}-${index+1}`;if(worldRuntimeSave.defeatedMonsters.includes(id))return;
    const rng=worldRuntimeRandom(worldRuntimeWorldSeed+index*311+[...id].reduce((n,c)=>n+c.charCodeAt(0),0));
    const angle=rng()*Math.PI*2,dist=island.radius*(.2+rng()*.28),x=island.x+Math.cos(angle)*dist,z=island.z+Math.sin(angle)*dist*.7;
    const group=new THREE.Group();group.position.set(x,1.65,z);worldRuntimeWorld.add(group);
    const mat=new THREE.MeshStandardMaterial({color:species.color||'#668b88',roughness:.65,metalness:.05});
    const glow=new THREE.MeshStandardMaterial({color:species.color||'#668b88',emissive:species.color||'#668b88',emissiveIntensity:.22,roughness:.3});
    const body=worldRuntimeMesh(group,new THREE.DodecahedronGeometry(.72,1),mat,0,.6,0,1.25,.9,1.35);
    worldRuntimeMesh(group,new THREE.SphereGeometry(.4,14,12),mat,0,1.2,-.34,1.0,.8,.8);
    for(const side of [-1,1]){const eye=worldRuntimeMesh(group,new THREE.SphereGeometry(.085,8,8),new THREE.MeshBasicMaterial({color:0xffdf92}),side*.19,1.27,-.67);}
    for(let leg=0;leg<4;leg++){const a=leg*Math.PI/2,limb=worldRuntimeMesh(group,new THREE.CylinderGeometry(.09,.12,.72,7),mat,Math.cos(a)*.56,.32,Math.sin(a)*.54);limb.rotation.z=Math.cos(a)*.45;limb.rotation.x=Math.sin(a)*.45;}
    group.traverse(o=>{o.castShadow=true;o.receiveShadow=true;});
    worldRuntimeMonsters.push({id,species,object:group,hp:species.health,maxHp:species.health,attackTimer:1+rng()*2,alive:true,islandId:island.id});
}
function buildOpenWorldScene() {
    clearWorldRuntimeGroup(worldRuntimeWorld);worldRuntimeInteractables=[];worldRuntimeSurfaces=[];worldRuntimeMonsters=[];
    const world=worldRuntimeModeDefinition?.world||{};worldRuntimeWorldSeed=world.seed||8128;
    // Deck collision is evaluated in ship-local coordinates so the ship can sail freely.
    worldRuntimeSurfaces.push({type:'deck',halfX:2.22,halfZ:3.72,y:.73});
    const islands=Array.isArray(world.islands)?world.islands.map(item=>({...item,monsters:[...(item.monsters||[])]})):[];
    const generation=world.generation||{};
    if(generation.enabled){
        const rng=worldRuntimeRandom(worldRuntimeWorldSeed^0x51a7c0de),count=clamp(Math.floor(generation.islandCount||0),0,40),existing=islands.slice();
        const used=existing.map(item=>({x:item.x,z:item.z,r:item.radius||12}));
        for(let n=0,attempt=0;n<count&&attempt<count*18;attempt++){
            const angle=rng()*Math.PI*2,distance=(generation.minDistance||140)+rng()*Math.max(1,(generation.maxDistance||1000)-(generation.minDistance||140));
            const radius=(generation.minSize||7)+rng()*Math.max(1,(generation.maxSize||28)-(generation.minSize||7));
            const x=Math.cos(angle)*distance,z=Math.sin(angle)*distance;
            if(used.some(point=>Math.hypot(point.x-x,point.z-z)<point.r+radius+26))continue;
            const biomeRoll=rng(),biome=biomeRoll<.68?'tropical':biomeRoll<.84?'volcanic':'arctic';
            const definition={id:`generated-isle-${n+1}`,name:['Whispering Key','Crescent Reach','Stormglass Isle','Driftwood Haven','Ember Shoal','Blue Heron Cay','Mossback Atoll','Far Lantern','Saltwind Rock','Sunken Crown'][n%10],x,z,radius,biome,resources:{wood:Math.floor(2+rng()*8),stone:Math.floor(1+rng()*8),fiber:Math.floor(2+rng()*7),berries:Math.floor(1+rng()*6)},cache:rng()>.28,monsters:[]};
            const speciesList=world.monsterSpecies||[];
            if(speciesList.length&&rng()<(generation.monsterChance??.45)){const spec=speciesList[Math.floor(rng()*speciesList.length)];definition.monsters.push({species:spec.id,count:1+Math.floor(rng()*2)});}
            islands.push(definition);used.push({x,z,r:radius});n++;
        }
    }
    worldRuntimeGeneratedIslandCount=islands.length;
    islands.forEach((definition,index)=>addWorldRuntimeIsland(definition,index));
    const species=new Map((world.monsterSpecies||[]).map(item=>[item.id,item]));
    islands.forEach(island=>{
        (island.monsters||[]).forEach(spawn=>{const spec=species.get(spawn.species);if(spec)for(let n=0;n<spawn.count;n++)addWorldRuntimeMonster(spec,island,n);});
    });
    // Restore player-placed chests and all harvested resource nodes.
    worldRuntimeSave.placedChests.filter(chest=>!chest.id.endsWith('-cache')).forEach(chest=>{
        const ground=worldRuntimeGroundAt(chest.x,chest.z),visual=createWorldRuntimeChestVisual(worldRuntimeWorld,chest.x,ground.y,chest.z);
        worldRuntimeInteractables.push({id:chest.id,type:'placedChest',object:visual,x:chest.x,z:chest.z,storage:worldRuntimeBag(chest.storage),active:true});
    });
    if(!worldRuntimePlayer){
        worldRuntimePlayer=new THREE.Group();const bodyMat=new THREE.MeshStandardMaterial({color:0x2c6680,roughness:.8}),skinMat=new THREE.MeshStandardMaterial({color:0xe1ad83,roughness:.9}),trimMat=new THREE.MeshStandardMaterial({color:0xe7c46b,metalness:.35,roughness:.55});
        worldRuntimeMesh(worldRuntimePlayer,new THREE.CylinderGeometry(.34,.42,.92,10),bodyMat,0,1.05,0);worldRuntimeMesh(worldRuntimePlayer,new THREE.SphereGeometry(.29,16,14),skinMat,0,1.72,0);worldRuntimeMesh(worldRuntimePlayer,new THREE.CylinderGeometry(.31,.32,.12,10),worldRuntimeWoodMat,0,2.0,0);worldRuntimeMesh(worldRuntimePlayer,new THREE.ConeGeometry(.32,.28,8),trimMat,0,2.17,0);
        for(const side of [-1,1]){const arm=worldRuntimeMesh(worldRuntimePlayer,new THREE.CylinderGeometry(.11,.13,.72,8),skinMat,side*.43,1.17,0);arm.rotation.z=side*-.16;worldRuntimeMesh(worldRuntimePlayer,new THREE.BoxGeometry(.2,.72,.23),new THREE.MeshStandardMaterial({color:0x364d65}),side*.19,.39,0);}S.add(worldRuntimePlayer);
    }
    worldRuntimePlayer.visible=false;buildWorldRuntimeDeck();
    worldRuntimeInteractables.forEach(node=>{if(worldRuntimeSave.harvested.includes(node.id)){node.active=false;node.object.visible=false;}});
}
buildOpenWorldScene();


// Shared Aquavoid ship and movement visuals. Mod-contributed vehicle skins are data-driven.
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
        if (worldSessionActive) { stopWorldSession(); e.preventDefault(); }
        else if (run) { setPaused(!paused); e.preventDefault(); }
        return;
    }
    if (worldSessionActive && e.code === 'KeyE' && !e.repeat) { worldRuntimeInteract(); e.preventDefault(); return; }
    if (worldSessionActive && e.code === 'KeyI' && !e.repeat) { worldRuntimeOpenInventory(); e.preventDefault(); return; }
    if (worldSessionActive && e.code === 'KeyF' && !e.repeat) { worldRuntimeAttack(); e.preventDefault(); return; }
    if (worldSessionActive && worldRuntimeSailingMode && e.code === (worldRuntimeModeDefinition?.camera?.toggleKey||'KeyV') && !e.repeat) { worldRuntimeToggleSailingCamera(); e.preventDefault(); return; }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
    K[e.code] = 1;
    if (['Space','ShiftLeft','ShiftRight','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
}, true);
addEventListener('keyup', e => { K[e.code] = 0; if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') dashWasDown = false; });
let yaw = 0, pitch = .55, drag = false, jx = 0, jz = 0, tj = null, tl = null, tlx = 0, tly = 0, tsx = 0, tsy = 0;
const look = (dx, dy) => { if(worldSessionActive){worldRuntimeYaw-=dx*.0045;worldRuntimePitch=THREE.MathUtils.clamp(worldRuntimePitch+dy*.0035,-.05,.85);} else {yaw -= dx * .006; pitch = THREE.MathUtils.clamp(pitch + dy * .005, .05, 1.4);} };
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
    if ((!run || paused) && !worldSessionActive || activeView !== 'play') return;
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
    shaderRenderTarget.setSize(pixelWidth, pixelHeight);
    shaderPingTarget.setSize(pixelWidth, pixelHeight);
    shaderFrameUniforms.uResolution.value.set(pixelWidth, pixelHeight);
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
let coins = 0
  , owned = [0]
  , sel = 0
  , aquavoidSelectedShip = 0
  , selectedModShipSkinId = String(window.SCLIENT_BOOT?.clientPrefs?.selectedModShipSkinId || '')
  , unlocked = 0
  , bestWave = 0
  , playerName = 'Captain' + (100 + Math.floor(Math.random() * 900))
  , nameSet = false
  , aquavoidLeaderboardError = null
  , wown = [0]
  , wsel = 0
;
let phoenixReviveUsed = false;


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
const SHAPE_OF = ['sloop', 'galleon', 'cat', 'long', 'steam', 'ghost']
  , SHAPES = {};
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
    // Generic mod-provided ship skin renderer. Mods supply only bounded data;
    // this engine builds the hull, deck, rigging and sails without mod-ID checks.
    SHAPES.mod = (skin) => {
        const hullMat=new THREE.MeshStandardMaterial({color:skin.hullColor,metalness:skin.style==='ironclad'?.62:.18,roughness:skin.style==='ironclad'?.34:.72});
        const accentMat=new THREE.MeshStandardMaterial({color:skin.accentColor,metalness:.48,roughness:.42});
        const glowMat=new THREE.MeshStandardMaterial({color:skin.glowColor,emissive:skin.glowColor,emissiveIntensity:.65,metalness:.28,roughness:.3});
        M(bx(1.4,.48,3.15),hullMat,0,.08,0);
        bow(0,1.4,.48,1.5,.08,-2.05,-1);
        M(bx(1.18,.12,2.3),accentMat,0,.37,.12);
        const hullCount=skin.style==='trimaran'?3:skin.style==='catamaran'?2:1;
        if(hullCount>1)for(let sideIndex=0;sideIndex<hullCount;sideIndex++){const side=sideIndex-(hullCount-1)/2;if(side===0)continue;M(bx(.34,.34,2.9),hullMat,side*.9,.02,.05);M(bx(.09,.1,2.55),glowMat,side*.9,.21,.02);}
        if(skin.style==='ironclad'){for(const side of [-1,1]){M(bx(.08,.22,2.8),accentMat,side*.66,.46,.04);M(new THREE.SphereGeometry(.12,10,8),glowMat,side*.55,.62,-1.05);}}
        M(cy(.075,3.8),hullMat,0,2.05,-.08);
        sailPanel(skin.style==='ironclad'?1.5:2.0,2.45,0,2.15,-.18);
        cloth.color.set(skin.sailColor);
        for(const side of [-1,1])M(bx(.045,2.45,.06),glowMat,side*.99,2.16,-.18);
        flag.material.color.set(skin.flagColor);flag.position.set(.28,4.05,-.08);P.add(flag);
        const badgeCanvas=document.createElement('canvas');badgeCanvas.width=badgeCanvas.height=128;const ctx=badgeCanvas.getContext('2d');ctx.clearRect(0,0,128,128);ctx.fillStyle=skin.flagColor;ctx.beginPath();ctx.arc(64,64,56,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffffff';ctx.font='bold 66px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(skin.icon||'⛵',64,68);const badgeTexture=new THREE.CanvasTexture(badgeCanvas);badgeTexture.encoding=THREE.sRGBEncoding;const badge=new THREE.Mesh(new THREE.PlaneGeometry(.75,.75),new THREE.MeshBasicMaterial({map:badgeTexture,transparent:true,side:THREE.DoubleSide,depthWrite:false,toneMapped:false}));badge.position.set(0,2.18,-.31);badge.rotation.y=Math.PI;P.add(badge);
        if(skin.logo){const logoImg=new Image();logoImg.onload=()=>{ctx.clearRect(0,0,128,128);ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(64,64,58,0,Math.PI*2);ctx.fill();ctx.save();ctx.beginPath();ctx.arc(64,64,54,0,Math.PI*2);ctx.clip();ctx.drawImage(logoImg,6,6,116,116);ctx.restore();badgeTexture.needsUpdate=true;};logoImg.src=skin.logo;}
        const lantern=worldRuntimeMesh(P,new THREE.SphereGeometry(.1,10,8),glowMat,0,.55,1.22);
    };
}
const HW = [.65, .9, 1.0, .55, .75, .5]
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
    // A mod-contributed vehicle skin exists in the active game session only.
    const pool=activeSessionMods||[];
    const contributed=pool.filter(record=>record.enabled).flatMap(record=>(record.manifest?.vehicleSkins||[]).map(skin=>({...skin,modId:record.manifest.id,modName:record.manifest.name,modSkinId:`${record.manifest.id}:${skin.id}`,modded:true,p:0})));
    return [...SKINS,...contributed];
}
function saveClientPreferences() {
    window.SClientCloud?.saveClientPrefs?.({ selectedModShipSkinId }).catch(error => {
        console.error('S-Client preference save failed:', error);
        toast('Could not sync your selected ship skin.');
    });
}
function refreshModShipSkins() {
    const ships=availableShips();
    const selectedIndex=selectedModShipSkinId?ships.findIndex(ship=>ship.modSkinId===selectedModShipSkinId):-1;
    if(selectedIndex>=SKINS.length){sel=selectedIndex;applySkin(sel);}
    else if(sel>=SKINS.length){selectedModShipSkinId='';sel=aquavoidSelectedShip;applySkin(sel);saveClientPreferences();}
    if(typeof drawShop==='function')drawShop();
}
function applySkin(i) {
    const ships = availableShips();
    if (!ships[i]) i = 0;
    sel = i;
    const skin = ships[i];
    const hullColor=skin.modded?skin.hullColor:skin.hull,sailColor=skin.modded?skin.sailColor:skin.sail,flagColor=skin.modded?skin.flagColor:skin.flag;
    wood.color.set(skin.modded?hullColor:`#${hullColor.toString(16).padStart(6,'0')}`);
    cloth.color.set(skin.modded?sailColor:`#${sailColor.toString(16).padStart(6,'0')}`);
    flag.material.color.set(skin.modded?flagColor:`#${flagColor.toString(16).padStart(6,'0')}`);
    while (P.children.length) P.remove(P.children[0]);
    if(skin.modded)SHAPES.mod(skin);else {SHAPES[SHAPE_OF[i]]();detail(i);}
    if (typeof buildWorldRuntimeDeck === 'function') buildWorldRuntimeDeck();
}
const hx = n => '#' + n.toString(16).padStart(6, '0');
function drawShop() {
    const g = $('grid');
    g.innerHTML = '';
    availableShips().forEach( (s, i) => {
        const b = document.createElement('button')
          , own = !!s.modded || owned.includes(i);
        const isSelected = s.modded ? selectedModShipSkinId===s.modSkinId : (i===sel && !selectedModShipSkinId);
        b.className = 'sk' + (isSelected ? ' on' : '') + (s.modded ? ' modded-ship-skin' : '');
        const hullHex=s.modded?s.hullColor:hx(s.hull),sailHex=s.modded?s.sailColor:hx(s.sail),shipName=s.modded?s.name:s.n;
        b.innerHTML = '<i style="background:' + hullHex + '"></i><i style="background:' + sailHex + '"></i><span>' + escapeHTML(shipName) + '</span>' + (s.modded ? '<small class="exclusive-note">MOD · '+escapeHTML(s.modName)+'</small>' : '') + '<small>' + (isSelected ? 'Equipped' : own ? 'Equip' : s.p + ' coins') + '</small>';
        b.onclick = () => {
            if(s.modded){selectedModShipSkinId=s.modSkinId;sel=i;applySkin(i);saveClientPreferences();$('note').textContent=`${s.name} equipped from ${s.modName}.`;}
            else if (own) {selectedModShipSkinId='';sel=i;aquavoidSelectedShip=i;applySkin(i);saveClientPreferences();$('note').textContent=s.n+' equipped.';}
            else if (coins >= s.p) {coins-=s.p;owned.push(i);selectedModShipSkinId='';sel=i;aquavoidSelectedShip=i;applySkin(i);saveClientPreferences();$('note').textContent='Bought '+s.n+'!';}
            else $('note').textContent='You need '+(s.p-coins)+' more coins for '+s.n+'. Play a round to earn some.';
            save();showCoins();drawShop();
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
function start(m, li, sessionReady = false) {
    if (!window.AQUAVOID_BOOT?.authenticated || !window.AquavoidCloud?.user) { toast('Sign in with your Aquavoid account before playing.'); return; }
    if (!sessionReady) { loadEnabledModsForAquavoid(() => start(m, li, true)); return; }
    const integrated = getIntegratedWorldMode();
    if (integrated) { enterOpenWorldSession(composeGameModeWithExtensions(integrated.mode), integrated.record); return; }
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
    maxhp = 100;
    hp = maxhp;
    phoenixReviveUsed = false;
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
    for (const id of ['card', 'shop', 'wp', 'lv', 'lb']) { const el=$(id); if(el)el.style.display = 'none'; }
}
;
const showOnly = id => {
    hideAll();
    $(id).style.display = 'flex'
}
;



function worldRuntimeGroundAt(x,z) {
    if(P.visible){P.updateMatrixWorld(true);const local=P.worldToLocal(new THREE.Vector3(x,P.position.y,z));const deck=worldRuntimeSurfaces.find(surface=>surface.type==='deck');if(deck&&Math.abs(local.x)<=deck.halfX&&Math.abs(local.z)<=deck.halfZ){const top=P.localToWorld(new THREE.Vector3(local.x,deck.y,local.z));return {y:top.y,kind:'deck'};}}
    for(const surface of worldRuntimeSurfaces){if(surface.type==='island'&&Math.hypot(x-surface.x,z-surface.z)<=surface.r)return {y:surface.y,kind:'land',island:surface.id,name:surface.name};}
    return {y:.2,kind:'water'};
}
function worldRuntimeNodePosition(node) {
    if(!node?.object)return new THREE.Vector3(Number(node?.x)||0,0,Number(node?.z)||0);
    P.updateMatrixWorld(true); worldRuntimeWorld.updateMatrixWorld(true);
    return node.object.getWorldPosition(new THREE.Vector3());
}
function worldRuntimeNearestInteractable() {
    let bestNode=null,bestDistance=3.2;
    for(const node of worldRuntimeInteractables){
        if(!node.active||!node.object.visible)continue;
        const pos=worldRuntimeNodePosition(node),d=Math.hypot(pos.x-worldRuntimePlayerPosition.x,pos.z-worldRuntimePlayerPosition.z);
        if(d<bestDistance){bestDistance=d;bestNode=node;}
    }
    return bestNode;
}
function worldRuntimeSetPrompt(message) { const prompt=$('worldRuntimePrompt'); if(prompt)prompt.textContent=message; }
function worldRuntimeMaterialTotal(bag) { return WORLD_RESOURCE_KEYS.reduce((sum,key)=>sum+(Number(bag[key])||0),0); }
function worldRuntimeFormatInventory() {
    const bag=worldRuntimeSave.inventory;
    $('worldRuntimeInventoryStats').innerHTML = WORLD_RESOURCE_KEYS.map(key=>`<div class="worldRuntime-item"><span>${({wood:'🪵',stone:'🪨',fiber:'🌿',berries:'🫐',planks:'🪚',rope:'🪢'})[key]} ${key.toUpperCase()}</span><strong>${bag[key]}</strong></div>`).join('');
    $('worldRuntimeToolStats').textContent = `TOOLS · ${worldRuntimeSave.tools.axe?'AXE ✓':'NO AXE'} · ${worldRuntimeSave.tools.pickaxe?'PICKAXE ✓':'NO PICKAXE'}`;
    $('worldRuntimeCraftAxe').disabled=worldRuntimeSave.tools.axe||bag.wood<3||bag.stone<2;
    $('worldRuntimeCraftPickaxe').disabled=worldRuntimeSave.tools.pickaxe||bag.wood<2||bag.stone<3;
    $('worldRuntimeCraftPlanks').disabled=bag.wood<2;
    $('worldRuntimeCraftRope').disabled=bag.fiber<3;
    $('worldRuntimeCraftChest').disabled=bag.planks<8||bag.rope<3||worldRuntimeSave.craftedChests+worldRuntimeSave.placedChests.length>=40;
    $('worldRuntimePlaceChest').disabled=worldRuntimeSave.craftedChests<1;
    $('worldRuntimePlaceChest').textContent=worldRuntimeSave.craftedChests?`PLACE CHEST (${worldRuntimeSave.craftedChests})`:'NO CRAFTED CHEST';
}
function worldRuntimeOpenInventory() {
    if(worldRuntimeChestOpen)return;
    worldRuntimeInventoryOpen=!worldRuntimeInventoryOpen;
    $('worldRuntimeInventoryPanel').hidden=!worldRuntimeInventoryOpen;
    if(worldRuntimeInventoryOpen)worldRuntimeFormatInventory();
}
function worldRuntimeOpenChest(node) {
    worldRuntimeActiveChest=node; worldRuntimeChestOpen=true;
    if(node.type!=='shipChest'){worldRuntimePersistChest(node);save();}
    const storage=node.type==='shipChest'?worldRuntimeSave.shipChest:node.storage||{};
    $('worldRuntimeChestTitle').textContent=node.type==='shipChest'?'SHIP LOCKER':node.type==='lootChest'?'ISLAND SUPPLY CACHE':'FIELD CHEST';
    $('worldRuntimeChestStats').innerHTML=WORLD_RESOURCE_KEYS.map(key=>`<div class="worldRuntime-item"><span>${key.toUpperCase()}</span><strong>${storage[key]||0}</strong></div>`).join('');
    $('worldRuntimeChestPanel').hidden=false;
}
function worldRuntimeCloseChest() {$('worldRuntimeChestPanel').hidden=true;worldRuntimeChestOpen=false;worldRuntimeActiveChest=null;save();}
function worldRuntimeCloseInventory() {$('worldRuntimeInventoryPanel').hidden=true;worldRuntimeInventoryOpen=false;}
function worldRuntimePersistChest(node) {
    if(!node || node.type==='shipChest') return;
    const record={id:node.id,x:node.x,z:node.z,storage:worldRuntimeBag(node.storage),kind:node.type==='lootChest'?'lootChest':'placedChest'};
    const index=worldRuntimeSave.placedChests.findIndex(item=>item.id===node.id);
    if(index>=0)worldRuntimeSave.placedChests[index]=record;else if(worldRuntimeSave.placedChests.length<40)worldRuntimeSave.placedChests.push(record);
}
function worldRuntimeChestStore() {
    if(!worldRuntimeActiveChest)return;
    const storage=worldRuntimeActiveChest.type==='shipChest'?worldRuntimeSave.shipChest:worldRuntimeActiveChest.storage;
    if(!storage)return;
    for(const key of WORLD_RESOURCE_KEYS){storage[key]=(storage[key]||0)+worldRuntimeSave.inventory[key];worldRuntimeSave.inventory[key]=0;}
    if(worldRuntimeActiveChest.type==='shipChest')worldRuntimeSave.shipChest=storage;else {worldRuntimeActiveChest.storage=storage;worldRuntimePersistChest(worldRuntimeActiveChest);}
    save();worldRuntimeOpenChest(worldRuntimeActiveChest);worldRuntimeFormatInventory();toast('All backpack materials stored safely.');
}
function worldRuntimeChestTake() {
    if(!worldRuntimeActiveChest)return;
    const storage=worldRuntimeActiveChest.type==='shipChest'?worldRuntimeSave.shipChest:worldRuntimeActiveChest.storage;
    if(!storage)return;
    for(const key of WORLD_RESOURCE_KEYS){worldRuntimeSave.inventory[key]=Math.min(999999,worldRuntimeSave.inventory[key]+(storage[key]||0));storage[key]=0;}
    if(worldRuntimeActiveChest.type==='shipChest')worldRuntimeSave.shipChest=storage;else {worldRuntimeActiveChest.storage=storage;worldRuntimePersistChest(worldRuntimeActiveChest);}
    save();worldRuntimeOpenChest(worldRuntimeActiveChest);worldRuntimeFormatInventory();toast('Materials moved to your backpack.');
}
function worldRuntimeNearestIslandToShip(){
    const Ppos=P.position;let best=null,bestDistance=Infinity;
    for(const island of worldRuntimeSurfaces.filter(item=>item.type==='island')){const distance=Math.hypot(Ppos.x-island.x,Ppos.z-island.z);if(distance<bestDistance){bestDistance=distance;best={...island,distance};}}
    return best;
}
function worldRuntimeEnterSailing(){
    if(!worldSessionActive||worldRuntimeSailingMode)return;worldRuntimeSailingMode=true;worldRuntimeVerticalVelocity=0;worldRuntimeSailingFirstPerson=worldRuntimeModeDefinition?.camera?.onWheel==='firstPerson';worldRuntimePlayer.visible=false;worldRuntimeShipHeading=P.rotation.y||worldRuntimeShipHeading;worldRuntimeShipSpeed=0;worldRuntimeViewModel&&(worldRuntimeViewModel.visible=false);$('worldRuntimeSailButton').hidden=true;document.exitPointerLock?.();toast('At the helm. Hold W to sail, A/D to steer.');updateWorldRuntimeHUD();
}
function worldRuntimeToggleSailingCamera(){
    if(!worldSessionActive||!worldRuntimeSailingMode||worldRuntimeModeDefinition?.camera?.allowSailingFirstPerson===false)return;
    worldRuntimeSailingFirstPerson=!worldRuntimeSailingFirstPerson;
    const button=$('worldRuntimeCameraButton');if(button)button.textContent=worldRuntimeSailingFirstPerson?'THIRD PERSON · V':'FIRST PERSON · V';
    toast(worldRuntimeSailingFirstPerson?'First-person helm view enabled.':'Deck-follow camera enabled.');
}
function worldRuntimeDisembark(){
    const island=worldRuntimeNearestIslandToShip();worldRuntimeSailingFirstPerson=false;if(!worldRuntimeModeDefinition?.vehicle?.canDisembark||!island||island.distance>island.r+(worldRuntimeModeDefinition?.vehicle?.shoreDistance||20)){toast('Sail closer to an island before going ashore.');return;}
    const dx=P.position.x-island.x,dz=P.position.z-island.z,len=Math.max(.001,Math.hypot(dx,dz));
    worldRuntimePlayerPosition.set(island.x+dx/len*island.r*.66,1.58,island.z+dz/len*island.r*.66);worldRuntimeVelocity.set(0,0,0);worldRuntimeVerticalVelocity=0;worldRuntimeYaw=Math.atan2(-dx,-dz);worldRuntimeSailingMode=false;worldRuntimePlayer.visible=worldRuntimeModeDefinition?.camera?.onFoot==='thirdPerson';worldRuntimeViewModel&&(worldRuntimeViewModel.visible=true);$('worldRuntimeSailButton').hidden=true;toast(`Shore leave: ${island.name}. Explore, gather and watch for creatures.`);updateWorldRuntimeHUD();
}
function worldRuntimeInteract(){
    if(!worldSessionActive||worldRuntimeChestOpen||worldRuntimeInventoryOpen||worldRuntimeActiveMerchant)return;
    if(worldRuntimeSailingMode){const island=worldRuntimeNearestIslandToShip();if(worldRuntimeModeDefinition?.vehicle?.canDisembark!==false&&island&&island.distance<=island.r+(worldRuntimeModeDefinition?.vehicle?.shoreDistance||20)){worldRuntimeDisembark();return;}worldRuntimeSailingMode=false;worldRuntimePlayerPosition.copy(P.localToWorld(new THREE.Vector3(0,.76,1.25)));worldRuntimePlayer.visible=worldRuntimeModeDefinition?.camera?.onFoot==='thirdPerson';worldRuntimeVerticalVelocity=0;worldRuntimeViewModel&&(worldRuntimeViewModel.visible=true);toast('You stepped away from the wheel.');updateWorldRuntimeHUD();return;}
    const node=worldRuntimeNearestInteractable();
    if(node?.type==='helm'){worldRuntimeEnterSailing();return;}
    if(node?.type==='merchant'){worldRuntimeOpenMerchant(node);return;}
    if(node&&['shipChest','lootChest','placedChest'].includes(node.type)){worldRuntimeOpenChest(node);return;}
    if(node&&node.active&&['wood','stone','fiber','berries'].includes(node.type)){
        const bag=worldRuntimeSave.inventory;let amount=node.amount;if(node.type==='wood'&&worldRuntimeSave.tools.axe)amount+=1;if(node.type==='stone'&&worldRuntimeSave.tools.pickaxe)amount+=1;
        bag[node.type]=Math.min(999999,bag[node.type]+amount);node.active=false;node.object.visible=false;worldRuntimeSave.harvested.push(node.id);const location=worldRuntimeSurfaces.find(surface=>surface.type==='island'&&Math.hypot(worldRuntimePlayerPosition.x-surface.x,worldRuntimePlayerPosition.z-surface.z)<surface.r+2);if(location&&!worldRuntimeSave.discovered.includes(location.id))worldRuntimeSave.discovered.push(location.id);save();worldRuntimeFormatInventory();toast(`Collected ${amount} ${node.type}.`);worldRuntimeSetPrompt('Resource collected · keep exploring.');return;
    }
    const local=P.worldToLocal(worldRuntimePlayerPosition.clone());
    if(Math.abs(local.x)<7&&Math.abs(local.z)<9){worldRuntimePlayerPosition.copy(P.localToWorld(new THREE.Vector3(0,.78,1.2)));worldRuntimeVelocity.set(0,0,0);toast('Back aboard your ship. Walk to the wheel and press SAIL when ready.');updateWorldRuntimeHUD();return;}
    toast('Nothing close enough to interact with.');
}
function worldRuntimeAttack(){
    if(!worldSessionActive||worldRuntimeSailingMode||worldRuntimeAttackCooldown>0)return;
    worldRuntimeAttackCooldown=.55;let target=null,best=3.5;
    for(const monster of worldRuntimeMonsters){if(!monster.alive)continue;const d=worldRuntimePlayerPosition.distanceTo(monster.object.position);if(d<best){best=d;target=monster;}}
    if(!target){toast('No island creature in reach.');return;}
    const damage=(worldRuntimeSave.tools.axe?34:22)+Number(worldRuntimeSave.modifiers.attackDamage||0);target.hp-=damage;target.object.scale.setScalar(.94+Math.random()*.08);if(target.hp<=0){target.alive=false;target.object.visible=false;worldRuntimeSave.defeatedMonsters.push(target.id);worldRuntimeSave.inventory.berries=Math.min(999999,worldRuntimeSave.inventory.berries+1);worldRuntimeSave.inventory.fiber=Math.min(999999,worldRuntimeSave.inventory.fiber+1);toast(`${target.species.name} defeated · gathered creature drops.`);save();worldRuntimeFormatInventory();}else toast(`Hit ${target.species.name} · ${Math.ceil(target.hp)} health left.`);
}
function updateWorldRuntimeMonsters(dt){
    if(!worldSessionActive||worldRuntimeSailingMode)return;worldRuntimeAttackCooldown=Math.max(0,worldRuntimeAttackCooldown-dt);
    for(const monster of worldRuntimeMonsters){if(!monster.alive||!monster.object.visible)continue;const obj=monster.object,dx=worldRuntimePlayerPosition.x-obj.position.x,dz=worldRuntimePlayerPosition.z-obj.position.z,d=Math.hypot(dx,dz);if(d<monster.species.aggroRange){if(d>monster.species.attackRange){const step=monster.species.speed*dt;obj.position.x+=dx/Math.max(.01,d)*step;obj.position.z+=dz/Math.max(.01,d)*step;obj.rotation.y=Math.atan2(dx,dz);}else{monster.attackTimer-=dt;if(monster.attackTimer<=0){monster.attackTimer=1.25;worldRuntimePlayerHealth=Math.max(0,worldRuntimePlayerHealth-monster.species.damage);$('worldRuntimeHealthReadout').textContent=`♥ ${worldRuntimePlayerHealth}`;toast(`${monster.species.name} hit you for ${monster.species.damage}.`);if(worldRuntimePlayerHealth<=0){worldRuntimePlayerHealth=60;worldRuntimePlayerPosition.copy(P.localToWorld(new THREE.Vector3(0,.78,1.2)));worldRuntimeVelocity.set(0,0,0);worldRuntimeSave.inventory.berries=Math.floor(worldRuntimeSave.inventory.berries*.75);toast('You were rescued aboard your ship. Some berries were lost.');}save();}}}obj.position.y=1.58+Math.sin(performance.now()*.004+obj.position.x)*.08;}
}

function worldRuntimeCraft(recipe) {
    const bag=worldRuntimeSave.inventory;
    const recipes={
        axe:{cost:{wood:3,stone:2},apply:()=>worldRuntimeSave.tools.axe=true,label:'Stone Axe'},
        pickaxe:{cost:{wood:2,stone:3},apply:()=>worldRuntimeSave.tools.pickaxe=true,label:'Stone Pickaxe'},
        planks:{cost:{wood:2},apply:()=>bag.planks+=3,label:'3 Wooden Planks'},
        rope:{cost:{fiber:3},apply:()=>bag.rope+=1,label:'Rope'},
        chest:{cost:{planks:8,rope:3},apply:()=>worldRuntimeSave.craftedChests+=1,label:'Storage Chest'}
    };
    const selected=recipes[recipe];if(!selected)return;
    if(recipe==='chest'&&worldRuntimeSave.craftedChests+worldRuntimeSave.placedChests.length>=40){toast('Your world has reached the 40-chest storage limit.');return;}
    if(Object.entries(selected.cost).some(([key,value])=>bag[key]<value)){toast('Not enough materials for that recipe.');return;}
    Object.entries(selected.cost).forEach(([key,value])=>bag[key]-=value);selected.apply();
    save();worldRuntimeFormatInventory();toast(`Crafted ${selected.label}.`);
}
function worldRuntimePlaceChest() {
    if(worldRuntimeSave.craftedChests<1)return;
    if(worldRuntimeSave.placedChests.length>=40){toast('Your world has reached the 40-chest storage limit.');return;}
    const fx=-Math.sin(worldRuntimeYaw),fz=-Math.cos(worldRuntimeYaw),x=worldRuntimePlayerPosition.x+fx*2.2,z=worldRuntimePlayerPosition.z+fz*2.2;
    const ground=worldRuntimeGroundAt(x,z);if(ground.kind==='water'){toast('Place chests on the ship, a bridge or an island.');return;}
    const id=`field-chest-${Date.now().toString(36)}`;
    const visual=createWorldRuntimeChestVisual(worldRuntimeWorld,x,ground.y,z);
    const node={id,type:'placedChest',object:visual,x,z,storage:worldRuntimeBag(),active:true};worldRuntimeInteractables.push(node);
    worldRuntimeSave.craftedChests--;
    worldRuntimeSave.placedChests.push({id,x,z,storage:worldRuntimeBag(),kind:'placedChest'});
    save();worldRuntimeFormatInventory();toast('Field chest placed. Press E beside it to open storage.');
}
function updateWorldRuntimeHUD(){
    if(!worldSessionActive)return;
    const node=worldRuntimeNearestInteractable(),island=worldRuntimeSurfaces.filter(item=>item.type==='island').find(item=>Math.hypot(worldRuntimePlayerPosition.x-item.x,worldRuntimePlayerPosition.z-item.z)<item.r),ground=worldRuntimeGroundAt(worldRuntimePlayerPosition.x,worldRuntimePlayerPosition.z);
    worldRuntimeInteractionTarget=node;worldRuntimeCurrentIsland=island?.id||(ground.kind==='deck'?'ship':'open-water');
    if(island&&!worldRuntimeSave.discovered.includes(island.id)){worldRuntimeSave.discovered.push(island.id);activeSessionMods.filter(record=>record.enabled).forEach(record=>executeSclEvent(record,'onWorldEnter',{island:island.id,value:island.name}));save();toast(`Discovered ${island.name}!`);}
    const nearest=worldRuntimeNearestIslandToShip();const total=worldRuntimeGeneratedIslandCount;
    $('worldRuntimeLocation').textContent=worldRuntimeSailingMode?`OPEN SEA · ${nearest?`${nearest.name.toUpperCase()} ${Math.max(0,Math.round(nearest.distance-nearest.r))}M`: 'UNCHARTED'}`:`${island?.name?.toUpperCase()||(ground.kind==='deck'?'YOUR SHIP':'OPEN WATER')} · ${worldRuntimeSave.discovered.length}/${total} ISLANDS`;
    $('worldRuntimeQuickInventory').textContent=`🪵 ${worldRuntimeSave.inventory.wood}   🪨 ${worldRuntimeSave.inventory.stone}   🌿 ${worldRuntimeSave.inventory.fiber}   🫐 ${worldRuntimeSave.inventory.berries}`;
    $('worldRuntimeHealthReadout').textContent=`♥ ${worldRuntimePlayerHealth}`;
    const sail=$('worldRuntimeSailButton');
    let atHelm=false;if(ground.kind==='deck'&&P.visible){const local=P.worldToLocal(worldRuntimePlayerPosition.clone());atHelm=Math.abs(local.x)<1.35&&local.z>1.45;}
    if(worldRuntimeSailingMode){$('worldRuntimeInteractButton').textContent=worldRuntimeModeDefinition?.vehicle?.canDisembark!==false&&nearest&&nearest.distance<=nearest.r+(worldRuntimeModeDefinition?.vehicle?.shoreDistance||20)?'GO ASHORE':'LEAVE HELM';sail.hidden=true;const cameraButton=$('worldRuntimeCameraButton');if(cameraButton){cameraButton.hidden=worldRuntimeModeDefinition?.camera?.allowSailingFirstPerson===false;cameraButton.textContent=worldRuntimeSailingFirstPerson?'THIRD PERSON · '+(worldRuntimeModeDefinition?.camera?.toggleKey||'KeyV').replace('Key',''):'FIRST PERSON · '+(worldRuntimeModeDefinition?.camera?.toggleKey||'KeyV').replace('Key','');}worldRuntimeSetPrompt(`W · SAIL FORWARD   S · REVERSE   A/D · STEER   ${(worldRuntimeModeDefinition?.camera?.toggleKey||'KeyV').replace('Key','')} · CAMERA   E · GO ASHORE WHEN CLOSE`);}
    else if(atHelm||node?.type==='helm'){const cameraButton=$('worldRuntimeCameraButton');if(cameraButton)cameraButton.hidden=true;$('worldRuntimeInteractButton').textContent='INTERACT · E';sail.hidden=false;worldRuntimeSetPrompt('YOU ARE AT THE WHEEL · CLICK SAIL THE SHIP TO TAKE THE HELM');}
    else if(node){const cameraButton=$('worldRuntimeCameraButton');if(cameraButton)cameraButton.hidden=true;sail.hidden=true;const labels={wood:'E · CHOP TREE',stone:'E · MINE ROCK',fiber:'E · GATHER FIBER',berries:'E · PICK BERRIES',shipChest:'E · OPEN SHIP LOCKER',lootChest:'E · OPEN ISLAND CACHE',placedChest:'E · OPEN FIELD CHEST',merchant:`E · TRADE WITH ${node.merchant?.name||'MERCHANT'}`};worldRuntimeSetPrompt(labels[node.type]||'E · INTERACT');$('worldRuntimeInteractButton').textContent='INTERACT · E';}
    else if(ground.kind==='water'){const cameraButton=$('worldRuntimeCameraButton');if(cameraButton)cameraButton.hidden=true;sail.hidden=true;worldRuntimeSetPrompt('SWIMMING · Find an island shore or return to your ship.');$('worldRuntimeInteractButton').textContent='INTERACT · E';}
    else {const cameraButton=$('worldRuntimeCameraButton');if(cameraButton)cameraButton.hidden=true;sail.hidden=true;worldRuntimeSetPrompt('WASD · MOVE   SPACE · JUMP   MOUSE · LOOK   E · INTERACT   F · ATTACK   I · BACKPACK');$('worldRuntimeInteractButton').textContent='INTERACT · E';}
}
function updateWorldRuntimeMovement(dt){
    if(!worldSessionActive||worldRuntimeInventoryOpen||worldRuntimeChestOpen||worldRuntimeActiveMerchant)return;
    if(worldRuntimeSailingMode){
        worldRuntimeVerticalVelocity=0;worldRuntimeJumpWasDown=!!K.Space;
        const throttle=(K.KeyW?1:0)-(K.KeyS?1:0),turn=(K.KeyA?1:0)-(K.KeyD?1:0);
        const shipBoost=Math.max(0,Number(worldRuntimeSave.modifiers.shipSpeed||0))/100;
        worldRuntimeShipSpeed=THREE.MathUtils.damp(worldRuntimeShipSpeed,throttle>0?18*(1+shipBoost):throttle<0?-4:0,throttle?1.65:1.1,dt);
        worldRuntimeShipHeading+=turn*dt*(.42+Math.abs(worldRuntimeShipSpeed)*.035);
        P.position.x-=Math.sin(worldRuntimeShipHeading)*worldRuntimeShipSpeed*dt;P.position.z-=Math.cos(worldRuntimeShipHeading)*worldRuntimeShipSpeed*dt;P.position.y=.05+Math.sin(performance.now()*.0015)*.09;P.rotation.set(Math.sin(performance.now()*.001)*.012,worldRuntimeShipHeading,Math.sin(performance.now()*.0012)*.018);
        worldRuntimePlayerPosition.copy(P.localToWorld(new THREE.Vector3(0,.85,2.45)));worldRuntimeShipSpeed=Math.max(-5,Math.min(19*(1+shipBoost),worldRuntimeShipSpeed));
    }else{
        const inputX=(K.KeyD?1:0)-(K.KeyA?1:0)+jx,inputZ=(K.KeyS?1:0)-(K.KeyW?1:0)+jz,length=Math.hypot(inputX,inputZ);let targetX=0,targetZ=0;
        if(length>.05){const ix=inputX/Math.max(1,length),iz=inputZ/Math.max(1,length);targetX=Math.cos(worldRuntimeYaw)*ix+Math.sin(worldRuntimeYaw)*iz;targetZ=-Math.sin(worldRuntimeYaw)*ix+Math.cos(worldRuntimeYaw)*iz;}
        const ground=worldRuntimeGroundAt(worldRuntimePlayerPosition.x,worldRuntimePlayerPosition.z),speed=(ground.kind==='water'?2.35:5.7)*(1+Number(worldRuntimeSave.modifiers.moveSpeed||0)/100),response=1-Math.exp(-10*dt);
        if(ground.kind==='water'&&P.visible){const local=P.worldToLocal(worldRuntimePlayerPosition.clone());if(Math.abs(local.x)>7||Math.abs(local.z)>9){worldRuntimePlayerPosition.copy(P.localToWorld(new THREE.Vector3(0,.78,1.2)));worldRuntimeVelocity.set(0,0,0);toast('You climbed back aboard. Swim close to shore to leave the ship.');}}
        worldRuntimeVelocity.x+=(targetX*speed-worldRuntimeVelocity.x)*response;worldRuntimeVelocity.z+=(targetZ*speed-worldRuntimeVelocity.z)*response;
        const nx=worldRuntimePlayerPosition.x+worldRuntimeVelocity.x*dt,nz=worldRuntimePlayerPosition.z+worldRuntimeVelocity.z*dt;if(Math.abs(nx)<(worldRuntimeModeDefinition?.world?.worldRadius||1000)&&Math.abs(nz)<(worldRuntimeModeDefinition?.world?.worldRadius||1000)){worldRuntimePlayerPosition.x=nx;worldRuntimePlayerPosition.z=nz;}
        const floor=worldRuntimeGroundAt(worldRuntimePlayerPosition.x,worldRuntimePlayerPosition.z),moving=length>.1;worldRuntimeStepClock+=dt*(moving?8:1);
        // Generic jump physics: gear can raise jump height, regardless of which mod supplied it.
        const jumpDown=!!K.Space;
        const grounded=worldRuntimePlayerPosition.y<=floor.y+.12&&worldRuntimeVerticalVelocity<=0;
        if(jumpDown&&!worldRuntimeJumpWasDown&&grounded&&floor.kind!=='water'){
            const extra=Math.max(0,Number(worldRuntimeSave.modifiers.jumpHeight||0));
            worldRuntimeVerticalVelocity=Math.sqrt(2*18*(1.15+extra/30));
        }
        worldRuntimeJumpWasDown=jumpDown;
        worldRuntimeVerticalVelocity=Math.max(-35,worldRuntimeVerticalVelocity-18*dt);
        worldRuntimePlayerPosition.y+=worldRuntimeVerticalVelocity*dt;
        if(worldRuntimePlayerPosition.y<=floor.y+.02){worldRuntimePlayerPosition.y=floor.y+.02;worldRuntimeVerticalVelocity=0;}
        if(floor.kind==='water'&&worldRuntimePlayerPosition.y<floor.y+.02)worldRuntimePlayerPosition.y=floor.y+.02;
        if(grounded&&moving)worldRuntimePlayerPosition.y+=Math.sin(worldRuntimeStepClock)*.018;
        if(worldRuntimePlayer){worldRuntimePlayer.position.copy(worldRuntimePlayerPosition);worldRuntimePlayer.rotation.y=worldRuntimeYaw;worldRuntimePlayer.visible=worldRuntimeModeDefinition?.camera?.onFoot==='thirdPerson';}
        if(P.visible&&floor.kind==='deck'){P.position.y=.035*Math.sin(performance.now()*.0013);}
    }
    updateWorldRuntimeMonsters(dt);updateWorldRuntimeHUD();
    if(performance.now()-worldRuntimeLastSave>12000){worldRuntimeLastSave=performance.now();worldRuntimeSave.health=worldRuntimePlayerHealth;worldRuntimeSave.ship={x:P.position.x,z:P.position.z,heading:worldRuntimeShipHeading};save();}
}
function enterOpenWorldSession(gameMode,record){
    if(activeView!=='play')setView('play');if($('gameWindow').hidden){toast('Connect your Aquavoid account before entering this world.');return;}if(run){toast('Finish the current run before entering an open world.');return;}
    const difficulty=record?.settings?.worldDifficulty||'normal',scale=difficulty==='calm'?.72:difficulty==='rough'?1.28:1;
    worldRuntimeModeDefinition={...gameMode,world:{...gameMode.world,monsterSpecies:(gameMode.world.monsterSpecies||[]).map(species=>({...species,health:Math.round(species.health*scale),damage:Math.max(1,Math.round(species.damage*scale)),speed:species.speed*(difficulty==='rough'?1.12:1)}))}};
    worldRuntimePlayerHealth=clamp((worldRuntimeSave.health||100)+Number(worldRuntimeSave.modifiers.maxHealth||0),1,180);worldRuntimeShipHeading=worldRuntimeSave.ship?.heading??gameMode.world.ship.heading??0;
    P.position.set(worldRuntimeSave.ship?.x??gameMode.world.ship.spawnX,0,worldRuntimeSave.ship?.z??gameMode.world.ship.spawnZ);P.rotation.set(0,worldRuntimeShipHeading,0);P.visible=true;
    base=.26;surge=0;tidalAmplitudeBoost=false;
    buildOpenWorldScene();worldSessionActive=true;worldRuntimeWorld.visible=true;worldRuntimeDeck.visible=true;worldRuntimeSailingMode=false;worldRuntimeShipSpeed=0;worldRuntimeVelocity.set(0,0,0);
    worldRuntimePlayerPosition.copy(P.localToWorld(new THREE.Vector3(0,.78,-1.65)));worldRuntimeYaw=worldRuntimeShipHeading;worldRuntimePitch=-.04;worldRuntimeVerticalVelocity=0;worldRuntimePlayer.visible=worldRuntimeModeDefinition?.camera?.onFoot==='thirdPerson';
    worldRuntimeInventoryOpen=false;worldRuntimeChestOpen=false;worldRuntimeActiveMerchant=null;$('worldRuntimeInventoryPanel').hidden=true;$('worldRuntimeChestPanel').hidden=true;$('worldRuntimeMerchantPanel').hidden=true;$('worldRuntimeHud').hidden=false;$('worldRuntimeSailButton').hidden=true;
    document.exitPointerLock?.();$('card').style.display='none';$('shop').style.display='none';$('wp').style.display='none';$('lv').style.display='none';$('lb').style.display='none';$('hud').style.display='none';$('hpb').style.display='none';$('pauseScreen').style.display='none';$('modePill').textContent=gameMode.name.toUpperCase();$('pauseButton').disabled=true;$('gameHint').textContent='FIRST PERSON · WASD MOVE · MOUSE LOOK · E INTERACT · F ATTACK · I BACKPACK';
    if(!worldRuntimeViewModel){
        worldRuntimeViewModel=new THREE.Group();
        const sleeve=new THREE.MeshStandardMaterial({color:0x315c70,roughness:.9}),sleeveTrim=new THREE.MeshStandardMaterial({color:0xc7a45f,metalness:.2,roughness:.65}),skin=new THREE.MeshStandardMaterial({color:0xc98e6c,roughness:.92}),leather=new THREE.MeshStandardMaterial({color:0x4b3025,roughness:.78}),metalBlade=new THREE.MeshStandardMaterial({color:0xaec5d2,metalness:.82,roughness:.22});
        const make=(geometry,material,x,y,z,scale=[1,1,1],rotation=[0,0,0])=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.scale.set(...scale);mesh.rotation.set(...rotation);mesh.renderOrder=10;mesh.frustumCulled=false;worldRuntimeViewModel.add(mesh);return mesh;};
        for(const side of [-1,1]){
            const arm=make(new THREE.CylinderGeometry(.12,.15,.62,14),sleeve,side*.43,-.39,-.64,[1,1,1],[0,0,side*-.22]);
            make(new THREE.CylinderGeometry(.155,.14,.16,14),sleeveTrim,side*.43,-.68,-.73,[1,1,1],[0,0,side*-.22]);
            make(new THREE.SphereGeometry(.145,18,14),skin,side*.45,-.79,-.82,[1,.78,1]);
            for(let finger=0;finger<4;finger++)make(new THREE.CylinderGeometry(.025,.03,.12,8),skin,side*.45+(finger-1.5)*.055,-.88,-.91,[1,1,1],[0,0,side*.08]);
        }
        make(new THREE.CylinderGeometry(.055,.07,.72,12),leather,.59,-.55,-.97,[1,1,1],[0,0,-.5]);
        make(new THREE.BoxGeometry(.19,.16,.11),sleeveTrim,.59,-.9,-.97);
        make(new THREE.BoxGeometry(.115,.48,.045),metalBlade,.77,-.2,-1.05,[1,1,1],[0,0,-.5]);
        make(new THREE.BoxGeometry(.16,.09,.12),sleeveTrim,.76,-.47,-1.04,[1,1,1],[0,0,-.5]);
        worldRuntimeViewModel.traverse(o=>{o.renderOrder=10;o.frustumCulled=false;});C.add(worldRuntimeViewModel);
    }
    worldRuntimeViewModel.visible=true;updateWorldRuntimeHUD();worldRuntimeFormatInventory();save();toast(`${gameMode.name} loaded. Walk to the helm and click SAIL THE SHIP to take the wheel.`);
}

function stopWorldSession(){
    if(!worldSessionActive)return;worldRuntimeSave.health=worldRuntimePlayerHealth;worldRuntimeSave.ship={x:P.position.x,z:P.position.z,heading:worldRuntimeShipHeading};save();
    base=1.6;surge=0;
    worldSessionActive=false;worldRuntimeSailingMode=false;worldRuntimeWorld.visible=false;worldRuntimeDeck.visible=false;worldRuntimePlayer.visible=false;worldRuntimeViewModel&&(worldRuntimeViewModel.visible=false);P.position.set(0,0,0);P.rotation.set(0,0,0);
    worldRuntimeInventoryOpen=false;worldRuntimeChestOpen=false;worldRuntimeActiveChest=null;worldRuntimeActiveMerchant=null;$('worldRuntimeHud').hidden=true;$('worldRuntimeInventoryPanel').hidden=true;$('worldRuntimeChestPanel').hidden=true;$('worldRuntimeMerchantPanel').hidden=true;$('worldRuntimeSailButton').hidden=true;$('card').style.display='flex';$('modePill').textContent='MENU';$('pauseButton').disabled=false;$('gameHint').textContent='CLICK GAME TO LOCK MOUSE · PAUSE WITH THE Ⅱ BUTTON';document.exitPointerLock?.();
    activeSessionMods.forEach(record=>executeSclEvent(record,'onGameUnload',{session:true}));activeSessionMods=[];modSessionActive=false;toast('World saved. Returning to Aquavoid menu.');
}
$('worldRuntimeExitButton').addEventListener('click',stopWorldSession);
$('worldRuntimeInventoryButton').addEventListener('click',worldRuntimeOpenInventory);
$('worldRuntimeInteractButton').addEventListener('click',worldRuntimeInteract);
$('worldRuntimeSailButton').addEventListener('click',()=>{if(worldRuntimeSailingMode)worldRuntimeInteract();else worldRuntimeEnterSailing();});
$('worldRuntimeCameraButton').addEventListener('click',worldRuntimeToggleSailingCamera);
$('worldRuntimeAttackButton').addEventListener('click',worldRuntimeAttack);
$('worldRuntimeInventoryClose').addEventListener('click',worldRuntimeCloseInventory);
$('worldRuntimeCraftAxe').addEventListener('click',()=>worldRuntimeCraft('axe'));
$('worldRuntimeCraftPickaxe').addEventListener('click',()=>worldRuntimeCraft('pickaxe'));
$('worldRuntimeCraftPlanks').addEventListener('click',()=>worldRuntimeCraft('planks'));
$('worldRuntimeCraftRope').addEventListener('click',()=>worldRuntimeCraft('rope'));
$('worldRuntimeCraftChest').addEventListener('click',()=>worldRuntimeCraft('chest'));
$('worldRuntimePlaceChest').addEventListener('click',worldRuntimePlaceChest);
$('worldRuntimeChestStore').addEventListener('click',worldRuntimeChestStore);
$('worldRuntimeChestTake').addEventListener('click',worldRuntimeChestTake);
$('worldRuntimeChestClose').addEventListener('click',worldRuntimeCloseChest);
$('worldRuntimeMerchantClose').addEventListener('click',worldRuntimeCloseMerchant);

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
        const islandSailBoost = 1;
        vx += (ix * c + iz * s) * 50 * dt * tidalThrust * islandSailBoost;
        vz += (-ix * s + iz * c) * 50 * dt * tidalThrust * islandSailBoost;
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
    if (!run && !paused && !worldSessionActive) {
        guardianDrones.forEach(drone => { drone.visible = false; });
        hd += dt * .5;
        p.y = h(p.x, p.z, t) + .6;
        P.rotation.set(0, hd, 0)
    }
    if (worldSessionActive) updateWorldRuntimeMovement(dt);
    parts(dt);
    updateModRays(dt);
    updateModRadar();
    if (window.stars?.material?.color) {
        const theme = modFlag('waveThemes') ? getModSetting('wave-themes', 'theme', 'default') : 'default';
        window.stars.material.color.setHex(theme === 'galaxy' ? 0xc6a7ff : theme === 'aurora' ? 0xa7f5df : theme === 'bathhouse' ? 0xd9e3c5 : 0xe8f4ef);
    }
    const oceanFocus = worldSessionActive ? (worldRuntimeSailingMode ? P.position : worldRuntimePlayerPosition) : p;
    grid2(t, oceanFocus.x, oceanFocus.z);
    mesh.scale.set(worldSessionActive ? 18 : 1, 1, worldSessionActive ? 18 : 1);
    spd += (Math.hypot(vx, vz) - spd) * .1;
    C.fov = THREE.MathUtils.clamp(60 + spd * .9, 60, 84);
    C.updateProjectionMatrix();
    const sh = shake;
    shake = Math.max(0, shake - dt * 1.5);
    const cd = 15
      , ch = Math.cos(pitch) * cd;
    if (worldSessionActive && worldRuntimeSailingMode) {
        if(worldRuntimeSailingFirstPerson){
            const eye=P.localToWorld(new THREE.Vector3(0,2.55,1.72)),aim=P.localToWorld(new THREE.Vector3(0,2.35,-10));
            C.position.copy(eye);C.lookAt(aim);C.fov=84;
        }else{
            const cameraLocal=new THREE.Vector3(0,5.8,12.5),lookLocal=new THREE.Vector3(0,2.3,-6.8);
            C.position.copy(P.localToWorld(cameraLocal));const lookTarget=P.localToWorld(lookLocal);C.lookAt(lookTarget);C.fov=70;
        }
        C.updateProjectionMatrix();if(worldRuntimeViewModel)worldRuntimeViewModel.visible=false;
    } else if (worldSessionActive) {
        const moving=Math.hypot(worldRuntimeVelocity.x,worldRuntimeVelocity.z),bob=Math.sin(worldRuntimeStepClock*1.2)*Math.min(.028,moving*.0025);
        const cp=Math.cos(worldRuntimePitch),direction=new THREE.Vector3(-Math.sin(worldRuntimeYaw)*cp,Math.sin(worldRuntimePitch),-Math.cos(worldRuntimeYaw)*cp);
        if(worldRuntimeModeDefinition?.camera?.onFoot==='thirdPerson'){
            const focus=new THREE.Vector3(worldRuntimePlayerPosition.x,worldRuntimePlayerPosition.y+1.25,worldRuntimePlayerPosition.z);
            const offset=new THREE.Vector3(Math.sin(worldRuntimeYaw)*5.2,2.4,Math.cos(worldRuntimeYaw)*5.2);
            C.position.copy(focus).add(offset);C.lookAt(focus);C.fov=68;if(worldRuntimeViewModel)worldRuntimeViewModel.visible=false;
        }else{
            C.position.set(worldRuntimePlayerPosition.x,worldRuntimePlayerPosition.y+1.64+bob,worldRuntimePlayerPosition.z);
            C.lookAt(C.position.clone().add(direction));C.fov=78;if(worldRuntimeViewModel)worldRuntimeViewModel.visible=true;
        }
        C.near=.08;C.far=1800;C.updateProjectionMatrix();
    } else {
        C.position.set(p.x + Math.sin(yaw) * ch + (Math.random() - .5) * sh, p.y + Math.sin(pitch) * cd + (Math.random() - .5) * sh, p.z + Math.cos(yaw) * ch);
        C.position.y = Math.max(C.position.y, h(C.position.x, C.position.z, t) + 2);
        C.lookAt(p.x, p.y, p.z);
    }
    stars.position.set(p.x, 0, p.z);
    renderGameWithShaderPipeline(dt);
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
    for (const id of ['pauseScreen', 'lv', 'shop', 'wp', 'lb', 'islands']) $(id).style.display = 'none';
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
    if (name !== 'play' && worldSessionActive) stopWorldSession();
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
    // Never write defaults while the initial Firestore read is still pending or
    // has failed. The save is enabled only after the existing cloud document
    // was loaded successfully (or confirmed not to exist).
    if (!window.AQUAVOID_BOOT?.cloudReady) return Promise.resolve(false);
    if(worldSessionActive){worldRuntimeSave.health=worldRuntimePlayerHealth;worldRuntimeSave.ship={x:P.position.x,z:P.position.z,heading:worldRuntimeShipHeading};}
    const data = {
        coins,
        owned: owned.filter(index => Number.isInteger(index) && index >= 0 && index < SKINS.length),
        // Mod-contributed cosmetics are client preferences; Aquavoid saves only its native ship index.
        sel: aquavoidSelectedShip,
        unlocked,
        bestWave,
        wown,
        wsel,
        bestScore: best,
        name: playerName,
        nameSet,
        survival: worldRuntimeSave
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
    worldRuntimeSave = normalizeWorldRuntimeSave(raw?.survival || worldRuntimeSave);

    // Mod-contributed vehicle skins are data, not client-specific branches.
    selectedModShipSkinId=String(window.SCLIENT_BOOT?.clientPrefs?.selectedModShipSkinId||'');
    const restoredSkin=availableShips().findIndex(skin=>skin.modSkinId===selectedModShipSkinId);
    sel=restoredSkin>=SKINS.length?restoredSkin:aquavoidSelectedShip;
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
const SUPPORTED_FEATURES = new Set(['freezeTimer','crystalMagnet','noDashCooldown','superJump','auroraWake','waveThemes','tidalEngine','guardianDrones','treasureRadar','comboReactor']);
const SUPPORTED_ACTIONS = new Set(['collectCrystal','refillTimer','addCoins','setCoins','addScore','unlockShips','stormStrike']);
let activeModId = null;
let currentModsSubpage = 'library';

function modFlag(featureId) {
    return modSessionActive && activeSessionMods.some(mod => mod.enabled && mod.featureStates && mod.featureStates[featureId] === true);
}
function configuredModFlag(featureId) {
    return installedMods.some(mod => mod.enabled && mod.featureStates && mod.featureStates[featureId] === true);
}
function getModSetting(modId, settingId, fallback) {
    const pool = modSessionActive ? activeSessionMods : [];
    const record = pool.find(mod => mod.manifest?.id === modId && mod.enabled);
    const value = record?.settings?.[settingId];
    return value === undefined || value === null ? fallback : value;
}
function loadEnabledModsForAquavoid(onReady) {
    if (modSessionLoadPromise) return modSessionLoadPromise;
    const overlay = $('modLoadingScreen');
    const title = $('modLoadingTitle'), message = $('modLoadingMessage');
    const progress = $('modLoadingProgress'), stepLabel = $('modLoadingStep'), percent = $('modLoadingPercent');
    const phases = [
        ['Reading enabled mod profiles…', 'Checking SCL manifests and permissions'],
        ['Preparing game capabilities…', 'Resolving renderer, world, input and storage services'],
        ['Applying mod configuration…', 'Applying enabled features and saved settings'],
        ['Building Aquavoid session…', 'Preparing the world and handing control to the game']
    ];
    if (overlay) overlay.hidden = false;
    if (title) title.textContent = 'Preparing your world';
    let phase = 0;
    const paint = () => {
        const value = Math.round((phase / phases.length) * 100);
        if (message) message.textContent = phases[Math.min(phase, phases.length - 1)][0] + ' ' + phases[Math.min(phase, phases.length - 1)][1] + '.';
        if (progress) progress.style.width = `${value}%`;
        if (stepLabel) stepLabel.textContent = `${Math.min(phase + 1, phases.length)} / ${phases.length}`;
        if (percent) percent.textContent = `${value}%`;
    };
    modSessionLoadPromise = new Promise(resolve => {
        const tick = () => {
            if (phase === 0) {
                if(modSessionActive)activeSessionMods.forEach(record=>executeSclEvent(record,'onGameUnload',{session:true}));
                activeSessionMods = installedMods.filter(record => record.enabled && !record.incompatible).map(record => ({...record, featureStates:{...(record.featureStates || {})}, settings:{...(record.settings || {})}, state:{...(record.state || {})}}));
                modSessionActive = true;
            }
            if (phase === 2) {
                activeSessionMods.forEach(record => {
                    // onEnable is emitted only when the user changes a mod from
                    // disabled to enabled; starting a game is a separate event.
                    executeSclEvent(record, 'onGameLoad', {session:true});
                });
                applyShaderPipeline();
                refreshModShipSkins();
            }
            paint();
            phase += 1;
            if (phase <= phases.length) {
                window.setTimeout(tick, 170);
                return;
            }
            if (progress) progress.style.width = '100%';
            if (stepLabel) stepLabel.textContent = `${phases.length} / ${phases.length}`;
            if (percent) percent.textContent = '100%';
            window.setTimeout(() => {
                if (overlay) overlay.hidden = true;
                modSessionLoadPromise = null;
                refreshIslandEntry();
                try { if (typeof onReady === 'function') onReady(); } finally { resolve(true); }
            }, 140);
        };
        paint();
        requestAnimationFrame(tick);
    });
    return modSessionLoadPromise;
}
function cloneEnabledModRecords() {
    return installedMods.filter(record => record.enabled && !record.incompatible).map(record => ({
        ...record,
        featureStates:{...(record.featureStates || {})},
        settings:{...(record.settings || {})},
        state:{...(record.state || {})}
    }));
}
function externalModPayload() {
    return activeSessionMods.map(record => ({
        id:record.manifest.id,
        name:record.manifest.name,
        enabled:!!record.enabled,
        gameVersions:[...(record.manifest.gameVersions || [])],
        featureStates:{...(record.featureStates || {})},
        settings:{...(record.settings || {})},
        vehicleSkins:(record.manifest.vehicleSkins || []).map(skin => ({...skin})),
        permissions:[...(record.manifest.permissions || [])]
    }));
}
function postExternalModState() {
    if (!externalGameWindow) return;
    try {
        externalGameWindow.postMessage({
            type:'sclient:mods:update',
            instanceId:externalGameInstanceId,
            mods:externalModPayload()
        }, location.origin);
    } catch (error) { console.warn('Could not send the mod profile to the game frame:', error); }
}
function syncExternalGameMods() {
    // The Mods tab can browse a different instance while another game is
    // running. Never send that browsing profile into the active game's iframe.
    if (!externalGameWindow || currentModInstanceId !== externalGameInstanceId) return;
    const previous = activeSessionMods;
    const next = cloneEnabledModRecords();
    const previousIds = new Set(previous.map(record => record.manifest.id));
    const nextIds = new Set(next.map(record => record.manifest.id));
    previous.filter(record => !nextIds.has(record.manifest.id)).forEach(record => executeSclEvent(record, 'onGameUnload', {session:true}));
    next.filter(record => !previousIds.has(record.manifest.id)).forEach(record => executeSclEvent(record, 'onGameLoad', {session:true}));
    activeSessionMods = next;
    modSessionActive = true;
    postExternalModState();
}
window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== externalGameWindow) return;
    if (event.data?.type === 'sclient:mods:ready') postExternalModState();
});
function dispatchAquavoidAction(action, value = 0) {
    if (!SUPPORTED_ACTIONS.has(action)) { toast('Action not supported.'); return false; }
    if (externalGameWindow) {
        if (currentModInstanceId !== externalGameInstanceId) {
            toast('Select the running game instance to use its mod actions.');
            return false;
        }
        try {
            externalGameWindow.postMessage({type:'sclient:mods:action', instanceId:externalGameInstanceId, action, value:Number(value) || 0}, location.origin);
            return true;
        } catch (error) { console.warn('Could not send mod action to the game frame:', error); }
    }
    runModAction({action, value:Number(value) || 0});
    return true;
}

function saveMods() {
    const snapshot = installedMods.map(record => ({
        manifest: record.manifest,
        enabled: !!record.enabled,
        featureStates: { ...(record.featureStates || {}) },
        settings: { ...(record.settings || {}) },
        state: { ...(record.state || {}) }
    }));
    if (!currentModInstanceId) return Promise.resolve(false);
    return window.SClientCloud.saveInstanceMods(currentModInstanceId, { installed: snapshot }).catch(error => {
        console.error('S-Client mod sync failed:', error);
        toast('Could not sync your mods to Firestore. Check your connection.');
        return false;
    });
}
// SCL (S-Client Language) is a small, declarative, event-driven language with bounded conditional flow.
// It is interpreted by this client; uploaded files never run JavaScript or eval().
const SCL_VERSION = 1;
const SCL_PERMISSIONS = new Set(['ui.toast','rendering.shaderPacks','eyesight.presets','aquavoid.features','aquavoid.actions','aquavoid.worlds','vehicles.shipSkins','input.cursorUnlock']);
const SCL_APIS = new Set(['ui.toast','rendering.selectShaderPack','rendering.resetShaderPack','aquavoid.action']);
const SCL_EVENTS = ['onInstall','onEnable','onDisable','onSettingChange','onFeatureChange','onGameLoad','onGameUnload','onWorldEnter'];
const SCL_CONTROL_TYPES = new Set(['text','button','toggle','select','slider','shaderPicker']);
// Prevent a handler from recursively dispatching itself when its own commands
// update the same setting or feature that triggered the handler.
const sclEventInFlight = new WeakMap();
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
    if (type === 'button' && !result.onClick.length) throw new Error(`controls[${index}] button needs an onClick SCL handler.`);
    if (type === 'slider' && (result.max <= result.min || result.max - result.min > 1000000)) throw new Error(`controls[${index}] has an invalid slider range.`);
    if (['toggle','select','slider'].includes(type) && !/^[a-zA-Z0-9_-]{1,40}$/.test(result.setting)) throw new Error(`controls[${index}] must reference a declared setting.`);
    if (type === 'shaderPicker' && !result.onChange.length) throw new Error(`controls[${index}] shaderPicker needs an onChange SCL handler.`);
    return result;
}
function normalizeWorldSpecies(monster, monsterIndex, label='world') {
    const species = {
        id:String(monster.id || `creature-${monsterIndex + 1}`),
        name:String(monster.name || monster.id || 'Creature').slice(0,48),
        health:clamp(Math.floor(Number(monster.health) || 40),10,500),
        speed:clamp(Number(monster.speed) || 2,0.3,8),
        damage:clamp(Math.floor(Number(monster.damage) || 6),1,40),
        aggroRange:clamp(Number(monster.aggroRange) || 13,4,50),
        attackRange:clamp(Number(monster.attackRange) || 1.8,.8,4),
        color:/^#[0-9a-f]{6}$/i.test(String(monster.color || '')) ? String(monster.color) : '#558b83'
    };
    if (!/^[a-z0-9._-]{2,48}$/i.test(species.id)) throw new Error(`${label} has an invalid creature ID.`);
    return species;
}
function normalizeWorldMerchant(merchant, index, islandId, label='merchant') {
    if (!merchant || typeof merchant !== 'object' || Array.isArray(merchant)) throw new Error(`${label} ${index + 1} is invalid.`);
    const id=String(merchant.id||`trader-${index+1}`);
    if(!isSafeSclKey(id,48))throw new Error(`${label} ${index+1} has an invalid ID.`);
    const wares=Array.isArray(merchant.wares)?merchant.wares.slice(0,16).map((ware,wareIndex)=>{
        if(!ware||typeof ware!=='object'||Array.isArray(ware))throw new Error(`${label} ${id} has an invalid ware.`);
        const wareId=String(ware.id||`ware-${wareIndex+1}`),kind=String(ware.kind||'resource');
        if(!isSafeSclKey(wareId,48)||!['resource','tool','gear'].includes(kind))throw new Error(`${label} ${id} has an unsupported ware.`);
        const normalized={id:wareId,name:String(ware.name||wareId).slice(0,60),description:String(ware.description||'').slice(0,140),icon:String(ware.icon||'📦').slice(0,4),price:clamp(Math.floor(Number(ware.price)||1),1,1000000),kind,quantity:clamp(Math.floor(Number(ware.quantity)||1),1,100)};
        if(kind==='resource'){
            const resource=String(ware.resource||'');
            if(!WORLD_RESOURCE_KEYS.includes(resource))throw new Error(`${label} ${id} sells an unsupported resource.`);
            normalized.resource=resource;
        } else if(kind==='tool'){
            const tool=String(ware.tool||'');
            if(!['axe','pickaxe'].includes(tool))throw new Error(`${label} ${id} sells an unsupported tool.`);
            normalized.tool=tool;
        } else {
            normalized.effects={};
            const allowedEffects=['maxHealth','attackDamage','moveSpeed','shipSpeed','jumpHeight'];
            for(const key of allowedEffects){if(Number.isFinite(Number(ware.effects?.[key]))&&Number(ware.effects[key])!==0)normalized.effects[key]=clamp(Number(ware.effects[key]),-50,100);}
        }
        return normalized;
    }):[];
    if(!wares.length)throw new Error(`${label} ${id} must have at least one ware.`);
    return {id,name:String(merchant.name||id).slice(0,60),greeting:String(merchant.greeting||'Welcome, traveller.').slice(0,180),x:clamp(Number(merchant.x)||0,-40,40),z:clamp(Number(merchant.z)||0,-40,40),coatColor:/^#[0-9a-f]{6}$/i.test(String(merchant.coatColor||''))?String(merchant.coatColor):'#34465c',skinColor:/^#[0-9a-f]{6}$/i.test(String(merchant.skinColor||''))?String(merchant.skinColor):'#d49a76',style:String(merchant.style||'trader').slice(0,20),wares};
}
function normalizeWorldIsland(island, islandIndex, label='island') {
    if (!island || typeof island !== 'object' || Array.isArray(island)) throw new Error(`${label} ${islandIndex + 1} is invalid.`);
    const islandId = String(island.id || `island-${islandIndex + 1}`);
    if(!isSafeSclKey(islandId,48))throw new Error(`${label} ${islandIndex + 1} has an invalid ID.`);
    const radius=clamp(Number(island.radius)||12,6,42);
    const resourceSource=island.resources&&typeof island.resources==='object'?island.resources:{};
    const resources=Object.fromEntries(WORLD_RESOURCE_KEYS.slice(0,4).map(key=>[key,clamp(Math.floor(Number(resourceSource[key])||0),0,20)]));
    const monsters=Array.isArray(island.monsters)?island.monsters.slice(0,8).map(spawn=>({species:String(spawn.species||''),count:clamp(Math.floor(Number(spawn.count)||1),0,6)})).filter(spawn=>/^[a-z0-9._-]{2,48}$/i.test(spawn.species)&&spawn.count>0):[];
    const merchants=Array.isArray(island.merchants)?island.merchants.slice(0,4).map((merchant,index)=>normalizeWorldMerchant(merchant,index,islandId,`${label} ${islandId} merchant`)):[];
    return {id:islandId,name:String(island.name||islandId).slice(0,50),x:clamp(Number(island.x)||0,-1500,1500),z:clamp(Number(island.z)||0,-1500,1500),radius,biome:String(island.biome||'tropical').slice(0,24),resources,monsters,merchants,cache:island.cache!==false};
}
function normalizeWorldExtension(extension,index,hasWorldPermission){
    if(!extension||typeof extension!=='object'||Array.isArray(extension))throw new Error(`worldExtensions[${index}] is invalid.`);
    if(!hasWorldPermission)throw new Error(`worldExtensions[${index}] requires the aquavoid.worlds permission.`);
    const targetTags=Array.isArray(extension.targetTags)?[...new Set(extension.targetTags.map(tag=>String(tag).slice(0,40)).filter(tag=>/^[a-z0-9._-]{2,40}$/i.test(tag)))].slice(0,12):[];
    if(!targetTags.length)throw new Error(`worldExtensions[${index}] needs at least one target tag.`);
    const islands=Array.isArray(extension.islands)?extension.islands.slice(0,16).map((island,i)=>normalizeWorldIsland(island,i,`worldExtensions[${index}] island`)):[];
    const monsterSpecies=Array.isArray(extension.monsterSpecies)?extension.monsterSpecies.slice(0,12).map((monster,i)=>normalizeWorldSpecies(monster,i,`worldExtensions[${index}] creature`)):[];
    return {targetTags,islands,monsterSpecies};
}
function normalizeGameMode(mode, index, hasWorldPermission) {
    if (!mode || typeof mode !== 'object' || Array.isArray(mode)) throw new Error(`gameModes[${index}] is invalid.`);
    const id=String(mode.id||`mode-${index+1}`),type=String(mode.type||'');
    if(!isSafeSclKey(id,48)||!['openWorldSurvival'].includes(type))throw new Error(`gameModes[${index}] has an unsupported ID or mode type.`);
    const rawWorld=mode.world&&typeof mode.world==='object'?mode.world:{};
    const islands=Array.isArray(rawWorld.islands)?rawWorld.islands.slice(0,32).map((island,i)=>normalizeWorldIsland(island,i,`gameModes[${index}] island`)):[];
    const species=Array.isArray(rawWorld.monsterSpecies)?rawWorld.monsterSpecies.slice(0,16).map((monster,i)=>normalizeWorldSpecies(monster,i,`gameModes[${index}] creature`)):[];
    const speciesIds=new Set(species.map(monster=>monster.id));
    islands.forEach(island=>island.monsters=island.monsters.filter(spawn=>speciesIds.has(spawn.species)));
    const generationSource=rawWorld.generation&&typeof rawWorld.generation==='object'?rawWorld.generation:{};
    const generation={enabled:generationSource.enabled===true,islandCount:clamp(Math.floor(Number(generationSource.islandCount)||0),0,40),minDistance:clamp(Number(generationSource.minDistance)||140,80,800),maxDistance:clamp(Number(generationSource.maxDistance)||1000,120,1450),minSize:clamp(Number(generationSource.minSize)||7,6,24),maxSize:clamp(Number(generationSource.maxSize)||28,8,42),monsterChance:clamp(Number(generationSource.monsterChance)||.5,0,1)};
    if(generation.maxDistance<generation.minDistance)generation.maxDistance=generation.minDistance+100;
    if(!islands.length&&!generation.enabled)throw new Error(`gameModes[${index}] needs at least one island or procedural island generation.`);
    if(!hasWorldPermission)throw new Error(`gameModes[${index}] requires the aquavoid.worlds permission.`);
    const tags=Array.isArray(rawWorld.tags)?[...new Set(rawWorld.tags.map(tag=>String(tag).slice(0,40)).filter(tag=>/^[a-z0-9._-]{2,40}$/i.test(tag)))].slice(0,12):[];
    const ship=rawWorld.ship&&typeof rawWorld.ship==='object'?rawWorld.ship:{};
    const cameraSource=mode.camera&&typeof mode.camera==='object'?mode.camera:{};
    const camera={onFoot:['firstPerson','thirdPerson'].includes(cameraSource.onFoot)?cameraSource.onFoot:'firstPerson',onWheel:['firstPerson','thirdPerson'].includes(cameraSource.onWheel)?cameraSource.onWheel:'thirdPerson',allowSailingFirstPerson:cameraSource.allowSailingFirstPerson!==false,toggleKey:['KeyV','KeyC','KeyB'].includes(cameraSource.toggleKey)?cameraSource.toggleKey:'KeyV'};
    const vehicleSource=mode.vehicle&&typeof mode.vehicle==='object'?mode.vehicle:{};
    const vehicle={type:String(vehicleSource.type||'sailboat').slice(0,24),canDisembark:vehicleSource.canDisembark!==false,helmDistance:clamp(Number(vehicleSource.helmDistance)||3.2,1.2,8),shoreDistance:clamp(Number(vehicleSource.shoreDistance)||20,5,45)};
    return {id,type,name:String(mode.name||id).slice(0,60),description:String(mode.description||'').slice(0,180),icon:String(mode.icon||'🌍').slice(0,4),feature:isSafeSclKey(mode.feature||'',50)?String(mode.feature||''):'',camera,vehicle,world:{seed:clamp(Math.floor(Number(rawWorld.seed)||8128),1,2147483647),worldRadius:clamp(Number(rawWorld.worldRadius)||1200,200,1500),tags,generation,islands,monsterSpecies:species,ship:{spawnX:clamp(Number(ship.spawnX)||0,-1500,1500),spawnZ:clamp(Number(ship.spawnZ)||0,-1500,1500),heading:clamp(Number(ship.heading)||0,-Math.PI,Math.PI)}}};
}
function composeGameModeWithExtensions(gameMode){
    const composed={...gameMode,world:{...gameMode.world,islands:[...(gameMode.world.islands||[])],monsterSpecies:[...(gameMode.world.monsterSpecies||[])]}};
    const tags=new Set(composed.world.tags||[]),islandIds=new Set(composed.world.islands.map(item=>item.id)),speciesIds=new Set(composed.world.monsterSpecies.map(item=>item.id));
    for(const record of (activeSessionMods||[]).filter(item=>item.enabled)){
        for(const extension of record.manifest?.worldExtensions||[]){
            if(!extension.targetTags.some(tag=>tags.has(tag)))continue;
            extension.monsterSpecies.forEach(species=>{if(!speciesIds.has(species.id)){speciesIds.add(species.id);composed.world.monsterSpecies.push(species);}});
            extension.islands.forEach(island=>{if(!islandIds.has(island.id)){islandIds.add(island.id);composed.world.islands.push(island);}});
        }
    }
    const validSpecies=new Set(composed.world.monsterSpecies.map(item=>item.id));
    composed.world.islands.forEach(island=>island.monsters=island.monsters.filter(spawn=>validSpecies.has(spawn.species)));
    return composed;
}

function normalizeVehicleSkin(raw,index,hasPermission){
    if(!hasPermission)throw new Error(`vehicleSkins[${index}] requires vehicles.shipSkins permission.`);
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(`vehicleSkins[${index}] is invalid.`);
    const id=String(raw.id||'');if(!isSafeSclKey(id,48))throw new Error(`vehicleSkins[${index}] has an invalid ID.`);
    const color=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(String(value||''))?String(value):fallback;
    const style=['sloop','catamaran','trimaran','ironclad'].includes(String(raw.style||'sloop'))?String(raw.style||'sloop'):'sloop';
    return {id,name:String(raw.name||id).slice(0,48),description:String(raw.description||'').slice(0,120),icon:String(raw.icon||'⛵').slice(0,4),style,hullColor:color(raw.hullColor,'#805232'),sailColor:color(raw.sailColor,'#f6efe0'),flagColor:color(raw.flagColor,'#ff6b8a'),glowColor:color(raw.glowColor,'#b6e2ee'),accentColor:color(raw.accentColor,'#d9b45a'),logo:/^data:image\/png;base64,[A-Za-z0-9+\/=]{1,60000}$/.test(String(raw.logo||''))?String(raw.logo):''};
}
// Mods must declare which Aquavoid version(s) they were written for. Only versions listed here can be installed.
const SUPPORTED_GAME_VERSIONS = ['1.0', '1.01'];
function readGameVersions(raw) {
    const list = Array.isArray(raw.gameVersions) ? raw.gameVersions : (raw.gameVersion !== undefined && raw.gameVersion !== null && raw.gameVersion !== '' ? [raw.gameVersion] : []);
    return [...new Set(list.map(v => String(v).trim()).filter(Boolean))].slice(0,10);
}
function normalizeManifest(raw, targetVersion = currentModInstanceVersion) {
    if (!raw || raw.format !== 'sclient-mod') throw new Error('This is not an S-Client mod.');
    if (JSON.stringify(raw).length > 200000) throw new Error('A .sclient mod must be smaller than 200 KB.');
    const formatVersion = Number(raw.formatVersion);
    if (![1,2].includes(formatVersion)) throw new Error('Unsupported .sclient format version. Supported versions are 1 and 2 (SCL).');
    if (!['aquavoid','swell'].includes(String(raw.game || '').toLowerCase())) throw new Error('This mod is not made for Aquavoid.');
    const gameVersions = readGameVersions(raw);
    if (!gameVersions.length) throw new Error(`Missing "gameVersion". Add the Aquavoid version this mod is made for (supported: ${SUPPORTED_GAME_VERSIONS.join(', ')}), e.g. "gameVersion": "1.0".`);
    const compatibleVersions = gameVersions.filter(v => SUPPORTED_GAME_VERSIONS.includes(v));
    if (!compatibleVersions.length) throw new Error(`Not compatible: this mod is made for Aquavoid ${gameVersions.join(', ')}, but only ${SUPPORTED_GAME_VERSIONS.join(', ')} is supported.`);
    if (targetVersion && !compatibleVersions.includes(String(targetVersion))) throw new Error(`Not compatible with this instance: this mod supports Aquavoid ${compatibleVersions.join(', ')}, but the selected instance is Aquavoid ${targetVersion}.`);
    const id = String(raw.id || '').trim(), name = String(raw.name || '').trim();
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(id) || !name || name.length > 70) throw new Error('The mod ID or name is invalid.');
    const features = Array.isArray(raw.features) ? raw.features.slice(0,30).map(f => ({id:String(f.id || ''), name:String(f.name || f.id || 'Feature').slice(0,60), description:String(f.description || '').slice(0,150), defaultEnabled:!!f.defaultEnabled})).filter(f => isSafeSclKey(f.id, 50) && (formatVersion === 2 || SUPPORTED_FEATURES.has(f.id))) : [];
    const actions = Array.isArray(raw.actions) ? raw.actions.slice(0,30).map(a => ({id:String(a.id || ''), label:String(a.label || a.id || 'Action').slice(0,60), action:String(a.action || ''), value:Number.isFinite(Number(a.value)) ? Number(a.value) : undefined})).filter(a => /^[a-zA-Z0-9_-]{1,50}$/.test(a.id) && SUPPORTED_ACTIONS.has(a.action)) : [];
    const settings = Array.isArray(raw.settings) ? raw.settings.slice(0,30).map(normalizeSetting).filter(Boolean) : [];
    const settingIds = new Set(settings.map(item => item.id));
    const permissions = formatVersion === 2 ? (Array.isArray(raw.permissions) ? [...new Set(raw.permissions.map(String))] : []) : [];
    if (permissions.some(permission => !SCL_PERMISSIONS.has(permission))) throw new Error('This mod requests an unknown SCL permission.');
    const rawGameModes = formatVersion === 2 && Array.isArray(raw.gameModes) ? raw.gameModes.slice(0,8) : [];
    const gameModes = rawGameModes.map((mode,index) => normalizeGameMode(mode,index,permissions.includes('aquavoid.worlds')));
    const rawWorldExtensions = formatVersion === 2 && Array.isArray(raw.worldExtensions) ? raw.worldExtensions.slice(0,12) : [];
    const worldExtensions = rawWorldExtensions.map((extension,index)=>normalizeWorldExtension(extension,index,permissions.includes('aquavoid.worlds')));
    const vehicleSkins = formatVersion===2&&Array.isArray(raw.vehicleSkins)?raw.vehicleSkins.slice(0,8).map((skin,index)=>normalizeVehicleSkin(skin,index,permissions.includes('vehicles.shipSkins'))):[];
    gameModes.forEach(mode=>{if(mode.feature&&!features.some(feature=>feature.id===mode.feature))throw new Error(`gameModes entry ${mode.id} references undeclared feature ${mode.feature}.`);});
    const controls = formatVersion === 2 ? (Array.isArray(raw.controls) ? raw.controls.slice(0,30).map(normalizeSclControl) : []) : [];
    controls.forEach(control => {
        if (control.setting && !settingIds.has(control.setting)) throw new Error(`Control "${control.id}" references missing setting "${control.setting}".`);
        const setting = settings.find(item => item.id === control.setting);
        if (control.type === 'toggle' && setting?.type !== 'toggle') throw new Error(`Control "${control.id}" requires a toggle setting.`);
        if (control.type === 'select' && setting?.type !== 'select') throw new Error(`Control "${control.id}" requires a select setting.`);
        if (control.type === 'slider' && !['slider','number'].includes(setting?.type)) throw new Error(`Control "${control.id}" requires a slider or number setting.`);
        if (control.type === 'select' && setting?.type === 'select') control.options = setting.options;
        if (control.type === 'shaderPicker' && !(permissions.includes('rendering.shaderPacks') || permissions.includes('eyesight.presets'))) throw new Error('shaderPicker requires the rendering.shaderPacks permission.')
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
            if (statement.op === 'call' && ['rendering.selectShaderPack','rendering.resetShaderPack'].includes(statement.api) && !(permissions.includes('rendering.shaderPacks') || permissions.includes('eyesight.presets'))) throw new Error('Shader APIs require rendering.shaderPacks permission.');
        });
        allHandlers.forEach(validateStatementReferences);
    }
    const hasV2Behavior = controls.length || gameModes.length || worldExtensions.length || vehicleSkins.length || Object.values(program).some(commands => commands.length);
    if (!features.length && !actions.length && !hasV2Behavior) throw new Error('This mod contains no features, actions, controls, game modes or SCL handlers.');
    return {
        format:'sclient-mod', formatVersion, ...(formatVersion === 2 ? {language:'SCL',languageVersion:SCL_VERSION,permissions,controls,program,gameModes,worldExtensions,vehicleSkins} : {}),
        id, name, version:String(raw.version || '1.0.0').slice(0,24), author:String(raw.author || 'Unknown').slice(0,60),
        game:'aquavoid', gameVersions:compatibleVersions, description:String(raw.description || '').slice(0,220), icon:String(raw.icon || '◇').slice(0,4),
        features, actions, settings
    };
}
function waveThemesManifest(defaultTheme = 'default') {
    return {
        format:'sclient-mod', formatVersion:1, id:'wave-themes', name:'Wave Themes', version:'1.0.0', gameVersion:'1.0',
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
function upsertManifest(raw, targetVersion = currentModInstanceVersion) {
    // New imports of the retired Nebula Ocean mod are redirected into Wave Themes.
    if (raw && String(raw.id || '').toLowerCase() === 'nebula-ocean') raw = waveThemesManifest('galaxy');
    const manifest = normalizeManifest(raw, targetVersion);
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
    {id:'builtin-clearwater',name:'Clearwater',description:'Clean ocean color with a soft clarity pass and bright-water glints.',builtIn:true,settings:{brightness:1.04,contrast:1.04,saturation:1.12,hue:0,tint:'#8bd8dc',tintStrength:.025,vignette:.08,grain:0},passes:[{name:'Water clarity',uniforms:[{name:'uClarity',type:'float',value:.18}],fragmentShader:'uniform float uClarity; varying vec2 vUv; void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb; vec2 px=1.0/uResolution; vec3 n=texture2D(tDiffuse,vUv+vec2(0.0,px.y)).rgb; vec3 s=texture2D(tDiffuse,vUv-vec2(0.0,px.y)).rgb; vec3 e=texture2D(tDiffuse,vUv+vec2(px.x,0.0)).rgb; vec3 w=texture2D(tDiffuse,vUv-vec2(px.x,0.0)).rgb; vec3 detail=(c-(n+s+e+w)*0.25); gl_FragColor=vec4(clamp(c+detail*uClarity,0.0,1.0),1.0); }'}]},
    {id:'builtin-moonlit',name:'Moonlit',description:'Cool violet night tones, soft bloom and a cinematic edge.',builtIn:true,settings:{brightness:.98,contrast:1.12,saturation:1.22,hue:9,tint:'#7861bd',tintStrength:.12,vignette:.28,grain:.015},passes:[{name:'Moonlight glow',uniforms:[{name:'uGlow',type:'float',value:.24}],fragmentShader:'uniform float uGlow; varying vec2 vUv; void main(){ vec3 c=texture2D(tDiffuse,vUv).rgb; vec3 glow=vec3(0.0); vec2 px=1.0/uResolution; glow+=max(texture2D(tDiffuse,vUv+px*vec2(1.0,0.0)).rgb-vec3(.62),vec3(0.0)); glow+=max(texture2D(tDiffuse,vUv+px*vec2(-1.0,0.0)).rgb-vec3(.62),vec3(0.0)); glow+=max(texture2D(tDiffuse,vUv+px*vec2(0.0,1.0)).rgb-vec3(.62),vec3(0.0)); glow+=max(texture2D(tDiffuse,vUv+px*vec2(0.0,-1.0)).rgb-vec3(.62),vec3(0.0)); gl_FragColor=vec4(clamp(c+glow*uGlow*.25,0.0,1.0),1.0); }'}]},
    {id:'builtin-abyss',name:'Abyss',description:'Deep blue shadows, underwater distortion and crisp highlights.',builtIn:true,settings:{brightness:.9,contrast:1.2,saturation:1.18,hue:-9,tint:'#1e527c',tintStrength:.1,vignette:.38,grain:.02},passes:[{name:'Depth ripple',uniforms:[{name:'uRipple',type:'float',value:.0018}],fragmentShader:'uniform float uRipple; varying vec2 vUv; void main(){ vec2 uv=vUv; uv.x+=sin(uv.y*42.0+uTime*1.7)*uRipple; uv.y+=cos(uv.x*34.0-uTime*1.2)*uRipple*.7; vec3 c=texture2D(tDiffuse,uv).rgb; float depth=smoothstep(.15,.95,vUv.y); c=mix(c,c*vec3(.72,.9,1.16),depth*.16); gl_FragColor=vec4(c,1.0); }'}]}
];
let customShaderPacks = Array.isArray(window.SCLIENT_BOOT?.shaders?.customPacks) ? window.SCLIENT_BOOT.shaders.customPacks.map(pack=>{try{return normalizeShaderPack(pack);}catch(error){console.warn('Ignoring invalid saved Eyesight pack:',error);return null;}}).filter(Boolean) : [];
let activeShaderId = String(window.SCLIENT_BOOT?.shaders?.activePackId || '');
if (![...BUILTIN_SHADERS, ...customShaderPacks].some(pack => pack.id === activeShaderId)) activeShaderId = '';
function normalizeShaderPack(raw) {
    if (!raw || raw.format !== 'sclient-shaderpack' || ![1,2].includes(Number(raw.formatVersion))) throw new Error('This is not a supported .shadersclient pack.');
    const id=String(raw.id||'').trim(),name=String(raw.name||'').trim();
    if(!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(id)||!name||name.length>70)throw new Error('Shader pack ID or name is invalid.');
    const source=raw.settings||{};
    const hex=/^#[0-9a-f]{6}$/i.test(String(source.tint||''))?String(source.tint):'#6f7dbb';
    const number=(key,fallback,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(source[key]))?Number(source[key]):fallback));
    const passes=[];
    if(Number(raw.formatVersion)===2){
        if(!Array.isArray(raw.passes)||raw.passes.length<1||raw.passes.length>4)throw new Error('A v2 shader pack needs between 1 and 4 rendering passes.');
        let totalSource=0;
        raw.passes.forEach((pass,index)=>{
            if(!pass||typeof pass!=='object'||Array.isArray(pass))throw new Error(`Shader pass ${index+1} is invalid.`);
            const fragmentShader=String(pass.fragmentShader||'');
            const vertexShader=String(pass.vertexShader||'');
            if(fragmentShader.length<20||fragmentShader.length>24000||!/void\s+main\s*\(/.test(fragmentShader))throw new Error(`Shader pass ${index+1} needs a valid GLSL fragment main() under 24 KB.`);
            if(vertexShader&&(vertexShader.length>10000||!/void\s+main\s*\(/.test(vertexShader)))throw new Error(`Shader pass ${index+1} vertex shader is invalid or too large.`);
            const sourceCode=fragmentShader+'\n'+vertexShader;
            if(/#\s*(version|extension)|gl_FragData|gl_FragDepth|\bdiscard\b|while\s*\(|\bdo\s*\{/i.test(sourceCode))throw new Error(`Shader pass ${index+1} uses a forbidden or unsupported GLSL feature.`);
            const loopHeads=[...sourceCode.matchAll(/\bfor\s*\(([^)]*)\)/gi)];
            if(loopHeads.length>2)throw new Error(`Shader pass ${index+1} may contain at most two fixed-count loops.`);
            for(const loop of loopHeads){
                const parts=loop[1].split(';').map(part=>part.trim());
                const init=parts[0]||'',condition=parts[1]||'',step=parts[2]||'';
                const startMatch=init.match(/^(?:int|float)\s+\w+\s*=\s*(-?\d+)$/);
                const boundMatch=condition.match(/^\w+\s*(?:<|<=)\s*(\d+)$/);
                const stepOK=/^(?:\w+\+\+|\+\+\w+|\w+\s*\+=\s*1)$/.test(step);
                if(!startMatch||!boundMatch||!stepOK||Number(boundMatch[1])-Number(startMatch[1])>32)throw new Error(`Shader pass ${index+1} uses a non-constant or oversized GLSL loop.`);
            }
            totalSource+=sourceCode.length;if(totalSource>64000)throw new Error('The shader pack exceeds the 64 KB total GLSL source limit.');
            const uniforms=[];const names=new Set();
            (Array.isArray(pass.uniforms)?pass.uniforms.slice(0,16):[]).forEach(uniform=>{
                const uname=String(uniform?.name||'');const type=String(uniform?.type||'float');
                if(!/^u[A-Z][A-Za-z0-9_]{0,30}$/.test(uname)||names.has(uname)||['uTime','uResolution','uMouse','uIntensity','uFrame','uCameraPosition','uCameraDirection','tDiffuse'].includes(uname))throw new Error(`Shader pass ${index+1} has an invalid or reserved uniform name.`);
                names.add(uname);
                if(!['float','vec2','vec3','vec4','color'].includes(type))throw new Error(`Uniform ${uname} has an unsupported type.`);
                let value=uniform.defaultValue;
                if(type==='float'){const min=Number.isFinite(Number(uniform.min))?Number(uniform.min):-10,max=Number.isFinite(Number(uniform.max))?Number(uniform.max):10;if(max<=min||max-min>100000)throw new Error(`Uniform ${uname} range is invalid.`);value=Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):0;uniforms.push({name:uname,type,value,min,max,label:String(uniform.label||uname).slice(0,40)});}
                else if(type==='color'){value=/^#[0-9a-f]{6}$/i.test(String(value||''))?String(value):'#ffffff';uniforms.push({name:uname,type,value,label:String(uniform.label||uname).slice(0,40)});}
                else {const length=Number(type.slice(-1));if(!Array.isArray(value)||value.length!==length)throw new Error(`Uniform ${uname} must have ${length} numeric components.`);value=value.map(n=>Math.max(-10,Math.min(10,Number(n)||0)));uniforms.push({name:uname,type,value,label:String(uniform.label||uname).slice(0,40)});}
            });
            passes.push({name:String(pass.name||`Pass ${index+1}`).slice(0,50),vertexShader,fragmentShader,uniforms});
        });
    }
    return {format:'sclient-shaderpack',formatVersion:Number(raw.formatVersion),id,name,author:String(raw.author||'Unknown').slice(0,60),description:String(raw.description||'').slice(0,180),settings:{brightness:number('brightness',1,.7,1.3),contrast:number('contrast',1,.7,1.5),saturation:number('saturation',1,0,1.8),hue:number('hue',0,-45,45),tint:hex,tintStrength:number('tintStrength',0,0,.35),vignette:number('vignette',.1,0,.7),grain:number('grain',0,0,.1),intensity:number('intensity',1,0,2)},passes};
}
function allShaderPacks() { return [...BUILTIN_SHADERS, ...customShaderPacks]; }
function saveShaders() {
    const data = {activePackId, customPacks:customShaderPacks};
    const size = new Blob([JSON.stringify(data)]).size;
    if (size > 650000) { toast('Your shader library is too large for one cloud save. Remove a large custom pack.'); return Promise.resolve(false); }
    return window.SClientCloud.saveShaders(data).catch(error => { console.error('Shader cloud save failed:', error); toast('Could not sync shader packs to Firestore.'); return false; });
}
function applyShaderPipeline() {
    const record=activeSessionMods.find(item=>item.enabled && (item.manifest?.permissions||[]).some(permission=>['rendering.shaderPacks','eyesight.presets'].includes(permission)));
    const pack=record&&activeShaderId?allShaderPacks().find(item=>item.id===activeShaderId)||null:null;
    if(!pack){
        shaderPassEnabled=false;activeShaderPack=null;shaderFallbackSettings=null;
        if(R?.domElement)R.domElement.style.filter='none';
        disposeShaderPasses();
        shaderFrameUniforms.uBrightness.value=1;shaderFrameUniforms.uContrast.value=1;shaderFrameUniforms.uSaturation.value=1;shaderFrameUniforms.uHue.value=0;
        shaderFrameUniforms.uTint.value.set('#ffffff');shaderFrameUniforms.uTintStrength.value=0;shaderFrameUniforms.uVignette.value=0;shaderFrameUniforms.uGrain.value=0;shaderFrameUniforms.uIntensity.value=1;
        return;
    }
    shaderFallbackSettings=pack.settings;
    try {
        rebuildShaderPasses(pack);
        shaderFallbackNoticeShown=false;
        activeShaderPack=pack;
        const fx=pack.settings;
        shaderFrameUniforms.uBrightness.value=fx.brightness;shaderFrameUniforms.uContrast.value=fx.contrast;shaderFrameUniforms.uSaturation.value=fx.saturation;shaderFrameUniforms.uHue.value=fx.hue;
        shaderFrameUniforms.uTint.value.set(fx.tint);shaderFrameUniforms.uTintStrength.value=fx.tintStrength;shaderFrameUniforms.uVignette.value=fx.vignette;shaderFrameUniforms.uGrain.value=fx.grain;shaderFrameUniforms.uIntensity.value=fx.intensity;
        shaderPassEnabled=true;
        if(R?.domElement)R.domElement.style.filter='none';
    } catch(error) {
        console.error('Could not prepare Eyesight pack:',error);shaderPassFailed=true;shaderPassEnabled=false;activeShaderPack=null;toast('Eyesight could not prepare this shader pack. Original rendering remains active.');
    }
}
function setModEnabled(record, enabled) {
    if (!record || record.incompatible) return;
    const next = !!enabled;
    if (!!record.enabled === next) return;
    record.enabled = next;
    executeSclEvent(record, next ? 'onEnable' : 'onDisable', {enabled:next});
    saveMods();
    renderInstalledMods();
    refreshIslandEntry();
    syncExternalGameMods();
    toast(`${record.manifest.name} ${next ? 'enabled' : 'disabled'}.`);
}
function saveAndRenderMods(message) {
    saveMods(); renderInstalledMods(); refreshIslandEntry(); syncExternalGameMods();
    if (message) toast(message);
}
function getIntegratedWorldMode() {
    for (const record of activeSessionMods || []) {
        if (!record.enabled) continue;
        const mode = (record.manifest?.gameModes || []).find(item => item.type === 'openWorldSurvival' && (!item.feature || record.featureStates?.[item.feature] === true));
        if (mode) return { mode, record };
    }
    return null;
}
function launchModGameMode(modId, gameModeId) {
    const record = installedMods.find(item => item.manifest?.id === modId && item.enabled);
    const gameMode = record?.manifest?.gameModes?.find(item => item.id === gameModeId && (!item.feature || record.featureStates?.[item.feature] === true));
    if (!record || !gameMode) { toast('This game mode is no longer enabled.'); refreshIslandEntry(); return; }
    if (!$('gameWindow') || $('gameWindow').hidden) { toast('Connect your Aquavoid account before launching a mod game mode.'); return; }
    loadEnabledModsForAquavoid(() => {
        const activeRecord = activeSessionMods.find(item => item.manifest.id === modId);
        const activeMode = activeRecord?.manifest?.gameModes?.find(item => item.id === gameModeId);
        if (!activeRecord || !activeMode) { toast('The mod game mode could not be loaded.'); return; }
        if (activeMode.type === 'openWorldSurvival') enterOpenWorldSession(composeGameModeWithExtensions(activeMode), activeRecord);
        else toast(`Unsupported game mode: ${activeMode.type}`);
    });
}

function renderEnabledGameModes() {
    const host = $('modGameModes');
    if (!host) return;
    host.replaceChildren();
    installedMods.filter(record => record.enabled && !record.incompatible).forEach(record => {
        (record.manifest.gameModes || []).filter(gameMode => gameMode.type !== 'openWorldSurvival' && (!gameMode.feature || record.featureStates?.[gameMode.feature] === true)).forEach(gameMode => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'soft-button mod-game-mode-button';
            button.textContent = `${gameMode.icon || '🌍'} ${gameMode.name.toUpperCase()}`;
            button.title = gameMode.description || `Launch ${gameMode.name}`;
            button.addEventListener('click', () => launchModGameMode(record.manifest.id, gameMode.id));
            host.appendChild(button);
        });
    });
}
function refreshIslandEntry() {
    renderEnabledGameModes();
    const record = installedMods.find(item => item.enabled && (item.manifest?.gameModes || []).some(m => m.type === 'openWorldSurvival' && (!m.feature || item.featureStates?.[m.feature] === true)));
    const mode = record && record.manifest.gameModes.find(m => m.type === 'openWorldSurvival');
    if ($('lvb')) $('lvb').style.display = mode ? 'none' : '';
    if ($('endb')) $('endb').textContent = mode ? `${mode.icon || '🏝️'} PLAY ${mode.name.toUpperCase()}` : 'ENDLESS';
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
        info.innerHTML = `<div class="available-title-row"><h3>${escapeHTML(manifest.name)}</h3><span class="optional-chip">${record.incompatible ? 'INCOMPATIBLE' : record.enabled ? 'ENABLED' : 'DISABLED'}</span></div><p>${escapeHTML(record.compatibilityError || manifest.description || 'Imported S-Client mod.')}</p><div class="mod-meta"><span>v${escapeHTML(manifest.version)}</span><span>·</span><span>Aquavoid ${escapeHTML((manifest.gameVersions||[]).join(', ')||'?')}</span><span>·</span><span>${escapeHTML(manifest.author)}</span>${manifest.formatVersion === 2 ? '<span>·</span><span>SCL v1</span>' : ''}</div>`;
        const buttons = document.createElement('div'); buttons.className = 'owned-mod-actions';
        const configure = document.createElement('button'); configure.type = 'button'; configure.className = 'download-button'; configure.textContent = 'OPEN PAGE'; configure.addEventListener('click', () => openModPage(record.manifest.id));
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = `toggle${record.enabled ? ' on' : ''}`; toggle.disabled = !!record.incompatible; toggle.title = record.compatibilityError || ''; toggle.setAttribute('aria-label', record.enabled ? 'Disable mod' : 'Enable mod'); toggle.addEventListener('click', () => setModEnabled(record, !record.enabled));
        const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.className = 'quiet-button'; exportButton.textContent = 'EXPORT'; exportButton.title = 'Export a copy of this mod you own'; exportButton.addEventListener('click', () => exportManifest(record));
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet-button danger-button'; remove.textContent = 'REMOVE'; remove.addEventListener('click', () => { if (record.enabled) executeSclEvent(record, 'onDisable', {enabled:false, removed:true}); installedMods.splice(index, 1); if (activeModId === manifest.id) activeModId = null; saveAndRenderMods(`${manifest.name} removed from your library.`); });
        buttons.append(configure, toggle, exportButton, remove); card.append(icon, info, buttons); $('installedMods').appendChild(card);
    });
    refreshIslandEntry();
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
    control.addEventListener('click', () => { const enabled = !record.featureStates[feature.id]; record.featureStates[feature.id] = enabled; executeSclEvent(record, 'onFeatureChange', {feature:feature.id, enabled, value:enabled}); saveMods(); renderModPage(record); refreshIslandEntry(); syncExternalGameMods(); toast('Feature setting saved.'); });
    row.append(text, control); host.appendChild(row);
}
function renderSclShaderPicker(host, record, control) {
    const section = document.createElement('section');
    section.className = 'eyesight-page';
    const headingText = document.createElement('div');
    headingText.innerHTML = '<span class="eyebrow">S-CLIENT SHADER ENGINE · WEBGL GLSL</span>'; 
    const title = document.createElement('h2'); title.textContent = control.label || 'Choose your visual style';
    const description = document.createElement('p'); description.textContent = control.description || 'Choose a look and tune its controls here. Your selection is applied during the next Aquavoid loading screen.';
    headingText.append(title, description);
    const heading = document.createElement('div'); heading.className = 'eyesight-console-heading';
    const status = document.createElement('span'); status.className = 'eyesight-live-status'; status.innerHTML = '<i></i> NEXT SESSION';
    heading.append(headingText, status); section.appendChild(heading);
    const builtinHeading = document.createElement('div'); builtinHeading.className = 'shader-library-heading';
    builtinHeading.innerHTML = '<div><h3>Built-in looks</h3><p>Clean, cinematic and deep-ocean colour grades.</p></div>';
    section.appendChild(builtinHeading);
    const builtinGrid = document.createElement('div'); builtinGrid.className = 'shader-grid'; section.appendChild(builtinGrid);
    const original = {id:'',name:'Original',description:'Keep Aquavoid’s natural rendering with no Eyesight colour grade.',settings:{brightness:1,contrast:1,saturation:1,hue:0,tint:'#ffffff',tintStrength:0,vignette:0,grain:0}};
    const choicePacks = [original, ...BUILTIN_SHADERS];
    function selectPack(pack) {
        const previousValue = activeShaderId;
        activeShaderId = pack.id;
        saveShaders();
        executeSclCommands(record, control.onChange, {value:pack.id, previousValue, setting:control.setting || control.id, control:control.id});
        executeSclEvent(record, 'onSettingChange', {setting:control.setting || control.id, value:pack.id, previousValue});
        if (activeModId === record.manifest.id) renderModPage(record);
        toast('Shader selection saved. It will be applied when you launch Aquavoid.');
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
        const detail = document.createElement('small'); detail.textContent = `${pack.description || 'Eyesight shader pack.'}${pack.passes?.length ? ` · ${pack.passes.length} GLSL PASS${pack.passes.length===1?'':'ES'}` : ' · COLOUR PIPELINE'}`;
        copy.append(name, detail);
        const state = document.createElement('span'); state.className = 'shader-choice-state'; state.textContent = active ? '✓ SELECTED' : 'SELECT LOOK';
        card.append(preview, copy, state); card.disabled = !record.enabled;
        card.addEventListener('click', () => selectPack(pack));
        return card;
    }
    choicePacks.forEach(pack => builtinGrid.appendChild(makeChoice(pack)));
    const customHeading = document.createElement('div'); customHeading.className = 'shader-library-heading custom-shader-heading';
    const customTitle = document.createElement('div'); customTitle.innerHTML = '<h3>Your shader packs</h3><p>Multi-pass GLSL pipelines, live uniforms and per-pack settings. Import a .shadersclient file or a ZIP containing shader packs.</p>'; 
    const importButton = document.createElement('button'); importButton.className = 'import-button'; importButton.type = 'button'; importButton.textContent = '＋ IMPORT SHADERPACK';
    customHeading.append(customTitle, importButton); section.appendChild(customHeading);
    const customRoot = document.createElement('div'); customRoot.className = 'custom-shader-grid'; section.appendChild(customRoot);
    const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = '.shadersclient,.json,.zip,application/json,application/zip'; fileInput.multiple = true; fileInput.hidden = true; section.appendChild(fileInput);
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
            saveShaders(); renderModPage(record);
        });
        actions.append(exportButton, removeButton); wrapper.appendChild(actions);
        const uniformDefs=(pack.passes||[]).flatMap((pass,passIndex)=>(pass.uniforms||[]).map(uniform=>({passIndex,passName:pass.name||`Pass ${passIndex+1}`,uniform})));
        if(uniformDefs.length){
            const tuning=document.createElement('div');tuning.className='shader-uniform-settings';
            const tuningTitle=document.createElement('strong');tuningTitle.textContent='PACK CONTROLS';tuning.appendChild(tuningTitle);
            uniformDefs.forEach(({passIndex,passName,uniform})=>{
                const row=document.createElement('label');row.className='shader-uniform-row';
                const title=document.createElement('span');title.textContent=`${uniform.label||uniform.name} · ${passName}`;row.appendChild(title);
                const update=(next)=>{uniform.value=next;saveShaders();postExternalModState();toast('Shader control saved. It will apply during the next Aquavoid loading screen.');};
                if(uniform.type==='float'){
                    const input=document.createElement('input');input.type='range';input.min=uniform.min??-10;input.max=uniform.max??10;input.step='0.01';input.value=uniform.value;input.disabled=!record.enabled;
                    const output=document.createElement('output');output.textContent=Number(uniform.value).toFixed(2);
                    input.addEventListener('input',()=>output.textContent=Number(input.value).toFixed(2));input.addEventListener('change',()=>update(Number(input.value)));
                    row.append(input,output);
                }else if(uniform.type==='color'){
                    const input=document.createElement('input');input.type='color';input.value=uniform.value;input.disabled=!record.enabled;input.addEventListener('change',()=>update(input.value));row.appendChild(input);
                }else{
                    const count=Number(uniform.type.slice(-1));const values=Array.isArray(uniform.value)?uniform.value.slice():Array(count).fill(0);
                    const group=document.createElement('div');group.className='shader-vector-inputs';
                    values.forEach((value,index)=>{const input=document.createElement('input');input.type='number';input.min=-10;input.max=10;input.step='0.01';input.value=value;input.disabled=!record.enabled;input.setAttribute('aria-label',`${uniform.name} component ${index+1}`);input.addEventListener('change',()=>{values[index]=Math.max(-10,Math.min(10,Number(input.value)||0));update(values.slice());});group.appendChild(input);});row.appendChild(group);
                }
                tuning.appendChild(row);
            });
            wrapper.appendChild(tuning);
        }
        customRoot.appendChild(wrapper);
    });
    const eyesightEnabled = !!(record.enabled && activeShaderId && (sclPermission(record,'rendering.shaderPacks') || sclPermission(record,'eyesight.presets')));
    status.classList.toggle('is-off', !eyesightEnabled); status.innerHTML = eyesightEnabled ? '<i></i> READY FOR NEXT SESSION' : '<i></i> NOT ACTIVE IN THIS SESSION';
    importButton.disabled = !record.enabled;
    importButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async event => { const files=[...event.target.files]; const archives=files.filter(file=>/\.zip$/i.test(file.name)||file.type==='application/zip'); const direct=files.filter(file=>!archives.includes(file)); if(archives.length)await importModFiles(archives); if(direct.length)await importShaderFiles(direct); event.target.value=''; if(activeModId===record.manifest.id)renderModPage(record); });
    const engineInfo=document.createElement('p');engineInfo.className='eyesight-engine-info';engineInfo.textContent='SCL shader packs run as up to four ordered GLSL ES 1.00 fullscreen passes. Built-in uniforms: tDiffuse, uTime, uResolution, uMouse, uIntensity, uFrame, uCameraPosition and uCameraDirection. Shader compilation is isolated; a rejected pack rolls back to the original game frame.';section.appendChild(engineInfo);
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
    const settingChanges = [];
    const featureChanges = [];
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
                const nextValue = coerceSclSetting(definition, value);
                const previousValue = record.settings[statement.setting];
                record.settings[statement.setting] = nextValue; changed = true;
                if (previousValue !== nextValue) settingChanges.push({setting:statement.setting, value:nextValue, previousValue});
            } else if (statement.op === 'setFeature') {
                if (!record.manifest.features.some(item => item.id === statement.feature)) throw new Error(`Unknown feature: ${statement.feature}`);
                const enabled = statement.enabled === '$value' ? !!context.value : statement.enabled === '$enabled' ? !!context.enabled : statement.enabled === true;
                const previousValue = record.featureStates[statement.feature] === true;
                record.featureStates[statement.feature] = enabled; changed = true;
                if (previousValue !== enabled) featureChanges.push({feature:statement.feature, enabled, value:enabled, previousValue});
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
                } else if (['rendering.selectShaderPack','eyesight.selectPreset'].includes(statement.api)) {
                    if (!(sclPermission(record, 'rendering.shaderPacks') || sclPermission(record, 'eyesight.presets'))) throw new Error('The rendering.shaderPacks permission is required.');
                    const presetId = String(value ?? '');
                    if (presetId && !allShaderPacks().some(pack => pack.id === presetId)) throw new Error('That Eyesight preset is not installed.');
                    activeShaderId = presetId; saveShaders();
                } else if (['rendering.resetShaderPack','eyesight.reset'].includes(statement.api)) {
                    if (!(sclPermission(record, 'rendering.shaderPacks') || sclPermission(record, 'eyesight.presets'))) throw new Error('The rendering.shaderPacks permission is required.');
                    activeShaderId = ''; saveShaders();
                } else if (statement.api === 'aquavoid.action') {
                    if (!sclPermission(record, 'aquavoid.actions') || !SUPPORTED_ACTIONS.has(statement.action)) throw new Error('The aquavoid.actions permission or requested action is unavailable.');
                    dispatchAquavoidAction(statement.action, Number(value) || 0);
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
        if (changed) { saveMods(); if (activeModId === record.manifest.id) renderModPage(record); syncExternalGameMods(); }
        settingChanges.forEach(change => executeSclEvent(record, 'onSettingChange', change));
        featureChanges.forEach(change => executeSclEvent(record, 'onFeatureChange', change));
    }
}
function executeSclEvent(record, event, context = {}) {
    const commands = record?.manifest?.program?.[event];
    if (!record || typeof record !== 'object' || !Array.isArray(commands) || !commands.length) return;
    let active = sclEventInFlight.get(record);
    if (!active) { active = new Set(); sclEventInFlight.set(record, active); }
    if (active.has(event)) return;
    active.add(event);
    try { executeSclCommands(record, commands, context); }
    finally {
        active.delete(event);
        if (!active.size) sclEventInFlight.delete(record);
    }
}
function updateSclSetting(record, settingId, rawValue, onChange = []) {
    const setting = record.manifest.settings.find(item => item.id === settingId);
    try {
        const previousValue = record.settings[settingId];
        const value = coerceSclSetting(setting, rawValue);
        record.settings[settingId] = value;
        const context = {setting:settingId, value, previousValue};
        if (previousValue !== value) {
            executeSclCommands(record, onChange, context);
            executeSclEvent(record, 'onSettingChange', context);
        }
        saveMods();
        syncExternalGameMods();
        if (activeModId === record.manifest.id) renderModPage(record);
        toast('Setting saved.');
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
            const button = document.createElement('button'); button.type = 'button'; button.className = 'cheat-action mod-page-action'; button.textContent = control.label; button.disabled = !record.enabled || !control.onClick.length;
            button.addEventListener('click', () => {
                if (!record.enabled) return;
                executeSclCommands(record, control.onClick, {control:control.id, value:true});
                toast(`${control.label} executed.`);
            });
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
            input.addEventListener('input', () => { const value = Number(input.value); const valueLabel = row.querySelector('.scl-value'); if (valueLabel) valueLabel.textContent = String(value); });
            input.addEventListener('change', () => updateSclSetting(record, control.setting, Number(input.value), control.onChange));
            const valueLabel = document.createElement('small'); valueLabel.className = 'scl-value'; valueLabel.textContent = String(current); copy.appendChild(valueLabel);
        }
        input.disabled = !record.enabled; row.appendChild(input); host.appendChild(row);
    });
}

function recordForShaderPacks() { return installedMods.find(item => item.enabled && (item.manifest.permissions||[]).some(permission=>['rendering.shaderPacks','eyesight.presets'].includes(permission))); }
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
            'eyesight.presets':'Legacy shader preset permission',
            'rendering.shaderPacks':'Manage shader packs through the generic WebGL renderer',
            'vehicles.shipSkins':'Contribute data-driven vehicle skins',
            'input.cursorUnlock':'Unlock the game cursor with Escape',
            'aquavoid.worlds':'Add game modes and tagged world content',
            'aquavoid.features':'Toggle built-in Aquavoid feature hooks',
            'aquavoid.actions':'Run existing allowlisted Aquavoid actions',
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
    // Mod configuration is for enable/disable and settings only. Gameplay entry points render in the Aquavoid Play menu.
    renderSclControls(record, host);
}

function renderInstalledMods() {
    renderModLibrary();
    if (activeModId) { const current = installedMods.find(item => item.manifest.id === activeModId); if (current) { $('modsLibraryView').hidden = true; $('modDetailView').hidden = false; renderModPage(current); } else activeModId = null; }
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
    if (!currentModInstanceId) { toast('Select or install an instance first. Mods are installed per instance.'); return; }
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
                    else { upsertManifest(parsed, currentModInstanceVersion); modCount++; }
                } catch (error) { errors.push(`${entry.name}: ${error.message}`); }
            }
        } catch (error) { errors.push(`${file.name}: ${error.message}`); }
    }
    if (modCount) saveMods();
    if (shaderCount) saveShaders();
    renderInstalledMods();
    const summary = [`${modCount} mod${modCount===1?'':'s'} imported`, `${shaderCount} shader pack${shaderCount===1?'':'s'} imported`].join(' · ');
    const errorSummary = errors.length ? ` ${errors.slice(0,3).join('; ')}${errors.length > 3 ? `; and ${errors.length - 3} more error(s)` : ''}` : '';
    toast(errors.length ? `${summary}. ${errorSummary}` : `${summary}. Your library is syncing to Firestore.`);
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
            if (file.size > 150000) throw new Error('Shader packs are limited to 150 KB each.');
            upsertShaderPack(JSON.parse(await file.text())); imported++;
        } catch (error) { errors.push(`${file.name}: ${error.message}`); }
    }
    if (imported) { await saveShaders(); activeShaderId = customShaderPacks.at(-1)?.id || activeShaderId; await saveShaders(); const rec = recordForShaderPacks(); if (rec && activeModId === 'eyesight') renderModPage(rec); }
    toast(errors.length ? `${imported} shader pack(s) imported. ${errors[0]}` : `${imported} shader pack(s) imported and saved to your account.`);
}
// Both import entry points must open the same picker. The empty-state button is
// especially important for first-time users whose library has no installed mods.
const openModImportPicker = () => { if (!currentModInstanceId) { toast('Select or install an instance first. Mods are installed per instance.'); return; } $('modFileInput').click(); };
$('importModButton')?.addEventListener('click', openModImportPicker);
$('emptyImportButton')?.addEventListener('click', openModImportPicker);
$('modFileInput').addEventListener('change', async event => {
    const selected = [...(event.target.files || [])];
    if (!selected.length) return;
    await importModFiles(selected);
    event.target.value = '';
});
$('backToModLibrary').addEventListener('click', () => { activeModId = null; renderModLibrary(); });
// Per-instance mods: the launcher tells us which instance's mod library to show.
let modInstanceLoadToken = 0;
function applyModInstance(instanceId, version = window.__sclientModVersion || null) {
    const normalizedVersion = version ? String(version) : null;
    const loadKey = `${instanceId || ''}|${normalizedVersion || ''}`;
    if (loadKey === modInstanceLoadKey) return modInstanceLoadPromise;

    const token = ++modInstanceLoadToken;
    currentModInstanceId = instanceId || null;
    currentModInstanceVersion = normalizedVersion;
    modInstanceLoadKey = loadKey;
    activeModId = null;
    installedMods.length = 0;

    modInstanceLoadPromise = (async () => {
        if (instanceId) {
            try {
                const stored = await window.SClientCloud.loadInstanceMods(instanceId);
                if (token !== modInstanceLoadToken) return false;
                stored.filter(item => item && item.manifest && item.manifest.format === 'sclient-mod').forEach(item => {
                    const declared = readGameVersions(item.manifest);
                    const compatible = declared.some(v => SUPPORTED_GAME_VERSIONS.includes(v)) && (!currentModInstanceVersion || declared.includes(currentModInstanceVersion));
                    const record = {...item, featureStates:item.featureStates || {}, settings:item.settings || {}, state:item.state || {}};
                    delete record.incompatible;
                    delete record.compatibilityError;
                    if (!compatible) {
                        record.enabled = false;
                        record.incompatible = true;
                        record.compatibilityError = `This mod supports Aquavoid ${declared.join(', ') || 'no declared version'}, not this ${currentModInstanceVersion ? `Aquavoid ${currentModInstanceVersion}` : 'instance'}.`;
                    }
                    installedMods.push(record);
                });
            } catch (error) {
                console.error('Could not load instance mods:', error);
                toast('Could not load this instance\'s mods.');
                if (token === modInstanceLoadToken) modInstanceLoadKey = null;
                return false;
            }
        }
        if (token !== modInstanceLoadToken) return false;
        renderModLibrary();
        // Re-selecting the instance that is actively running refreshes its live
        // profile. Selecting a different instance does not affect the game.
        syncExternalGameMods();
        return true;
    })();
    return modInstanceLoadPromise;
}
window.SClientMods = {
    // Validates a downloaded mod against the target instance's exact game version.
    async install(instanceId, raw, version = null) {
        if (!instanceId) throw new Error('Choose an instance first.');
        const normalizedVersion = version ? String(version) : null;
        const requestedLoadKey = `${instanceId}|${normalizedVersion || ''}`;
        const loaded = currentModInstanceId !== instanceId || currentModInstanceVersion !== normalizedVersion || modInstanceLoadKey !== requestedLoadKey
            ? await applyModInstance(instanceId, normalizedVersion)
            : await modInstanceLoadPromise;
        if (!loaded) throw new Error('Could not load this instance’s mod profile. Check your connection and try again.');
        const targetVersion = normalizedVersion || currentModInstanceVersion;
        const name = upsertManifest(raw, targetVersion);
        const ok = await saveMods();
        renderInstalledMods();
        if (ok === false) throw new Error('Could not save to your account.');
        syncExternalGameMods();
        return name;
    },
    async startInstance(instanceId, targetWindow, version) {
        if (!instanceId || !targetWindow) return {ok:false, message:'The game frame is not ready.'};
        const normalizedVersion = version ? String(version) : null;
        const requestedLoadKey = `${instanceId}|${normalizedVersion || ''}`;
        const loaded = currentModInstanceId !== instanceId || currentModInstanceVersion !== normalizedVersion || modInstanceLoadKey !== requestedLoadKey
            ? await applyModInstance(instanceId, normalizedVersion)
            : await modInstanceLoadPromise;
        if (!loaded) return {ok:false, message:'The instance mod profile could not be loaded. Check your connection and try again.'};
        if (externalGameWindow && externalGameWindow !== targetWindow && modSessionActive) {
            activeSessionMods.forEach(record => executeSclEvent(record, 'onGameUnload', {session:true}));
        }
        externalGameWindow = targetWindow;
        externalGameInstanceId = instanceId;
        activeSessionMods = cloneEnabledModRecords();
        modSessionActive = true;
        // onEnable belongs to the enabled-state transition; launching a game
        // must not dispatch it a second time. onGameLoad is the session event.
        activeSessionMods.forEach(record => {
            executeSclEvent(record, 'onGameLoad', {session:true, instanceId, gameVersion:normalizedVersion || ''});
        });
        postExternalModState();
        return {ok:true, modCount:activeSessionMods.length};
    },
    stopInstance() {
        if (externalGameWindow && modSessionActive) activeSessionMods.forEach(record => executeSclEvent(record, 'onGameUnload', {session:true}));
        externalGameWindow = null;
        externalGameInstanceId = null;
        activeSessionMods = [];
        modSessionActive = false;
    }
};
window.addEventListener('sclient:mod-instance', event => applyModInstance(event.detail?.id || null, event.detail?.version || null));
if (window.__sclientModInstance) applyModInstance(window.__sclientModInstance, window.__sclientModVersion || null);
$('modsLibraryButton')?.addEventListener('click', () => { activeModId = null; renderModLibrary(); });
$('modFileInput').setAttribute('multiple','');
$('modFileInput').setAttribute('accept','.sclient,.shadersclient,.zip,application/zip,application/json,.json');

// Start with the private mod library and initialize the live WebGL colour-grade pass.
function renderModStart() { renderModLibrary(); refreshIslandEntry(); }
renderModStart();

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
// Initial cloud loading is coordinated by onAquavoidUser() above. Do not
// save here: at this point Firebase may have confirmed the user but still be
// waiting for the player's Firestore document to finish loading.
})();
