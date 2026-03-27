/**
 * Device identity and authentication.
 *
 * Uses SubtleCrypto ECDSA P-256 keypairs stored in IndexedDB.
 * Implements the challenge-response flow against the daemon's
 * /auth/challenge and /auth/verify endpoints.
 */

// ── IndexedDB helpers ────────────────────────────────────────────────

const DB_NAME = 'logswarm-auth';
const STORE_NAME = 'keys';
const KEY_ID = 'device-keypair';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeKeys(
  publicKey: CryptoKey,
  privateKey: CryptoKey,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      id: KEY_ID,
      publicKey,
      privateKey,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadKeys(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
} | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(KEY_ID);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

// ── Key management ──────────────────────────────────────────────────

export async function getOrCreateKeyPair(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}> {
  const existing = await loadKeys();
  if (existing) return existing;

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, // non-extractable
    ['sign', 'verify'],
  );

  await storeKeys(keyPair.publicKey, keyPair.privateKey);
  return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

// ── Device meta-information ─────────────────────────────────────────

export interface DeviceMeta {
  userAgent: string;
  platform: string;
  screenResolution: [number, number];
  timezone: string;
  language: string;
  hardwareConcurrency: number;
  deviceMemory?: number;
  touchPoints: number;
}

export function collectDeviceMeta(): DeviceMeta {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    screenResolution: [screen.width, screen.height],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency ?? 1,
    deviceMemory: (navigator as unknown as Record<string, unknown>).deviceMemory as
      | number
      | undefined,
    touchPoints: navigator.maxTouchPoints ?? 0,
  };
}

// ── Challenge-response flow ─────────────────────────────────────────

export async function authenticate(
  baseUrl = '',
): Promise<{ token: string; deviceId: string } | null> {
  try {
    const { publicKey, privateKey } = await getOrCreateKeyPair();
    const pubKeyB64 = await exportPublicKey(publicKey);

    // Step 1: Get challenge
    const challengeRes = await fetch(`${baseUrl}/auth/challenge`, {
      method: 'GET',
    });
    if (!challengeRes.ok) return null;
    const { challenge } = (await challengeRes.json()) as {
      challenge: string;
    };

    // Step 2: Sign the challenge
    const challengeBytes = new TextEncoder().encode(challenge);
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      challengeBytes,
    );
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

    // Step 3: Verify
    const verifyRes = await fetch(`${baseUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: pubKeyB64.slice(0, 16),
        public_key: pubKeyB64,
        signature: sigB64,
        device_meta: collectDeviceMeta(),
      }),
    });

    if (!verifyRes.ok) return null;
    const result = (await verifyRes.json()) as {
      token: string;
      device_id: string;
    };
    return { token: result.token, deviceId: result.device_id };
  } catch (e) {
    console.warn('[auth] authentication failed:', e);
    return null;
  }
}
