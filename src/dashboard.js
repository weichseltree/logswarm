import {
  getNodeId,
  getLinkedSecrets,
  getIsMaster,
  getComputeSpec,
  getSharedData,
  getRoutingConfig,
  updateRoutingConfig,
  subscribeToSharedData,
  getClusterNodes,
  getAllSecrets,
  setSharedData,
} from './auth.js';
import { collectDeviceInfo, subscribeSensors } from './device-info.js';
import { buildDashboardTree, renderTileHTML, spawnTile, createTile, getRootTile } from './tiling.js';
import { selfVerify } from './verification.js';
import { generateGraphSpec } from './crypto-utils.js';

let sensorCleanup = null;
let deviceInfo = null;

export async function renderDashboard(container) {
  deviceInfo = await collectDeviceInfo();
  const spec = window.__logswarmAuth.getComputeSpec();

  // Build tile tree using prime signature
  const root = buildDashboardTree(spec?.signature || []);

  // Add master tile if applicable
  if (getIsMaster()) {
    spawnTile(['network'], createTile({
      id: 'network.master',
      label: 'Master — All Secrets',
      type: 'content',
      contentFn: 'renderMasterSecrets',
      depth: 2,
    }));
  }

  container.innerHTML = `
    <header class="dash-header">
      <h1>LogSwarm Node</h1>
      <span class="node-id" title="Node ID">${getNodeId()?.slice(0, 12)}…</span>
      ${spec ? `<span class="compute-badge" title="Seed: ${spec.seed}, Dims: ${spec.dimensions}">
        ⬡ ${spec.dimensions}D · ${spec.signature.slice(0, 4).join('·')}${spec.signature.length > 4 ? '…' : ''}
      </span>` : ''}
      <button id="btn-add-secret" class="btn btn-sm">+ Add Secret</button>
      <button id="btn-reset" class="btn btn-sm btn-danger">Reset (6 7 OK)</button>
    </header>

    <div class="tile-canvas">
      ${renderTileHTML(root)}
    </div>

    <!-- Add Secret Modal -->
    <dialog id="add-secret-dialog">
      <h3>Add Another Secret</h3>
      <div class="auth-methods">
        <button class="btn method-btn" data-method="pin">PIN Code</button>
        <button class="btn method-btn" data-method="passphrase">Passphrase</button>
        <button class="btn method-btn" data-method="pattern">Pattern</button>
        <button class="btn method-btn" data-method="master">Master Password</button>
      </div>
      <div id="dialog-auth-form"></div>
      <div class="dialog-actions">
        <button id="btn-dialog-close" class="btn btn-sm">Cancel</button>
      </div>
    </dialog>
  `;

  // Populate tile content
  populateTileContent('node.secrets', renderSecretsHTML);
  populateTileContent('node.device', renderDeviceInfoHTML);
  populateTileContent('node.permissions', renderPermissionsHTML);
  populateTileContent('node.sensors', () => '<em>Waiting for sensor data…</em>');
  await populateTileContentAsync('network.shared', renderSharedDataHTML);
  await populateTileContentAsync('network.routing', renderRoutingConfigHTML);
  populateTileContent('network.cluster', renderClusterHTML);
  populateTileContent('compute.spec', () => renderComputeSpecHTML(spec));
  populateTileContent('compute.verify', () => renderVerificationHTML(spec));
  populateTileContent('compute.status', () => renderProofStatusHTML(spec));

  startSensors();
  wireEvents(container);

  if (getIsMaster()) {
    await populateTileContentAsync('network.master', renderMasterSecretsHTML);
  }
}

// ─── Tile Content Helpers ────────────────────────────────────────────
function populateTileContent(tileId, renderFn) {
  const el = document.getElementById(`tile-body-${tileId}`);
  if (el) el.innerHTML = renderFn();
}

async function populateTileContentAsync(tileId, renderFn) {
  const el = document.getElementById(`tile-body-${tileId}`);
  if (el) el.innerHTML = await renderFn();
}

