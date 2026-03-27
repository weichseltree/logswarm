# LogSwarm — Coding Guidelines

## Project Overview

LogSwarm is a Firebase-powered app for anonymous distributed computation routing. Users authenticate with secrets (PIN, passphrase, pattern) instead of email/password. Every login creates or links to a secret. PIN `6 7 OK` (`"67"`) is the universal fallback that resets all local state and produces a fresh node.

## Tech Stack

- **Frontend**: Vanilla JS (ES modules), Vite bundler
- **Backend**: Firebase (Anonymous Auth, Firestore, Cloud Storage)
- **Crypto**: Web Crypto API (`crypto.subtle.digest`) for SHA-256 hashing
- **Styling**: Plain CSS with CSS custom properties (no framework)

## Architecture Rules

### Module Boundaries

- `auth.js` is the single source of truth for all Firebase interactions and authentication state. All Firestore reads/writes go through this module.
- `dashboard.js` and `app.js` consume `auth.js` exports — they never import Firebase SDK directly.
- `device-info.js` is a pure browser API module with no Firebase dependency.
- `crypto-utils.js` is a pure utility module with no side effects.

### State Management

- Module-level `let` variables in `auth.js` hold the global state (`currentNodeId`, `linkedSecrets`, `isMaster`).
- State is exposed via getter functions (`getNodeId()`, `getLinkedSecrets()`, `getIsMaster()`), never by direct variable export.
- `window.__logswarmAuth` bridges `app.js` and `dashboard.js` to avoid circular imports. Do not add new properties to this object without updating both modules.

### Authentication Flow — Critical Invariants

1. **`"67"` always triggers `resetNode()`.** This check must be the first condition in `authenticateWithSecret()`. Never add validation that could prevent this.
2. **Users are never locked out.** `MAX_ATTEMPTS` is a UI hint, not a hard block. The PIN pad must always remain functional.
3. **Secrets are one-way hashed.** Plaintext secrets must never be stored in Firestore. Only the SHA-256 hex digest appears in documents.
4. **Every new secret auto-registers.** If a hash doesn't exist in `/secrets`, create it. Never return an error for "unknown secret."

### Firestore Patterns

- Always use `serverTimestamp()` for timestamp fields, never `new Date()` or `Date.now()`.
- Use `{ merge: true }` with `setDoc` when updating documents that may or may not exist.
- Document IDs in `/secrets` and `/shared` are SHA-256 hex hashes. These are deterministic and stable.
- Node document IDs in `/nodes` are Firebase Auth UIDs.
- Sub-collections (`/nodes/{uid}/linkedSecrets/`) keep per-node data isolated.

### Security Rules Alignment

Code must match the Firestore security rules in `firestore.rules`:
- A secret's `nodeId` field must equal `request.auth.uid` or the write will be rejected.
- Shared data writes require the caller to be the secret's owner node.
- Cluster documents can be created by any authenticated user but never deleted.
- Master config is read-only from the client.

## Code Style

### JavaScript

- ES modules (`import`/`export`), no CommonJS.
- Use `async`/`await` over raw Promises. Chain with `.then()` only when composing multiple independent operations.
- Prefer `const` by default, `let` only for variables that change. Never use `var`.
- Use section-separator comments (`// ─── Section Name ───`) to organize large files. Keep the style consistent with existing files.
- Template literals for HTML generation. Escape user-provided values displayed in the DOM.
- Destructure imports at the top of each module.

### CSS

- All colors, radii, and spacing tokens are CSS custom properties in `:root` (see `styles.css`).
- Use the existing `var(--name)` tokens. Do not introduce hex/rgb literals.
- BEM-like flat class names (`.card`, `.btn-primary`, `.list-item`). No deep nesting.
- Responsive breakpoint at `600px` — single-column layout below that.

### HTML

- All HTML is generated in JS via template literals. There is no template engine.
- The only physical HTML file is `index.html`, which contains a single `<div id="app">` mount point.
- Use `<dialog>` for modals with `.showModal()` / `.close()`.

## Adding New Features

### New Authentication Method

1. Add a tab button in `showLoginScreen()` in `app.js`.
2. Add a panel `<div class="auth-panel" id="panel-{name}">` with its form.
3. Wire the form to call `doAuthenticate(rawValue, '{name}')` — the auth pipeline handles the rest.
4. Add a corresponding button in the dashboard's `showAuthForm()` switch statement.

### New Dashboard Section

1. Add a `<section class="card">` in the `renderDashboard()` template in `dashboard.js`.
2. Create a `renderNewSection()` function and call it from `renderDashboard()`.
3. If it needs live updates, use `onSnapshot` and track the unsubscriber.

### New Firestore Collection

1. Add a match rule in `firestore.rules`.
2. Add accessor functions in `auth.js`.
3. If queried with compound conditions, add a composite index in `firestore.indexes.json`.

### New Device Sensor

1. Add the async reader in `device-info.js` (`collectDeviceInfo()`).
2. For live data, add an event listener in `subscribeSensors()` and call the callback with a type string.
3. The dashboard picks it up automatically through the existing sensor rendering loop.

## Testing

Tests use **Vitest** (compatible with Vite). Run from either workspace:

```bash
npm test              # root — crypto-utils.test.js, tiling.test.js
cd dashboard && npm test  # Lumina — checksum, hamming, color, packet
```

Test files live alongside source in `__tests__/` directories:
- `src/__tests__/crypto-utils.test.js` — SHA-256 hashing, prime factorisation, seeded PRNG, graph spec
- `src/__tests__/tiling.test.js` — tile creation, tree building, navigation, spawn/remove, HTML rendering
- `dashboard/src/__tests__/checksum.test.ts` — XOR checksum
- `dashboard/src/__tests__/hamming.test.ts` — Hamming(7,4) encode/decode + error correction
- `dashboard/src/__tests__/color.test.ts` — RGB classification into protocol colors
- `dashboard/src/__tests__/packet.test.ts` — Packet round-trip, corruption detection

CI runs automatically via `.github/workflows/ci.yml` on every PR and push to `main`.

When adding new tests:
- Mock Firebase with `firebase/testing` or a Firestore emulator.
- Device-info tests should mock `navigator` APIs.
- Test the `hashSecret()` function with known SHA-256 vectors.

## Common Pitfalls

- **Circular imports**: `dashboard.js` cannot import from `app.js`. Use `window.__logswarmAuth` if dashboard needs auth functions that originate in `app.js`.
- **Firestore rule denials**: If a write fails silently, check that the `nodeId` field matches `request.auth.uid` exactly. The Auth UID is only available after `initAuth()` resolves.
- **Sensor permissions**: Most sensors require HTTPS in production. The Vite dev server serves HTTP — some sensors will return errors or null values during local development.
- **IndexedDB cleanup**: `indexedDB.databases()` is not available in all browsers. The `resetNode()` function handles this gracefully with optional chaining.

## Build & Deploy

```bash
npm run dev       # Local dev server (port 3000)
npm run build     # Production build → dist/
npm run deploy    # Build + firebase deploy
```

Deploy rules separately: `firebase deploy --only firestore,storage`
