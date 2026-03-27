# logswarm Design Document

> Strict design guidelines for contributors and maintainers.

---

## 1. Vision

**logswarm** launches a swarm of worker processes on the local machine,
coordinated by a single coordinator, to execute computational tasks in
parallel.  The entry point is the `logswarm.sh` shell script which resolves
configuration, builds the binary when necessary, and hands control to the Rust
`logswarm` binary.

---

## 2. Architecture Overview

```
┌─────────────┐
│ logswarm.sh │  ← user entry point
└──────┬──────┘
       │  exec
       ▼
┌──────────────┐        ┌────────────┐
│  Coordinator │───────▶│  Worker 1   │
│  (main.rs)   │───────▶│  Worker 2   │
│              │───────▶│  Worker …   │
│              │───────▶│  Worker N   │
└──────────────┘        └────────────┘
       │                      │
       ▼                      ▼
  configs/                assets/
  default.toml            templates/
```

| Component | Responsibility |
|-----------|---------------|
| **logswarm.sh** | Resolve paths, build if needed, launch the coordinator binary. |
| **Coordinator** | Parse config, spawn workers, distribute tasks, collect results. |
| **Workers** | Execute tasks, report results back to the coordinator. |
| **configs/** | Single source of truth for every tunable setting. |
| **assets/** | Shared read-only resources available to all components. |

---

## 3. Strict Design Guidelines

### 3.1 Configuration

| # | Rule |
|---|------|
| C-1 | **Single config file.** All settings live in a single TOML file loaded at startup. No component may define its own private config format. |
| C-2 | **Centralised parsing.** Configuration is parsed once by the coordinator and distributed to workers. Workers never read config files directly. |
| C-3 | **Defaults in code.** Sane defaults are documented in `configs/default.toml` and compiled into `src/config.rs`. A missing key must not crash the program. |
| C-4 | **Override chain.** `defaults → config file → CLI flags`. Later sources win. |
| C-5 | **Validated early.** Config is validated immediately after loading. Invalid values produce a clear error and a non-zero exit code. |

### 3.2 Assets

| # | Rule |
|---|------|
| A-1 | **Read-only.** Assets must be treated as immutable at runtime. No component may write to the `assets/` directory. |
| A-2 | **Relative paths.** Asset paths are always resolved relative to the project root, using the `[assets]` section in the config. |
| A-3 | **Version-controlled.** Every asset is committed to the repository. Generated or binary artefacts belong in `.gitignore`. |
| A-4 | **No duplication.** If a resource is needed by more than one component, it goes in `assets/`. |

### 3.3 Project Structure

| # | Rule |
|---|------|
| S-1 | **Flat module tree.** Top-level modules live in `src/`. Sub-modules are created only when a module exceeds ~300 lines. |
| S-2 | **Public API via `lib.rs`.** `main.rs` is a thin CLI wrapper. All reusable logic is exposed through `src/lib.rs`. |
| S-3 | **No orphan files.** Every file under `src/` must be reachable from `lib.rs` or `main.rs`. |

### 3.4 Code Style

| # | Rule |
|---|------|
| CS-1 | **`cargo fmt`** must pass with zero changes. |
| CS-2 | **`cargo clippy`** must pass with zero warnings (deny all warnings in CI). |
| CS-3 | **Error handling.** Use `Result` types. Panics (`unwrap`, `expect`) are only acceptable in tests and top-level CLI parsing. |
| CS-4 | **Documentation.** Every public item has a doc comment (`///`). Module-level docs use `//!`. |

### 3.5 Testing

| # | Rule |
|---|------|
| T-1 | **Unit tests** live in a `#[cfg(test)]` module inside the file they test. |
| T-2 | **Integration tests** live in `tests/`. |
| T-3 | **Config tests.** The default config must always parse successfully (guarded by a test in `src/config.rs`). |
| T-4 | **Asset tests.** Any code that reads an asset must have a test verifying the asset exists and is well-formed. |

### 3.6 Shell Scripts

| # | Rule |
|---|------|
| SH-1 | **`set -euo pipefail`** at the top of every script. |
| SH-2 | **No hard-coded paths.** Derive paths relative to `$SCRIPT_DIR`. |
| SH-3 | **Quoted variables.** All variable expansions must be double-quoted. |

---

## 4. Directory Layout

```
logswarm/
├── Cargo.toml               # Rust package manifest
├── logswarm.sh              # Shell entry point
├── assets/                  # Shared read-only resources
│   ├── README.md
│   └── templates/           # Task templates, report templates, …
├── configs/                 # Configuration files
│   ├── README.md
│   └── default.toml         # Default configuration
├── docs/                    # Documentation
│   ├── DESIGN.md            # This file
│   └── USAGE.md             # User-facing usage guide
├── src/                     # Rust source code
│   ├── config.rs            # Config types & loader
│   ├── lib.rs               # Library root (re-exports)
│   └── main.rs              # CLI entry point / coordinator
└── tests/                   # Integration tests
```

---

## 5. Contribution Checklist

Before opening a pull request, verify:

- [ ] `cargo fmt --check` passes.
- [ ] `cargo clippy -- -D warnings` passes.
- [ ] `cargo test` passes.
- [ ] `configs/default.toml` is valid (checked by `load_default_config` test).
- [ ] New assets are committed and referenced only via config paths.
- [ ] Documentation (`///` and `//!`) is updated for any public API changes.
- [ ] `logswarm.sh` runs without errors from a clean build.
