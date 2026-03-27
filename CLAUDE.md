# LogSwarm — Development Guide

## Project Structure

- **Frontend** (root): Vite + vanilla JS SPA deployed to Firebase Hosting
- **Dashboard** (`dashboard/`): TypeScript canvas-based dashboard (Lumina protocol)
- **Backend** (Rust): Tokio/Axum WebSocket server (`src/`, `Cargo.toml`)

## Versioning

LogSwarm follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

The version is the **single source of truth** in `package.json` and must be kept in sync with `Cargo.toml`.

### When to bump the version

Every PR that changes user-facing behavior **must** include a version bump. Choose the right level:

| Change type | Bump | Example |
|---|---|---|
| Breaking changes (API, config format, auth flow) | `MAJOR` | `0.1.0` -> `1.0.0` |
| New features, UI additions, new endpoints | `MINOR` | `0.1.0` -> `0.2.0` |
| Bug fixes, styling tweaks, performance improvements | `PATCH` | `0.1.0` -> `0.1.1` |

PRs that only touch tests, CI, docs, or dev tooling do **not** need a version bump.

### How to bump the version

Update the version in **both** files — they must always match:

1. `package.json` — `"version"` field
2. `Cargo.toml` — `version` under `[package]`

Example: bumping from `0.1.0` to `0.2.0`:

```jsonc
// package.json
"version": "0.2.0"
```

```toml
# Cargo.toml
version = "0.2.0"
```

### How versioning reaches users

1. On merge to `main`, CI builds the frontend and deploys to Firebase Hosting.
2. After deploy, CI writes the new version and commit SHA to the Firestore document `env/version`.
3. All connected clients subscribe to `env/version` via a real-time Firestore listener.
4. When the version changes, a banner appears prompting the user to refresh.
5. The current version is displayed on the login screen (bottom of the login card).
6. The build injects `__APP_VERSION__` from `package.json` at compile time via Vite's `define` config.

### Checklist for version bumps

- [ ] `package.json` version updated
- [ ] `Cargo.toml` version updated
- [ ] Both files have the **same** version string

## Git Workflow

**Direct commits and pushes to `main` are not allowed.** A pre-commit hook enforces this locally.

All changes must go through a feature branch and pull request:

1. Create a branch from the current branch: `git checkout -b feature/short-description`
2. Make commits on the feature branch
3. Push and open a PR: `git push -u origin feature/short-description` then `gh pr create`
4. After review/merge, CI auto-deploys to Firebase Hosting

Branch naming conventions:
- `feature/` — new features or enhancements
- `fix/` — bug fixes
- `chore/` — CI, docs, tooling, refactors

## Firebase

- Project: `logswarm-production`
- Hosting serves from `dist/` (Vite build output)
- Firestore rules: `firestore.rules`
- Storage rules: `storage.rules`
- Deploy manually: `npm run deploy`
- CI auto-deploys on push to `main`

## Testing

```bash
npm test            # Root project (Vitest)
cd dashboard && npm test  # Dashboard (Vitest)
cargo test          # Rust backend
```

## CI/CD Pipeline

On push to `main`:
1. JS/TS tests run (root + dashboard)
2. Rust tests run (cargo build + test)
3. If both pass: build frontend, deploy to Firebase Hosting, update `env/version` in Firestore
