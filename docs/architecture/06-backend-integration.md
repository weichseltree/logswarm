# 06 — Backend Integration

> **Goal:** Define the adapter interface for event-based backends (SpacetimeDB, Firebase) and the in-memory fallback, enabling multiplayer-grade real-time state synchronization.

---

## Adapter Interface

All backends implement a single `EventStore` trait:

```rust
#[async_trait]
trait EventStore: Send + Sync + 'static {
    /// Append a now-bin to the event log.
    async fn append(&self, bin: &NowBin) -> Result<()>;

    /// Query a now-bin by its secret address.
    async fn get_bin(&self, bin_id: u128) -> Result<Option<NowBin>>;

    /// Subscribe to new now-bins in real time.
    /// Returns a stream that yields bins as they are appended.
    async fn subscribe(&self) -> Result<Pin<Box<dyn Stream<Item = NowBin> + Send>>>;

    /// Store an accepted label (immutable after write).
    async fn store_label(&self, label: &Label) -> Result<()>;

    /// Retrieve labels for a given time range.
    async fn get_labels(&self, from: u64, to: u64) -> Result<Vec<Label>>;

    /// Store/restore GNN node state for crash recovery.
    async fn checkpoint_node(&self, node_id: u64, state: &[u8]) -> Result<()>;
    async fn restore_node(&self, node_id: u64) -> Result<Option<Vec<u8>>>;
}
```

The daemon instantiates the appropriate adapter based on `config.backend.provider`.

---

## SpacetimeDB Adapter

