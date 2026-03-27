// ─── Recursive Tiling Engine ─────────────────────────────────────────
// Each tile can contain content or spawn child tiles.
// Tiles are addressed by string IDs (e.g. 'node', 'node.secrets').
// getTileAtPath() accepts an array of string ID segments to navigate the tree,
// e.g. ['node', 'node.secrets'] traverses root → node container → secrets tile.
// Locked tiles are determined by the prime decomposition of the node's seed.

// ─── Tile Data Structure ─────────────────────────────────────────────
/**
 * @typedef {Object} Tile
 * @property {string}   id        - Unique string tile ID (e.g. 'node.secrets', 'network.shared')
 * @property {string}   label     - Display label
 * @property {string}   type      - 'container' | 'content' | 'locked'
 * @property {Tile[]}   children  - Sub-tiles (if container)
 * @property {string}   contentFn - Name of render function for content tiles
 * @property {boolean}  locked    - Whether tile is constant (derived from primes)
 * @property {number}   depth     - Nesting depth
 */

// ─── State ───────────────────────────────────────────────────────────
let rootTile = null;
let activePath = [];
let onNavigate = null;

// ─── Create Tile ─────────────────────────────────────────────────────
export function createTile({ id, label, type = 'content', contentFn = null, locked = false, children = [], depth = 0 }) {
  return { id, label, type, contentFn, locked, children, depth };
}

// ─── Build Default Dashboard Layout ──────────────────────────────────
export function buildDashboardTree(primeSignature) {
  const locked = computeLockedTiles(primeSignature);

  rootTile = createTile({
    id: 'root',
    label: 'LogSwarm',
    type: 'container',
    depth: 0,
    children: [
      createTile({
        id: 'node',
        label: 'Node',
        type: 'container',
        depth: 1,
        children: [
          createTile({ id: 'node.secrets', label: 'Linked Secrets', type: 'content', contentFn: 'renderSecrets', locked: locked.has('node.secrets'), depth: 2 }),
          createTile({ id: 'node.device', label: 'Device Info', type: 'content', contentFn: 'renderDeviceInfo', locked: locked.has('node.device'), depth: 2 }),
          createTile({ id: 'node.permissions', label: 'Permissions', type: 'content', contentFn: 'renderPermissions', locked: locked.has('node.permissions'), depth: 2 }),
          createTile({ id: 'node.sensors', label: 'Live Sensors', type: 'content', contentFn: 'renderSensors', locked: locked.has('node.sensors'), depth: 2 }),
        ],
      }),
      createTile({
        id: 'network',
        label: 'Network',
        type: 'container',
        depth: 1,
        children: [
          createTile({ id: 'network.shared', label: 'Shared Data', type: 'content', contentFn: 'renderSharedData', locked: locked.has('network.shared'), depth: 2 }),
          createTile({ id: 'network.routing', label: 'Routing', type: 'content', contentFn: 'renderRouting', locked: locked.has('network.routing'), depth: 2 }),
          createTile({ id: 'network.cluster', label: 'Cluster', type: 'content', contentFn: 'renderCluster', locked: locked.has('network.cluster'), depth: 2 }),
        ],
      }),
      createTile({
        id: 'compute',
        label: 'Compute',
        type: 'container',
        depth: 1,
        children: [
          createTile({ id: 'compute.spec', label: 'Computation Spec', type: 'content', contentFn: 'renderComputeSpec', locked: locked.has('compute.spec'), depth: 2 }),
          createTile({ id: 'compute.verify', label: 'I/O Verification', type: 'content', contentFn: 'renderVerification', locked: locked.has('compute.verify'), depth: 2 }),
          createTile({ id: 'compute.status', label: 'Proof Status', type: 'content', contentFn: 'renderProofStatus', locked: locked.has('compute.status'), depth: 2 }),
        ],
      }),
    ],
  });

  return rootTile;
}

// ─── Prime-Based Locking ─────────────────────────────────────────────
// The prime decomposition of the seed determines which tiles are constant.
// Each tile ID maps to a prime index. If that prime divides the seed,
// the tile is locked (constant, non-interactive).

