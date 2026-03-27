import {
  initAuth,
  authenticateWithSecret,
  authenticateWithMaster,
  ensureNodeDocument,
  resetNode,
  joinCluster,
  getClusterNodes,
  getNodeId,
} from './auth.js';
import { collectDeviceInfo } from './device-info.js';
import { renderDashboard, destroyDashboard } from './dashboard.js';

// ─── State ───────────────────────────────────────────────────────────
let attempts = 0;
const MAX_ATTEMPTS = 5;

// Expose auth functions for the dashboard to use without circular imports
window.__logswarmAuth = {
  authenticateWithSecret,
  authenticateWithMaster,
  resetNode,
  joinCluster,
  getClusterNodes,
};

// ─── Boot ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const lastError = localStorage.getItem('logswarm_last_error');
  if (lastError) {
    console.error('[LogSwarm] Error from previous attempt:', lastError);
    localStorage.removeItem('logswarm_last_error');
  }
  showLoginScreen();
  if (lastError) {
    setStatus('Previous error: ' + lastError.split('\n')[0], 'error');
  }
});

// ─── Login Screen ────────────────────────────────────────────────────
function showLoginScreen() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <h1 class="logo">LogSwarm</h1>

        <div class="auth-tabs">
          <button class="tab active" data-tab="pin">PIN</button>
          <button class="tab" data-tab="passphrase">Passphrase</button>
          <button class="tab" data-tab="pattern">Pattern</button>
          <button class="tab" data-tab="master">Master</button>
        </div>

        <!-- PIN Tab -->
        <div class="auth-panel active" id="panel-pin">
          <div class="pin-display">
            <input type="text" id="pin-input" readonly placeholder="Enter PIN" />
          </div>
          <div class="pin-pad">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, 'OK']
              .map(
                (k) =>
                  `<button class="pin-key ${
                    k === 'OK' ? 'key-ok' : k === 'C' ? 'key-clear' : ''
                  }" data-key="${k}">${k}</button>`
              )
              .join('')}
          </div>
        </div>

        <!-- Passphrase Tab -->
        <div class="auth-panel" id="panel-passphrase">
          <input type="password" id="passphrase-input" placeholder="Enter passphrase" class="input-full" />
          <button id="passphrase-go" class="btn btn-primary">Authenticate</button>
        </div>

        <!-- Pattern Tab -->
        <div class="auth-panel" id="panel-pattern">
          <div class="pattern-grid" id="pattern-grid">
            ${Array.from(
              { length: 9 },
              (_, i) => `<div class="pattern-dot" data-idx="${i}"></div>`
            ).join('')}
          </div>
          <button id="pattern-go" class="btn btn-primary">Authenticate</button>
          <button id="pattern-clear" class="btn btn-sm">Clear</button>
        </div>

        <!-- Master Tab -->
        <div class="auth-panel" id="panel-master">
          <input type="password" id="master-input" placeholder="Master password" class="input-full" />
          <button id="master-go" class="btn btn-primary">Unlock All Data</button>
        </div>

        <div id="login-status" class="status-bar"></div>
        <p class="attempt-counter" id="attempt-counter"></p>
      </div>
    </div>
  `;

  wireTabs();
  wirePinPad();
  wirePassphrase();
  wirePattern();
  wireMaster();
}

// ─── Tab Switching ───────────────────────────────────────────────────
function wireTabs() {
  document.querySelectorAll('.auth-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tabs .tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.auth-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

// ─── PIN Pad ─────────────────────────────────────────────────────────
function wirePinPad() {
  const input = document.getElementById('pin-input');
  document.querySelectorAll('#panel-pin .pin-key').forEach((key) => {
    key.addEventListener('click', () => {
      const k = key.dataset.key;
      if (k === 'C') {
        input.value = '';
      } else if (k === 'OK') {
        if (input.value) doAuthenticate(input.value, 'pin');
      } else {
        input.value += k;
      }
    });
  });
}

// ─── Passphrase ──────────────────────────────────────────────────────
function wirePassphrase() {
  document.getElementById('passphrase-go')?.addEventListener('click', () => {
    const val = document.getElementById('passphrase-input').value;
    if (val) doAuthenticate(val, 'passphrase');
  });
  document.getElementById('passphrase-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value;
      if (val) doAuthenticate(val, 'passphrase');
    }
  });
}

// ─── Pattern ─────────────────────────────────────────────────────────
function wirePattern() {
  const dots = document.querySelectorAll('#pattern-grid .pattern-dot');
  const pattern = [];

  dots.forEach((dot) => {
    dot.addEventListener('click', () => {
      const idx = dot.dataset.idx;
      if (!pattern.includes(idx)) {
        pattern.push(idx);
        dot.classList.add('active');
      }
    });
  });

  document.getElementById('pattern-clear')?.addEventListener('click', () => {
    pattern.length = 0;
    dots.forEach((d) => d.classList.remove('active'));
  });

  document.getElementById('pattern-go')?.addEventListener('click', () => {
    if (pattern.length >= 3) {
      doAuthenticate(pattern.join('-'), 'pattern');
    } else {
      setStatus('Pattern must be at least 3 dots', 'error');
    }
  });
}

// ─── Master Password ─────────────────────────────────────────────────
function wireMaster() {
  document.getElementById('master-go')?.addEventListener('click', async () => {
    const val = document.getElementById('master-input').value;
    if (!val) return;
    setStatus('Verifying master password…', 'info');
    try {
      await initAuth();
      const ok = await authenticateWithMaster(val);
      if (ok) {
        setStatus('Master access granted', 'success');
        // Also authenticate as a secret for the session
        await doAuthenticate(val, 'master');
      } else {
        attempts++;
        updateAttemptCounter();
        setStatus('Invalid master password', 'error');
        checkMaxAttempts();
      }
    } catch (err) {
      setStatus('Error: ' + err.message, 'error');
    }
  });
  document.getElementById('master-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('master-go')?.click();
  });
}

// ─── Core Authentication Flow ────────────────────────────────────────
async function doAuthenticate(rawSecret, type) {
  setStatus('Authenticating…', 'info');

  try {
    // Ensure we have an anonymous Firebase session
    await initAuth();

    const result = await authenticateWithSecret(rawSecret, type);

    if (result.action === 'reset') {
      setStatus('Resetting node…', 'info');
      return; // Page will reload
    }

    // Collect device info and register/update node
    setStatus('Collecting device info…', 'info');
    const deviceInfo = await collectDeviceInfo();
    await ensureNodeDocument(deviceInfo);

    if (result.action === 'authenticated') {
      setStatus('Secret recognized — loading data…', 'success');
    } else if (result.action === 'new_secret') {
      setStatus('New secret registered — dashboard ready', 'success');
    }

    // Transition to dashboard
    setTimeout(() => {
      transitionToDashboard();
    }, 500);
  } catch (err) {
    console.error('[LogSwarm] Authentication error:', err);
    localStorage.setItem('logswarm_last_error', err.message + '\n' + err.stack);
    attempts++;
    updateAttemptCounter();
    setStatus('Error: ' + err.message, 'error');
    checkMaxAttempts();
  }
}

function checkMaxAttempts() {
  if (attempts >= MAX_ATTEMPTS) {
    setStatus(
      'Max attempts exceeded. Use PIN 6 7 OK to enter as a fresh node.',
      'warning'
    );
    // Auto-switch to PIN tab
    document.querySelector('.tab[data-tab="pin"]')?.click();
  }
}

function updateAttemptCounter() {
  const el = document.getElementById('attempt-counter');
  if (el) el.textContent = `Attempts: ${attempts} / ${MAX_ATTEMPTS}`;
}

// ─── Dashboard Transition ────────────────────────────────────────────
async function transitionToDashboard() {
  const app = document.getElementById('app');
  app.classList.add('fade-out');
  await new Promise((r) => setTimeout(r, 300));
  app.classList.remove('fade-out');
  await renderDashboard(app);
}

// ─── Status Bar ──────────────────────────────────────────────────────
function setStatus(msg, type = 'info') {
  const el = document.getElementById('login-status');
  if (!el) return;
  el.textContent = msg;
  el.className = `status-bar status-${type}`;
}