[SpacetimeDB](https://spacetimedb.com/) is a multiplayer database designed for real-time game state. It is the **primary production backend** for logswarm.

### Why SpacetimeDB?

| Requirement | SpacetimeDB Feature |
|-------------|-------------------|
| Sub-frame latency (<16 ms) | In-process WASM reducers, no network hop for local reads |
| Deterministic state sync | All clients see the same state in the same order |
| Multiplayer-grade throughput | Designed for thousands of state updates per second |
| Structured event log | Built-in event sourcing with reducer call log |

### Table Schema

```sql
-- SpacetimeDB module tables

table now_bins {
    bin_id: u128 primary_key,
    timestamp_ns: u64,
    frequency_histogram: bytes,   -- MessagePack-encoded Vec<f32>
    space_snapshots: bytes,       -- MessagePack-encoded Vec<SpaceSnapshot>
    agent_states: bytes,          -- MessagePack-encoded Vec<AgentState>
}

table labels {
    id: u64 primary_key auto_increment,
    bin_id: u128,
    text: string,
    position: bytes,              -- (x, y) in concept space
    accepted_at_ns: u64,
    origin_latent: bytes,         -- The z_origin vector for compression
}

table node_checkpoints {
    node_id: u64 primary_key,
    hidden_state: bytes,
    canvas_rect: bytes,
    updated_at_ns: u64,
}
```

### Reducers

Reducers are server-side functions that mutate state atomically:

```rust
#[spacetimedb::reducer]
fn append_now_bin(ctx: &ReducerContext, bin: NowBin) {
    NowBins::insert(bin);
}

#[spacetimedb::reducer]
fn accept_label(ctx: &ReducerContext, label: Label) {
    Labels::insert(label);
    // Labels are append-only; no update or delete reducer exists.
}

#[spacetimedb::reducer]
fn checkpoint_node(ctx: &ReducerContext, node_id: u64, state: Vec<u8>) {
    if let Some(existing) = NodeCheckpoints::filter_by_node_id(node_id) {
        existing.hidden_state = state;
        existing.updated_at_ns = ctx.timestamp;
    } else {
        NodeCheckpoints::insert(NodeCheckpoint {
            node_id,
            hidden_state: state,
            canvas_rect: vec![],
            updated_at_ns: ctx.timestamp,
        });
    }
}
```

### Client Integration

The Rust daemon connects to SpacetimeDB using the official Rust SDK:

```rust
use spacetimedb_sdk::{subscribe, table, reducer};

struct SpacetimeAdapter {
    connection: spacetimedb_sdk::DbConnection,
}

#[async_trait]
impl EventStore for SpacetimeAdapter {
    async fn append(&self, bin: &NowBin) -> Result<()> {
        self.connection.call_reducer("append_now_bin", bin).await
    }

    async fn subscribe(&self) -> Result<Pin<Box<dyn Stream<Item = NowBin> + Send>>> {
        let rx = self.connection.subscribe("SELECT * FROM now_bins").await?;
        Ok(Box::pin(rx))
    }
    // ... other methods
}
```

---

## Firebase Adapter

[Firebase](https://firebase.google.com/) serves two roles:

1. **Authentication** — Firebase Auth provides the identity layer (see [07-authentication.md](07-authentication.md)).
2. **Presence & real-time sync** — Firebase Realtime Database handles device presence detection and cross-device 2FA signaling.

### Realtime Database Structure

```
/logswarm
  /devices
    /{device_id}
      /presence: true | false
      /last_seen: timestamp
      /capabilities: ["camera", "mic", "gamepad", ...]
  /2fa_challenges
    /{challenge_id}
      /requester_device: device_id
      /responder_device: device_id
      /status: "pending" | "approved" | "denied"
      /created_at: timestamp
      /expires_at: timestamp
  /now_bins  (fallback when SpacetimeDB is unavailable)
    /{bin_id}
      /timestamp_ns: number
      /frequency_histogram: base64
      /space_snapshots: base64
```

### When to Use Firebase vs SpacetimeDB

| Use case | Backend |
|----------|---------|
| Now-bin storage & query | SpacetimeDB (primary) |
| Label storage | SpacetimeDB |
| GNN checkpoints | SpacetimeDB |
| User authentication | Firebase Auth |
| Device presence | Firebase Realtime DB |
| 2FA challenge/response | Firebase Realtime DB |
| Offline/fallback now-bin storage | Firebase Realtime DB |

---

## In-Memory Adapter

For development and testing, an in-memory adapter stores everything in `Arc<RwLock<...>>` collections:

```rust
struct MemoryAdapter {
    bins: Arc<RwLock<HashMap<u128, NowBin>>>,
    labels: Arc<RwLock<Vec<Label>>>,
    checkpoints: Arc<RwLock<HashMap<u64, Vec<u8>>>>,
    subscribers: Arc<RwLock<Vec<broadcast::Sender<NowBin>>>>,
}
```

This adapter is zero-config and requires no external services. It is the default (`config.backend.provider = "memory"`).

---

## Coding Agent Tasks

### Task 1: Define the `EventStore` trait

- [ ] Create `crates/logswarm-backend/src/lib.rs`.
- [ ] Define the `EventStore` trait as shown above.
- [ ] Define shared types: `NowBin`, `Label`, `NodeCheckpoint`.

### Task 2: Implement the in-memory adapter

- [ ] Implement `MemoryAdapter` with `HashMap` + `broadcast::channel` for subscriptions.
- [ ] Write integration tests: append → get, append → subscribe receives, checkpoint round-trip.

### Task 3: Implement the SpacetimeDB adapter

- [ ] Add `spacetimedb-sdk` dependency.
- [ ] Create `crates/logswarm-backend/src/spacetimedb.rs`.
- [ ] Implement `EventStore` for `SpacetimeAdapter`.
- [ ] Write the SpacetimeDB module (reducers + tables) in `spacetimedb-module/`.

### Task 4: Implement the Firebase adapter

- [ ] Add a Firebase REST client (use `reqwest` + Firebase REST API, no native SDK needed).
- [ ] Create `crates/logswarm-backend/src/firebase.rs`.
- [ ] Implement `EventStore` for `FirebaseAdapter` (now-bin operations use Realtime DB).
- [ ] Implement device presence and 2FA challenge helpers (used by the auth module).

### Task 5: Adapter factory

- [ ] Implement `fn create_event_store(config: &BackendConfig) -> Box<dyn EventStore>`.
- [ ] Match on `config.provider` to instantiate the correct adapter.
- [ ] Validate configuration (e.g., SpacetimeDB requires a connection URL, Firebase requires project ID + API key).