const TILE_PRIME_MAP = {
  'node.secrets': 2,
  'node.device': 3,
  'node.permissions': 5,
  'node.sensors': 7,
  'network.shared': 11,
  'network.routing': 13,
  'network.cluster': 17,
  'compute.spec': 19,
  'compute.verify': 23,
  'compute.status': 29,
};

function computeLockedTiles(primeSignature) {
  const locked = new Set();
  if (!primeSignature || primeSignature.length === 0) return locked;

  // The primeSignature is an array of prime factors of the seed
  const factors = new Set(primeSignature);

  for (const [tileId, prime] of Object.entries(TILE_PRIME_MAP)) {
    if (factors.has(prime)) {
      locked.add(tileId);
    }
  }
  return locked;
}

// ─── Navigation ──────────────────────────────────────────────────────
export function getActivePath() {
  return [...activePath];
}

export function setActivePath(path) {
  activePath = [...path];
  if (onNavigate) onNavigate(activePath);
}

export function navigateUp() {
  if (activePath.length > 0) {
    activePath.pop();
    if (onNavigate) onNavigate(activePath);
  }
}

export function onTileNavigate(callback) {
  onNavigate = callback;
}

// ─── Resolve Tile at Path ────────────────────────────────────────────
// path is an array of string tile IDs, e.g. ['node', 'node.secrets'].
// Each segment is matched against child tile IDs at that level.
export function getTileAtPath(path) {
  if (!rootTile) return null;
  let current = rootTile;
  for (const segment of path) {
    const child = current.children?.find((c) => c.id === segment);
    if (!child) return null;
    current = child;
  }
  return current;
}

// ─── Spawn Child Tile ────────────────────────────────────────────────
export function spawnTile(parentPath, tile) {
  const parent = getTileAtPath(parentPath);
  if (!parent || parent.locked) return false;

  // Convert to container if it was content
  if (parent.type === 'content') {
    parent.type = 'container';
    if (!parent.children) parent.children = [];
  }

  tile.depth = parent.depth + 1;
  parent.children.push(tile);
  return true;
}

// ─── Remove Child Tile ───────────────────────────────────────────────
export function removeTile(parentPath, tileId) {
  const parent = getTileAtPath(parentPath);
  if (!parent || !parent.children) return false;

  const idx = parent.children.findIndex((c) => c.id === tileId);
  if (idx === -1) return false;

  const tile = parent.children[idx];
  if (tile.locked) return false;

  parent.children.splice(idx, 1);
  return true;
}

// ─── Get Root ────────────────────────────────────────────────────────
export function getRootTile() {
  return rootTile;
}

// ─── Render Tiling to HTML ───────────────────────────────────────────
export function renderTileHTML(tile, contentRenderers = {}) {
  if (!tile) return '';

  if (tile.type === 'content' || tile.type === 'locked') {
    return `
      <div class="tile tile-content ${tile.locked ? 'tile-locked' : ''}" data-tile-id="${tile.id}" data-depth="${tile.depth}">
        <div class="tile-header">
          <span class="tile-label">${tile.label}</span>
          ${tile.locked ? '<span class="tile-lock-icon">🔒</span>' : ''}
          ${!tile.locked ? `<button class="tile-spawn-btn" data-tile-id="${tile.id}" title="Spawn sub-tile">+</button>` : ''}
        </div>
        <div class="tile-body" id="tile-body-${tile.id}">
          ${contentRenderers[tile.contentFn] ? '' : '<em>Loading…</em>'}
        </div>
      </div>
    `;
  }

  if (tile.type === 'container') {
    const childHTML = (tile.children || []).map((c) => renderTileHTML(c, contentRenderers)).join('');
    return `
      <div class="tile tile-container" data-tile-id="${tile.id}" data-depth="${tile.depth}">
        <div class="tile-header">
          <span class="tile-label">${tile.label}</span>
          <span class="tile-count">${tile.children?.length || 0} tiles</span>
          ${!tile.locked ? `<button class="tile-spawn-btn" data-tile-id="${tile.id}" title="Spawn sub-tile">+</button>` : ''}
        </div>
        <div class="tile-children">
          ${childHTML}
        </div>
      </div>
    `;
  }

  return '';
}
