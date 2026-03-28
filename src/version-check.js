import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './auth.js';

let initialCommitSha = null;
let currentUnsubscribe = null;
let retryCount = 0;
let retryTimer = null;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

export function subscribeToVersion() {
  // Cancel any pending retry timer to prevent duplicate listeners
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  // Clean up any previous listener before starting a new one
  if (currentUnsubscribe) {
    currentUnsubscribe();
    currentUnsubscribe = null;
  }

  const ref = doc(db, 'env', 'version');
  currentUnsubscribe = onSnapshot(
    ref,
    (snap) => {
      retryCount = 0; // Reset on successful connection
      if (!snap.exists()) return;
      const data = snap.data();
      if (initialCommitSha === null) {
        initialCommitSha = data.commitSha;
        return;
      }
      if (data.commitSha !== initialCommitSha) {
        showUpdateBanner(data.version);
      }
    },
    (error) => {
      console.warn('[version-check] Firestore version listener error:', error);
      if (retryCount < MAX_RETRIES && retryTimer === null) {
        retryCount++;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          subscribeToVersion();
        }, RETRY_DELAY_MS);
      }
    },
  );
  return currentUnsubscribe;
}

export function getAppVersion() {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
}

function showUpdateBanner(newVersion) {
  if (document.getElementById('version-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'version-banner';

  const labelSpan = document.createElement('span');
  labelSpan.textContent = newVersion ? `Version ${newVersion} is available.` : 'A new version is available.';

  const reloadButton = document.createElement('button');
  reloadButton.id = 'version-reload';
  reloadButton.textContent = 'Refresh';

  const dismissButton = document.createElement('button');
  dismissButton.id = 'version-dismiss';
  dismissButton.textContent = '\u00d7';

  banner.appendChild(labelSpan);
  banner.appendChild(reloadButton);
  banner.appendChild(dismissButton);

  document.body.appendChild(banner);

  reloadButton.addEventListener('click', () => {
    window.location.reload();
  });
  dismissButton.addEventListener('click', () => {
    banner.remove();
  });
}