// ─── Secrets List ────────────────────────────────────────────────────
function renderSecretsHTML() {
  const secrets = getLinkedSecrets();

  if (secrets.length === 0) {
    return '<em>No linked secrets yet. Add one to share data.</em>';
  }

  return secrets
    .map(
      (s) => `
    <div class="list-item">
      <span class="badge badge-${s.type || 'pin'}">${s.type || 'pin'}</span>
      <span class="secret-label">${s.label || s.hash?.slice(0, 12) + '…'}</span>
      <code class="hash-preview">${s.hash?.slice(0, 16)}…</code>
    </div>`
    )
    .join('');
}

// Keep old name for re-renders from modal
function renderSecrets() {
  populateTileContent('node.secrets', renderSecretsHTML);
}

// ─── Device Info ─────────────────────────────────────────────────────
function renderDeviceInfoHTML() {
  const flat = flattenObject(deviceInfo, '', ['permissions', 'mediaDevices', 'geolocation']);
  return Object.entries(flat)
    .map(
      ([key, val]) =>
        `<div class="list-item kv"><span class="key">${key}</span><span class="val">${formatValue(val)}</span></div>`
    )
    .join('');
}

// ─── Permissions & Input Sources ─────────────────────────────────────
function renderPermissionsHTML() {
  const perms = deviceInfo.permissions || {};
  const media = deviceInfo.mediaDevices || [];
  const geo = deviceInfo.geolocation || {};

  let html = '<h3>API Permissions</h3>';
  html += Object.entries(perms)
    .map(
      ([name, state]) =>
        `<div class="list-item kv">
          <span class="key">${name}</span>
          <span class="badge perm-${state}">${state}</span>
        </div>`
    )
    .join('');

  html += '<h3>Media Devices</h3>';
  if (media.length === 0) {
    html += '<em>No media devices enumerated</em>';
  } else {
    html += media
      .map(
        (d) =>
          `<div class="list-item kv">
            <span class="badge badge-${d.kind}">${d.kind}</span>
            <span class="val">${d.label}</span>
          </div>`
      )
      .join('');
  }

  html += '<h3>Geolocation</h3>';
  if (geo.error) {
    html += `<em>${geo.error}</em>`;
  } else if (geo.latitude != null) {
    html += `<div class="list-item kv"><span class="key">Latitude</span><span class="val">${geo.latitude}</span></div>`;
    html += `<div class="list-item kv"><span class="key">Longitude</span><span class="val">${geo.longitude}</span></div>`;
    html += `<div class="list-item kv"><span class="key">Accuracy</span><span class="val">${geo.accuracy}m</span></div>`;
    if (geo.altitude != null) {
      html += `<div class="list-item kv"><span class="key">Altitude</span><span class="val">${geo.altitude}m</span></div>`;
    }
  } else {
    html += '<em>Not available</em>';
  }

  return html;
}

// ─── Live Sensors ────────────────────────────────────────────────────
function startSensors() {
  const el = document.getElementById('tile-body-node.sensors');
  if (!el) return;
  const data = {};

  sensorCleanup = subscribeSensors((type, payload) => {
    data[type] = payload;
    el.innerHTML = Object.entries(data)
      .map(
        ([sensorType, vals]) =>
          `<div class="sensor-block">
            <h4>${sensorType}</h4>
            ${Object.entries(vals)
              .filter(([, v]) => v !== null && v !== undefined)
              .map(
                ([k, v]) =>
                  `<div class="list-item kv"><span class="key">${k}</span><span class="val">${
                    typeof v === 'object' ? JSON.stringify(v) : v
                  }</span></div>`
              )
              .join('')}
          </div>`
      )
      .join('');
  });
}

