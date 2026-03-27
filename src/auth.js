import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  memoryLocalCache,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  serverTimestamp,
  arrayUnion,
  onSnapshot,
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import firebaseConfig from './firebase-config.js';
import { hashSecret, deriveComputeSpec } from './crypto-utils.js';

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, { localCache: memoryLocalCache() });
const auth = getAuth(app);

// ─── State ───────────────────────────────────────────────────────────
let currentNodeId = null;
let linkedSecrets = []; // [{hash, type, label, createdAt}]
let isMaster = false;
let unsubscribers = [];
let currentComputeSpec = null; // { hash, seed, primes, signature, dimensions }

// ─── Constants ───────────────────────────────────────────────────────
const RESET_PIN = '67'; // The "6 7 OK" universal fallback

// ─── Firebase Auth ───────────────────────────────────────────────────
let authInitPromise = null;

export function initAuth() {
  if (authInitPromise) return authInitPromise;

  authInitPromise = new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (user) {
        currentNodeId = user.uid;
        resolve(user);
      } else {
        try {
          const cred = await signInAnonymously(auth);
          currentNodeId = cred.user.uid;
          resolve(cred.user);
        } catch (err) {
          authInitPromise = null;
          reject(err);
        }
      }
    });
  });

  return authInitPromise;
}

export function getNodeId() {
  return currentNodeId;
}

export function getIsMaster() {
  return isMaster;
}

export function getLinkedSecrets() {
  return [...linkedSecrets];
}

export function getComputeSpec() {
  return currentComputeSpec;
}

// ─── PIN / Secret Authentication ─────────────────────────────────────
/**
 * Returns: { action, nodeData?, secretHash? }
 *  action: 'reset' | 'authenticated' | 'new_secret' | 'failed'
 */
export async function authenticateWithSecret(rawSecret, type = 'pin') {
  // 6 7 OK — universal reset
  if (rawSecret === RESET_PIN) {
    await resetNode();
    return { action: 'reset' };
  }

  const secretHash = await hashSecret(rawSecret);

  // Derive computation spec from the secret
  currentComputeSpec = await deriveComputeSpec(rawSecret);

  // Check if this secret already exists in Firestore
  const secretDocRef = doc(db, 'secrets', secretHash);
  const secretSnap = await getDoc(secretDocRef);

  if (secretSnap.exists()) {
    // Secret exists — link it to the current node and load shared data
    const secretData = secretSnap.data();
    await linkSecretToCurrentNode(secretHash, secretData);
    return {
      action: 'authenticated',
      secretHash,
      secretData,
    };
  } else {
    // Brand new secret — register it under the current node
    await registerNewSecret(secretHash, type, rawSecret);
    return {
      action: 'new_secret',
      secretHash,
    };
  }
}

// ─── Master Password ─────────────────────────────────────────────────
export async function authenticateWithMaster(rawPassword) {
  const masterHash = await hashSecret(rawPassword);
  const masterRef = doc(db, 'master', 'config');
  const masterSnap = await getDoc(masterRef);

  if (masterSnap.exists() && masterSnap.data().hash === masterHash) {
    isMaster = true;
    return true;
  }
  return false;
}

