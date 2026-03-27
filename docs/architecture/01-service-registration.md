# 01 — Service Registration

> **Goal:** Provide a single `install.sh` script that builds, installs, and registers logswarm as a long-running system service.

---

## Overview

The install script (`install.sh` at the repository root) performs the following:

1. **Detect platform** — OS and architecture for cross-compilation support.
2. **Build or locate the binary** — Compile from source via `cargo build --release` or use a pre-built binary.
3. **Create a dedicated system user** — `logswarm`, with no login shell and no home directory.
4. **Install files** — Binary to `/opt/logswarm/`, configuration to `/etc/logswarm/`, data to `/var/lib/logswarm/`.
5. **Register a systemd unit** — Enable and start the `logswarm.service`.

---

## Directory Layout After Install

```
/opt/logswarm/
  logswarm              # Main daemon binary

/etc/logswarm/
  config.toml           # Service configuration

/var/lib/logswarm/      # Persistent data (GNN checkpoints, stream state)
/var/log/logswarm/      # Log files (when not using journald)
```

---

## Configuration Reference (`config.toml`)

```toml
[service]
node_id = ""                     # Auto-generated UUID on first run
dashboard_bind = "127.0.0.1:8420"

[agents]
count = 8                        # Virtual agents in the swarm
heartbeat_ms = 1000              # Base polling interval per agent

[backend]
provider = "memory"              # "spacetimedb" | "firebase" | "memory"

[streams]
max_streams = 64
ring_buffer_size = 4096          # Events per stream ring buffer

[gnn]
hidden_dim = 128                 # Hidden dimension for GNN layers
message_passes = 3               # Message-passing rounds per tick
```

Each section maps directly to a Rust crate in the workspace:

| Section | Crate | Responsibility |
|---------|-------|---------------|
| `[service]` | `logswarm-core` | Daemon lifecycle, HTTP server |
| `[agents]` | `logswarm-agents` | Virtual agent swarm |
| `[backend]` | `logswarm-backend` | SpacetimeDB / Firebase adapters |
| `[streams]` | `logswarm-streams` | Stream router, ring buffers |
| `[gnn]` | `logswarm-gnn` | Graph neural network engine |

---

## Systemd Unit Highlights

```ini
[Service]
Type=notify          # Daemon signals readiness via sd_notify
Restart=on-failure
WatchdogSec=30s      # Heartbeat watchdog — daemon must ping systemd every 30 s

# Sandboxing
ProtectSystem=strict
ReadWritePaths=/var/lib/logswarm /var/log/logswarm
NoNewPrivileges=true
PrivateTmp=true
```

### Why `Type=notify`?

The daemon performs async startup (loading GNN weights, connecting to SpacetimeDB). Using `notify` lets systemd know when the service is actually ready to accept connections, preventing dependent services from racing.

---

## Coding Agent Tasks

### Task 1: Implement `logswarm-core` daemon entry point

- [ ] Create `crates/logswarm-core/src/main.rs`.
- [ ] Parse `config.toml` using `serde` + `toml`.
- [ ] Bind an HTTP/WebSocket server on `dashboard_bind` (use `axum`).
- [ ] Send `sd_notify(READY=1)` after initialization.
- [ ] Implement graceful shutdown on `SIGTERM`.

### Task 2: Add health-check endpoint

- [ ] `GET /healthz` returns `200 OK` with JSON body `{ "status": "ok", "agents": <count>, "uptime_s": <seconds> }`.
- [ ] Wire the systemd watchdog: spawn a background task that calls `sd_notify(WATCHDOG=1)` every `WatchdogSec / 2`.

### Task 3: Cross-platform install fallback

- [ ] Detect when systemd is unavailable (e.g., macOS, WSL1).
- [ ] Generate a `launchd` plist on macOS.
- [ ] Print manual instructions on unsupported platforms.