// ─── Shared Data ─────────────────────────────────────────────────────
async function renderSharedDataHTML() {
  const secrets = getLinkedSecrets();

  if (secrets.length === 0) {
    return '<em>No secrets linked — authenticate to view shared data.</em>';
  }

  let html = '';
  for (const secret of secrets) {
    const docs = await getSharedData(secret.hash);
    html += `<div class="shared-group">
      <h3>Secret: ${secret.hash?.slice(0, 12)}… <span class="badge badge-${secret.type}">${secret.type}</span></h3>`;
    if (docs.length === 0) {
      html += '<em>No shared documents</em>';
    } else {
      html += docs
        .map(
          (d) =>
            `<details class="doc-details">
              <summary>${d.id}</summary>
              <pre>${JSON.stringify(d, null, 2)}</pre>
            </details>`
        )
        .join('');
    }
    html += '</div>';

    // Subscribe to live updates
    const el = document.getElementById('tile-body-network.shared');
    subscribeToSharedData(secret.hash, (updatedDocs) => {
      if (!el) return;
      const group = el.querySelector(`[data-secret="${secret.hash}"]`);
      if (!group) return;
      group.innerHTML = updatedDocs
        .map(
          (d) =>
            `<details class="doc-details">
              <summary>${d.id}</summary>
              <pre>${JSON.stringify(d, null, 2)}</pre>
            </details>`
        )
        .join('');
    });
  }
  return html;
}

// ─── Routing Config ──────────────────────────────────────────────────
async function renderRoutingConfigHTML() {
  const config = await getRoutingConfig();

  return `
    <div class="list-item kv">
      <span class="key">Active</span>
      <span class="val"><input type="checkbox" id="routing-active" ${config.active ? 'checked' : ''} /></span>
    </div>
    <div>
      <label>Filters (JSON array)</label>
      <textarea id="routing-filters" rows="3">${JSON.stringify(config.filters || [], null, 2)}</textarea>
    </div>
    <div>
      <label>Routes (JSON array)</label>
      <textarea id="routing-routes" rows="3">${JSON.stringify(config.routes || [], null, 2)}</textarea>
    </div>
    <button id="btn-save-routing" class="btn btn-sm">Save Routing</button>
  `;
}

// ─── Cluster ─────────────────────────────────────────────────────────
function renderClusterHTML() {
  return `
    <div id="cluster-nodes" class="scroll-list"></div>
    <div class="input-row">
      <input id="cluster-id-input" type="text" placeholder="Cluster ID" />
      <button id="btn-join-cluster" class="btn btn-sm">Join</button>
    </div>
  `;
}

// ─── Master Secrets ──────────────────────────────────────────────────
async function renderMasterSecretsHTML() {
  const allSecrets = await getAllSecrets();

  return allSecrets
    .map(
      (s) =>
        `<div class="list-item kv">
          <span class="badge badge-${s.type}">${s.type}</span>
          <code>${s.id?.slice(0, 20)}…</code>
          <span class="val">→ node: ${s.nodeId?.slice(0, 12)}…</span>
        </div>`
    )
    .join('');
}

// ─── Compute Spec ────────────────────────────────────────────────────
function renderComputeSpecHTML(spec) {
  if (!spec) return '<em>No computation spec — authenticate first.</em>';

  const graphSpec = generateGraphSpec(spec.seed, spec.dimensions);

  return `
    <div class="list-item kv"><span class="key">Seed</span><span class="val">${spec.seed}</span></div>
    <div class="list-item kv"><span class="key">Dimensions</span><span class="val">${spec.dimensions}</span></div>
    <div class="list-item kv"><span class="key">Prime Signature</span><span class="val">[${spec.signature.join(', ')}]</span></div>
    <div class="list-item kv"><span class="key">Full Factorization</span><span class="val">[${spec.primes.join(' × ')}]</span></div>
    <div class="list-item kv"><span class="key">Graph Layers</span><span class="val">${graphSpec.layers}</span></div>
    <details class="doc-details">
      <summary>Graph Structure</summary>
      <pre>${JSON.stringify(graphSpec.graph.map(l => ({
        layer: l.layer, op: l.op, in: l.inputDim, out: l.outputDim
      })), null, 2)}</pre>
    </details>
  `;
}

