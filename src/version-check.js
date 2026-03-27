import { initializeApp } from 'firebase/app';
import { doc, onSnapshot, getFirestore } from 'firebase/firestore';
import firebaseConfig from './firebase-config.js';

const app = initializeApp(firebaseConfig, 'version-check');
const db = getFirestore(app);

let initialCommitSha = null;

export function subscribeToVersion() {
  const ref = doc(db, 'env', 'version');
  onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (initialCommitSha === null) {
      initialCommitSha = data.commitSha;
      return;
    }
    if (data.commitSha !== initialCommitSha) {
      showUpdateBanner(data.version);
    }
  });
}

export function getAppVersion() {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
}

function showUpdateBanner(newVersion) {
  if (document.getElementById('version-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'version-banner';
  const label = newVersion ? `Version ${newVersion} is available.` : 'A new version is available.';
  banner.innerHTML = `
    <span>${label}</span>
    <button id="version-reload">Refresh</button>
    <button id="version-dismiss">\u00d7</button>
  `;
  document.body.appendChild(banner);
  document.getElementById('version-reload').addEventListener('click', () => {
    window.location.reload();
  });
  document.getElementById('version-dismiss').addEventListener('click', () => {
    banner.remove();
  });
}
