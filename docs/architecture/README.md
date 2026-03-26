# Logswarm Architecture Guide

> **Audience:** Coding agents and contributors implementing logswarm components.

Logswarm is a **virtual swarm of service agents** that process heterogeneous data streams in real time. A web-based **dashboard** renders stream data on a full-screen canvas using an event-driven architecture backed by [SpacetimeDB](https://spacetimedb.com/) and [Firebase](https://firebase.google.com/).

---

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      User Device                            │
│  ┌───────────────┐  ┌──────────────────────────────────┐   │
│  │ Input Devices  │──│  Frontend (Canvas Dashboard)      │   │
│  │ (cam, mic, kb) │  │  • Permission gate                │   │
│  └───────────────┘  │  • Auth / 2FA                      │   │
│                      │  • Full-screen GNN-driven canvas   │   │
│                      └──────────┬───────────────────────┘   │
│                                 │  WebSocket / HTTP          │
├─────────────────────────────────┼───────────────────────────┤
│  logswarm daemon                │                            │
│  ┌──────────────────────────────┴────────────────────────┐  │
│  │  Stream Router                                         │  │
│  │  ├─ Space-like streams (display, logs, GUI snapshots)  │  │
│  │  └─ Time-like streams  (audio frequencies, events)     │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  Graph Neural Network (GNN) Engine                     │  │
│  │  • Nodes own canvas regions                            │  │
│  │  • Neural compression of labelled stream data          │  │
│  │  • Message-passing between nodes                       │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  Virtual Agent Swarm                                   │  │
│  │  • Each agent = one GNN node + heartbeat poller        │  │
│  │  • URL-addressable "now-bin" query interface           │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  Backend Adapters                                      │  │
│  │  ├─ SpacetimeDB  (primary multiplayer state)           │  │
│  │  ├─ Firebase     (auth, presence, real-time sync)      │  │
│  │  └─ In-Memory    (development / offline)               │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Document Index

| # | Document | Scope |
|---|----------|-------|
| 1 | [Service Registration](01-service-registration.md) | Install script, systemd unit, configuration |
| 2 | [Frontend Dashboard](02-frontend-dashboard.md) | Canvas rendering, permissions, UI overlays |
| 3 | [Input Streams](03-input-streams.md) | Space-like vs time-like streams, now-bins |
| 4 | [Graph Neural Network](04-graph-neural-network.md) | GNN engine, node canvas ownership, neural compression |
| 5 | [Virtual Agents](05-virtual-agents.md) | Agent lifecycle, heartbeat polling, URL routing |
| 6 | [Backend Integration](06-backend-integration.md) | SpacetimeDB, Firebase, adapter interface |
| 7 | [Authentication](07-authentication.md) | Local device auth, 2FA, trusted device pairing |

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Service daemon | Rust | Memory safety, async runtime (tokio), zero-cost abstractions |
| Frontend | TypeScript + WebGL/Canvas API | GPU-accelerated full-screen rendering |
| Real-time backend | SpacetimeDB | Multiplayer-grade deterministic state sync |
| Auth & presence | Firebase Auth + Realtime DB | Device discovery, push notifications for 2FA |
| GNN engine | Rust (burn / candle) | Native graph neural network inference |
| IPC / messaging | WebSocket + MessagePack | Low-latency binary framing |

---

## Quick Start

```bash
# 1. Build the daemon
cargo build --release

# 2. Install and register the service
sudo ./install.sh

# 3. Open the dashboard
xdg-open http://127.0.0.1:8420
```

---

## Conventions for Coding Agents

1. **One concern per crate/package.** Keep the stream router, GNN engine, agent swarm, and backend adapters in separate Rust crates inside a Cargo workspace.
2. **Event-first.** All inter-component communication goes through typed event channels (tokio broadcast / mpsc). Never share mutable state directly.
3. **Test at the boundary.** Every crate exposes a public API; write integration tests against that API. Unit-test internal algorithms only when they are non-trivial.
4. **Document decisions.** When a design choice deviates from these docs, add an ADR (Architecture Decision Record) in `docs/adr/`.