// ─── I/O Verification ────────────────────────────────────────────────
function renderVerificationHTML(spec) {
  if (!spec) return '<em>No spec to verify.</em>';

  const result = selfVerify(spec.seed, spec.dimensions);

  return `
    <div class="list-item kv">
      <span class="key">Status</span>
      <span class="badge ${result.verified ? 'perm-granted' : 'perm-denied'}">${result.verified ? 'VERIFIED' : 'FAILED'}</span>
    </div>
    <div class="list-item kv"><span class="key">Tests Passed</span><span class="val">${result.passed} / ${result.total}</span></div>
    <details class="doc-details">
      <summary>Test Results</summary>
      ${result.results.map((r, i) => `
        <div class="list-item kv">
          <span class="key">Test ${i + 1}</span>
          <span class="badge ${r.passed ? 'perm-granted' : 'perm-denied'}">${r.passed ? 'PASS' : 'FAIL'}</span>
        </div>
      `).join('')}
    </details>
  `;
}

// ─── Proof Status ────────────────────────────────────────────────────
function renderProofStatusHTML(spec) {
  if (!spec) return '<em>No proof generated.</em>';

  const result = selfVerify(spec.seed, spec.dimensions);

  return `
    <div class="proof-summary ${result.verified ? 'proof-verified' : 'proof-failed'}">
      <div class="proof-icon">${result.verified ? '✓' : '✗'}</div>
      <div class="proof-text">
        <strong>${result.verified ? 'Computation Verified' : 'Verification Failed'}</strong>
        <p>${spec.dimensions}-dimensional graph, ${result.total} test cases</p>
        <p>Seed: <code>${spec.seed}</code></p>
      </div>
    </div>
  `;
}

// ─── Events ──────────────────────────────────────────────────────────
function wireEvents(container) {
  const { authenticateWithSecret, authenticateWithMaster, resetNode, joinCluster } =
    // Dynamic import to avoid circular deps
    window.__logswarmAuth;

  document.getElementById('btn-reset')?.addEventListener('click', () => resetNode());

  document.getElementById('btn-add-secret')?.addEventListener('click', () => {
    document.getElementById('add-secret-dialog')?.showModal();
  });

  document.getElementById('btn-dialog-close')?.addEventListener('click', () => {
    document.getElementById('add-secret-dialog')?.close();
  });

  // Auth method buttons inside modal
  container.querySelectorAll('.method-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const method = btn.dataset.method;
      showAuthForm(method);
    });
  });

  // Save routing
  document.getElementById('btn-save-routing')?.addEventListener('click', async () => {
    try {
      const filters = JSON.parse(document.getElementById('routing-filters').value);
      const routes = JSON.parse(document.getElementById('routing-routes').value);
      const active = document.getElementById('routing-active').checked;
      await updateRoutingConfig({ filters, routes, active });
      showToast('Routing config saved');
    } catch (err) {
      showToast('Invalid JSON: ' + err.message, 'error');
    }
  });

  // Join cluster
  document.getElementById('btn-join-cluster')?.addEventListener('click', async () => {
    const clusterId = document.getElementById('cluster-id-input').value.trim();
    if (!clusterId) return;
    await joinCluster(clusterId);
    const nodes = await getClusterNodes(clusterId);
    document.getElementById('cluster-nodes').innerHTML = nodes
      .map((n) => `<div class="list-item">${n.slice(0, 12)}… ${n === getNodeId() ? '(you)' : ''}</div>`)
      .join('');
    showToast('Joined cluster ' + clusterId);
  });
}

