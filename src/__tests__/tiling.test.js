import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTile,
  buildDashboardTree,
  getRootTile,
  getTileAtPath,
  getActivePath,
  setActivePath,
  navigateUp,
  spawnTile,
  removeTile,
  renderTileHTML,
} from '../tiling.js';

// ─── createTile ──────────────────────────────────────────────────────

describe('createTile', () => {
  it('creates a tile with required fields', () => {
    const tile = createTile({ id: 'test', label: 'Test' });
    expect(tile.id).toBe('test');
    expect(tile.label).toBe('Test');
    expect(tile.type).toBe('content');
    expect(tile.locked).toBe(false);
    expect(tile.children).toEqual([]);
  });

  it('accepts all optional fields', () => {
    const tile = createTile({
      id: 'x',
      label: 'X',
      type: 'container',
      contentFn: 'renderX',
      locked: true,
      children: [],
      depth: 5,
    });
    expect(tile.type).toBe('container');
    expect(tile.contentFn).toBe('renderX');
    expect(tile.locked).toBe(true);
    expect(tile.depth).toBe(5);
  });
});

// ─── buildDashboardTree ──────────────────────────────────────────────

describe('buildDashboardTree', () => {
  beforeEach(() => {
    buildDashboardTree([]);
  });

  it('builds a root tile with id "root"', () => {
    const root = getRootTile();
    expect(root.id).toBe('root');
    expect(root.type).toBe('container');
  });

  it('has 3 top-level containers (node, network, compute)', () => {
    const root = getRootTile();
    expect(root.children.length).toBe(3);
    expect(root.children.map((c) => c.id)).toEqual(['node', 'network', 'compute']);
  });

  it('marks tiles as locked when their prime divides the seed', () => {
    // 2 maps to node.secrets, 3 maps to node.device
    buildDashboardTree([2, 3]);
    const root = getRootTile();
    const nodeChildren = root.children[0].children;
    const secrets = nodeChildren.find((c) => c.id === 'node.secrets');
    const device = nodeChildren.find((c) => c.id === 'node.device');
    const permissions = nodeChildren.find((c) => c.id === 'node.permissions');
    expect(secrets.locked).toBe(true);
    expect(device.locked).toBe(true);
    expect(permissions.locked).toBe(false);
  });

  it('leaves all tiles unlocked when primes are empty', () => {
    buildDashboardTree([]);
    const root = getRootTile();
    const allTiles = [];
    function collect(tile) {
      allTiles.push(tile);
      (tile.children || []).forEach(collect);
    }
    collect(root);
    expect(allTiles.filter((t) => t.locked).length).toBe(0);
  });
});

// ─── getTileAtPath ───────────────────────────────────────────────────

describe('getTileAtPath', () => {
  beforeEach(() => {
    buildDashboardTree([]);
  });

  it('returns null for empty root', () => {
    // If we had no buildDashboardTree call, we'd test null.
    // But after build, root exists, so empty path returns root.
    expect(getTileAtPath([])).toBe(getRootTile());
  });

  it('navigates one level deep', () => {
    const tile = getTileAtPath(['node']);
    expect(tile).not.toBeNull();
    expect(tile.id).toBe('node');
  });

  it('navigates two levels deep', () => {
    const tile = getTileAtPath(['node', 'node.secrets']);
    expect(tile).not.toBeNull();
    expect(tile.id).toBe('node.secrets');
  });

  it('returns null for invalid path', () => {
    expect(getTileAtPath(['nonexistent'])).toBeNull();
    expect(getTileAtPath(['node', 'node.missing'])).toBeNull();
  });
});

// ─── Navigation ──────────────────────────────────────────────────────

describe('navigation', () => {
  beforeEach(() => {
    buildDashboardTree([]);
    setActivePath([]);
  });

  it('setActivePath and getActivePath work', () => {
    setActivePath(['node', 'node.secrets']);
    expect(getActivePath()).toEqual(['node', 'node.secrets']);
  });

  it('getActivePath returns a copy', () => {
    setActivePath(['node']);
    const path = getActivePath();
    path.push('extra');
    expect(getActivePath()).toEqual(['node']);
  });

  it('navigateUp removes the last segment', () => {
    setActivePath(['node', 'node.secrets']);
    navigateUp();
    expect(getActivePath()).toEqual(['node']);
  });

  it('navigateUp on empty path is a no-op', () => {
    setActivePath([]);
    navigateUp();
    expect(getActivePath()).toEqual([]);
  });
});

// ─── spawnTile / removeTile ──────────────────────────────────────────

describe('spawnTile / removeTile', () => {
  beforeEach(() => {
    buildDashboardTree([]);
  });

  it('spawns a child tile into a container', () => {
    const child = createTile({ id: 'node.custom', label: 'Custom' });
    const ok = spawnTile(['node'], child);
    expect(ok).toBe(true);
    const parent = getTileAtPath(['node']);
    expect(parent.children.some((c) => c.id === 'node.custom')).toBe(true);
  });

  it('sets depth on spawned tile', () => {
    const child = createTile({ id: 'node.custom', label: 'Custom' });
    spawnTile(['node'], child);
    expect(child.depth).toBe(2);
  });

  it('refuses to spawn into a locked tile', () => {
    buildDashboardTree([2]); // locks node.secrets
    const child = createTile({ id: 'sub', label: 'Sub' });
    const ok = spawnTile(['node', 'node.secrets'], child);
    expect(ok).toBe(false);
  });

  it('removes a child tile', () => {
    const child = createTile({ id: 'node.temp', label: 'Temp' });
    spawnTile(['node'], child);
    const ok = removeTile(['node'], 'node.temp');
    expect(ok).toBe(true);
    const parent = getTileAtPath(['node']);
    expect(parent.children.some((c) => c.id === 'node.temp')).toBe(false);
  });

  it('refuses to remove a locked tile', () => {
    buildDashboardTree([2]); // locks node.secrets
    const ok = removeTile(['node'], 'node.secrets');
    expect(ok).toBe(false);
  });

  it('returns false for nonexistent tile removal', () => {
    expect(removeTile(['node'], 'does.not.exist')).toBe(false);
  });
});

// ─── renderTileHTML ──────────────────────────────────────────────────

describe('renderTileHTML', () => {
  it('returns empty string for null', () => {
    expect(renderTileHTML(null)).toBe('');
  });

  it('renders content tile with data attributes', () => {
    const tile = createTile({ id: 'test', label: 'Test', depth: 1 });
    const html = renderTileHTML(tile);
    expect(html).toContain('data-tile-id="test"');
    expect(html).toContain('data-depth="1"');
    expect(html).toContain('Test');
  });

  it('renders locked tile with lock icon', () => {
    const tile = createTile({ id: 'test', label: 'Locked', locked: true, depth: 0 });
    const html = renderTileHTML(tile);
    expect(html).toContain('🔒');
    expect(html).toContain('tile-locked');
  });

  it('renders container with child count', () => {
    const tile = createTile({
      id: 'parent',
      label: 'Parent',
      type: 'container',
      depth: 0,
      children: [
        createTile({ id: 'c1', label: 'C1', depth: 1 }),
        createTile({ id: 'c2', label: 'C2', depth: 1 }),
      ],
    });
    const html = renderTileHTML(tile);
    expect(html).toContain('2 tiles');
    expect(html).toContain('data-tile-id="c1"');
    expect(html).toContain('data-tile-id="c2"');
  });
});