// ─── Secret Management ───────────────────────────────────────────────
async function registerNewSecret(secretHash, type, label) {
  const secretDocRef = doc(db, 'secrets', secretHash);
  await setDoc(secretDocRef, {
    hash: secretHash,
    nodeId: currentNodeId,
    type,
    createdAt: serverTimestamp(),
  });

  // Also store under the node's linked secrets
  const nodeLinkedRef = doc(
    db,
    'nodes',
    currentNodeId,
    'linkedSecrets',
    secretHash
  );
  await setDoc(nodeLinkedRef, {
    hash: secretHash,
    type,
    label: maskSecret(label),
    linkedAt: serverTimestamp(),
  });

  // Initialize shared data container
  const sharedMeta = doc(db, 'shared', secretHash);
  await setDoc(
    sharedMeta,
    {
      ownerNodeId: currentNodeId,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  linkedSecrets.push({ hash: secretHash, type, label: maskSecret(label) });
}

async function linkSecretToCurrentNode(secretHash, secretData) {
  const nodeLinkedRef = doc(
    db,
    'nodes',
    currentNodeId,
    'linkedSecrets',
    secretHash
  );
  await setDoc(
    nodeLinkedRef,
    {
      hash: secretHash,
      type: secretData.type || 'pin',
      linkedAt: serverTimestamp(),
    },
    { merge: true }
  );

  if (!linkedSecrets.find((s) => s.hash === secretHash)) {
    linkedSecrets.push({
      hash: secretHash,
      type: secretData.type || 'pin',
      label: '••••••',
    });
  }
}

// ─── Node Management ─────────────────────────────────────────────────
export async function ensureNodeDocument(deviceInfo) {
  const nodeRef = doc(db, 'nodes', currentNodeId);
  const snap = await getDoc(nodeRef);

  if (!snap.exists()) {
    await setDoc(nodeRef, {
      createdAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
      deviceInfo: deviceInfo || {},
      linkedSecretCount: 0,
    });
  } else {
    await updateDoc(nodeRef, {
      lastSeen: serverTimestamp(),
      deviceInfo: deviceInfo || {},
    });
  }

  // Load existing linked secrets
  const linkedSecretsCol = collection(
    db,
    'nodes',
    currentNodeId,
    'linkedSecrets'
  );
  const linkedSnap = await getDocs(linkedSecretsCol);
  linkedSecrets = linkedSnap.docs.map((d) => d.data());
}

export async function resetNode() {
  // Clear all local storage
  localStorage.clear();
  sessionStorage.clear();

  // Clear IndexedDB
  const dbs = await indexedDB.databases?.();
  if (dbs) {
    for (const dbInfo of dbs) {
      if (dbInfo.name) indexedDB.deleteDatabase(dbInfo.name);
    }
  }

  // Clear cookies
  document.cookie.split(';').forEach((c) => {
    document.cookie = c
      .replace(/^ +/, '')
      .replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/');
  });

  // Sign out and reload
  await signOut(auth);
  linkedSecrets = [];
  isMaster = false;
  currentNodeId = null;
  authInitPromise = null;
  window.location.reload();
}

// ─── Routing & Filtering ─────────────────────────────────────────────
export async function getRoutingConfig() {
  const routingRef = doc(db, 'routing', currentNodeId);
  const snap = await getDoc(routingRef);
  return snap.exists() ? snap.data() : { filters: [], routes: [], active: true };
}

export async function updateRoutingConfig(config) {
  const routingRef = doc(db, 'routing', currentNodeId);
  await setDoc(routingRef, { ...config, nodeId: currentNodeId }, { merge: true });
}

// ─── Cluster Management ──────────────────────────────────────────────
export async function joinCluster(clusterId) {
  const clusterRef = doc(db, 'clusters', clusterId);
  const snap = await getDoc(clusterRef);

  if (!snap.exists()) {
    await setDoc(clusterRef, {
      nodes: [currentNodeId],
      createdAt: serverTimestamp(),
    });
  } else {
    await updateDoc(clusterRef, {
      nodes: arrayUnion(currentNodeId),
    });
  }

  // Store cluster reference on node
  const nodeRef = doc(db, 'nodes', currentNodeId);
  await updateDoc(nodeRef, { clusterId });
}

export async function getClusterNodes(clusterId) {
  const clusterRef = doc(db, 'clusters', clusterId);
  const snap = await getDoc(clusterRef);
  return snap.exists() ? snap.data().nodes || [] : [];
}

// ─── Shared Data Access ──────────────────────────────────────────────
export async function getSharedData(secretHash) {
  const dataCol = collection(db, 'shared', secretHash, 'data');
  const snap = await getDocs(dataCol);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function setSharedData(secretHash, docId, data) {
  const dataRef = doc(db, 'shared', secretHash, 'data', docId);
  await setDoc(dataRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export function subscribeToSharedData(secretHash, callback) {
  const dataCol = collection(db, 'shared', secretHash, 'data');
  const unsub = onSnapshot(dataCol, (snap) => {
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(docs);
  });
  unsubscribers.push(unsub);
  return unsub;
}

// ─── All Private Data (Master) ───────────────────────────────────────
export async function getAllSecrets() {
  if (!isMaster) return [];
  const secretsCol = collection(db, 'secrets');
  const snap = await getDocs(secretsCol);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ─── Cleanup ─────────────────────────────────────────────────────────
export function cleanup() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
}

// ─── Helpers ─────────────────────────────────────────────────────────
function maskSecret(raw) {
  if (!raw || raw.length <= 2) return '••';
  return raw[0] + '•'.repeat(raw.length - 2) + raw[raw.length - 1];
}

export { db, auth, serverTimestamp, doc, setDoc, getDoc, collection, getDocs };