function showAuthForm(method) {
  const form = document.getElementById('dialog-auth-form');
  const { authenticateWithSecret, authenticateWithMaster } = window.__logswarmAuth;

  switch (method) {
    case 'pin':
      form.innerHTML = `
        <div class="pin-pad" id="dialog-pin-pad">
          <div class="pin-display"><input type="text" id="dialog-pin-input" readonly placeholder="Enter PIN" /></div>
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, 'OK']
            .map(
              (k) =>
                `<button class="pin-key ${k === 'OK' ? 'key-ok' : k === 'C' ? 'key-clear' : ''}" data-key="${k}">${k}</button>`
            )
            .join('')}
        </div>`;
      wireDialogPinPad(authenticateWithSecret);
      break;

    case 'passphrase':
      form.innerHTML = `
        <input type="password" id="dialog-passphrase" placeholder="Enter passphrase" class="input-full" />
        <button id="dialog-passphrase-go" class="btn">Authenticate</button>`;
      document.getElementById('dialog-passphrase-go').addEventListener('click', async () => {
        const val = document.getElementById('dialog-passphrase').value;
        if (val) {
          const result = await authenticateWithSecret(val, 'passphrase');
          handleAuthResult(result);
        }
      });
      break;

    case 'pattern':
      form.innerHTML = `
        <div class="pattern-grid" id="dialog-pattern-grid">
          ${Array.from({ length: 9 }, (_, i) => `<div class="pattern-dot" data-idx="${i}"></div>`).join('')}
        </div>
        <button id="dialog-pattern-go" class="btn">Authenticate</button>`;
      wirePatternGrid(authenticateWithSecret);
      break;

    case 'master':
      form.innerHTML = `
        <input type="password" id="dialog-master" placeholder="Master password" class="input-full" />
        <button id="dialog-master-go" class="btn">Unlock All</button>`;
      document.getElementById('dialog-master-go').addEventListener('click', async () => {
        const val = document.getElementById('dialog-master').value;
        if (val) {
          const ok = await authenticateWithMaster(val);
          if (ok) {
            showToast('Master access granted');
            document.getElementById('add-secret-dialog')?.close();
            location.reload();
          } else {
            showToast('Invalid master password', 'error');
          }
        }
      });
      break;
  }
}

function wireDialogPinPad(authFn) {
  const input = document.getElementById('dialog-pin-input');
  document.querySelectorAll('#dialog-pin-pad .pin-key').forEach((key) => {
    key.addEventListener('click', async () => {
      const k = key.dataset.key;
      if (k === 'C') {
        input.value = '';
      } else if (k === 'OK') {
        if (input.value) {
          const result = await authFn(input.value, 'pin');
          handleAuthResult(result);
        }
      } else {
        input.value += k;
      }
    });
  });
}

function wirePatternGrid(authFn) {
  const dots = document.querySelectorAll('#dialog-pattern-grid .pattern-dot');
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
  document.getElementById('dialog-pattern-go')?.addEventListener('click', async () => {
    if (pattern.length >= 3) {
      const result = await authFn(pattern.join('-'), 'pattern');
      handleAuthResult(result);
    } else {
      showToast('Pattern must be at least 3 dots', 'error');
    }
  });
}

function handleAuthResult(result) {
  if (result.action === 'reset') {
    return; // Page will reload
  }
  if (result.action === 'authenticated') {
    showToast('Secret linked — access granted');
  } else if (result.action === 'new_secret') {
    showToast('New secret registered');
  } else {
    showToast('Authentication failed', 'error');
  }
  document.getElementById('add-secret-dialog')?.close();
  renderSecrets();
  populateTileContentAsync('network.shared', renderSharedDataHTML);
}

// ─── Toast Notifications ─────────────────────────────────────────────
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Helpers ─────────────────────────────────────────────────────────
function flattenObject(obj, prefix = '', exclude = []) {
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (exclude.includes(key)) continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(result, flattenObject(val, fullKey));
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}

function formatValue(val) {
  if (val === null || val === undefined) return '<em>null</em>';
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'boolean') return val ? '✓' : '✗';
  if (typeof val === 'number') return val.toLocaleString();
  return String(val);
}

export function destroyDashboard() {
  if (sensorCleanup) sensorCleanup();
}
