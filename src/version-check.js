import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './auth.js';

let initialCommitSha = null;

export function subscribeToVersion() {
  const ref = doc(db, 'env', 'version');
  const unsubscribe = onSnapshot(
    ref,
    (snap) => {
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
      console.error('[version-check] Firestore version listener error:', error);
    },
  );
  return unsubscribe;
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
