# 05 — Virtual Agents

> **Goal:** Define the lifecycle, heartbeat mechanism, and URL-based query routing for the virtual service agents in the swarm.

---

## Overview

Every GNN node is simultaneously a **virtual service agent**. The swarm is the set of all agents running within a single logswarm daemon. Agents are lightweight — they share the tokio async runtime and communicate via typed channels.

```
Agent = GNN Node + Heartbeat Poller + URL Query Handler
```

---

## Agent Lifecycle

```
  ┌─────────┐
  │ Created  │  config.agents.count agents are spawned at startup
  └────┬─────┘
       ▼
  ┌─────────┐
  │  Init    │  Load or initialize GNN hidden state
  └────┬─────┘
       ▼
  ┌─────────┐   heartbeat_ms
  │  Active  │◀──────────────────┐
  └────┬─────┘                   │
       │ poll()                  │
       ▼                         │
  ┌─────────┐   success / retry  │
  │ Polling  │───────────────────┘
  └────┬─────┘
       │ fatal error / shutdown signal
       ▼
  ┌─────────┐
  │ Stopped  │  Flush state to event store
  └──────────┘
```

### States

| State | Description |
|-------|-------------|
| **Created** | Agent struct is allocated. No I/O yet. |
| **Init** | GNN hidden state is loaded from the event store (or zero-initialized for new agents). Canvas rect is assigned by the layout algorithm. |
| **Active** | The agent's heartbeat timer is running. It alternates between sleeping and polling. |
| **Polling** | The agent is executing a query against its target now-bin URL. |
| **Stopped** | The agent has been shut down. Its hidden state is flushed to the event store for recovery. |

---

## Heartbeat Polling

Each agent has a **base heartbeat rate** defined by `config.agents.heartbeat_ms`. The effective rate is modulated by:

1. **User attention** — If the agent's canvas region has focus, the rate doubles (poll faster for interactive responsiveness).
2. **Stream activity** — If the assigned streams are producing data rapidly, the rate increases proportionally (up to 4× base).
3. **System load** — If CPU usage exceeds 80%, all agents' rates are halved to prevent overload.

### Poll Cycle

```rust
async fn poll_cycle(&mut self) {
    // 1. Determine the current now-bin
    let bin_id = self.stream_router.current_bin_id();

    // 2. Construct the query URL
    let url = format!("/now/{}/{}", bin_id, self.route);

    // 3. Build the query package
    let package = QueryPackage {
        protocol: self.preferred_protocol.clone(),
        format: self.preferred_format.clone(),
        max_size: self.max_package_size,
    };

    // 4. Execute the query
    let render_package = self.query_handler.query(&url, &package).await?;

    // 5. Feed the render package to the GNN node
    self.gnn_node.ingest(render_package);

    // 6. Run one tick of GNN message passing
    self.gnn_engine.tick_node(self.id);

    // 7. Emit updated canvas content to the frontend
    self.frontend_tx.send(CanvasUpdate {
        node_id: self.id,
        rect: self.gnn_node.canvas_rect,
        content: self.gnn_node.render(),
    });
}
```

---

## URL Routing

Every now-bin is addressable by its `bin_id`. Within a bin, an arbitrary **route** selects a view into the bin's data. Routes are hierarchical, like URL paths:

### Route Table

| Route pattern | Description |
|--------------|-------------|
| `/audio/spectrum` | Frequency histogram of the current now-bin |
| `/audio/waveform` | Raw PCM waveform slice |
| `/logs/{stream_name}` | Latest log lines from a named stream |
| `/display/{stream_name}` | Latest pixel snapshot from a display stream |
| `/gnn/node/{id}` | Hidden state and metadata of a specific GNN node |
| `/gnn/graph` | Full graph adjacency + node positions |
| `/agents/{id}/status` | Health and performance metrics of an agent |
| `/labels/pending` | Labels currently in the correction window |
| `/labels/accepted` | All accepted (immutable) labels |

### Route Resolution

Routes are resolved by a **trie-based router**:

```rust
struct Router {
    trie: Trie<RouteHandler>,
}

impl Router {
    fn resolve(&self, route: &str) -> Option<&RouteHandler> {
        self.trie.get(route)
    }
}
```

Each `RouteHandler` extracts the relevant data from the now-bin, encodes it according to the query package's `protocol` and `format`, and returns a `RenderPackage`.

---

## Agent-to-Agent Communication

Agents communicate through two channels:

### 1. GNN Message Passing (synchronous)

During each tick, the GNN engine runs message passing across all edges. This is the primary mechanism for agents to share context about their stream data and coordinate canvas layouts.

### 2. Direct Channel (asynchronous)

For urgent messages (e.g., "I detected a user click in my region"), agents can send messages directly via tokio mpsc channels:

```rust
struct AgentMessage {
    from: u64,
    to: u64,
    kind: MessageKind,
    payload: Vec<u8>,
}

enum MessageKind {
    InputEvent,        // User interaction forwarded from the frontend
    StreamRedirect,    // "Take over this stream, I'm overloaded"
    LabelProposal,     // "I think this snapshot should be labelled X"
    Shutdown,          // Graceful shutdown request
}
```

---

## Swarm Coordination

The swarm as a whole is managed by a **SwarmCoordinator** that runs alongside the agents:

```rust
struct SwarmCoordinator {
    agents: Vec<Agent>,
    gnn_engine: GnnEngine,
    stream_router: StreamRouter,
    layout_dirty: bool,
}
```

### Responsibilities

1. **Spawn / despawn agents** — Adjusts agent count based on stream topology changes.
2. **Reassign streams** — When a new stream appears, assign it to the least-loaded agent.
3. **Trigger re-layout** — When importance scores change significantly, re-run the canvas layout algorithm.
4. **Aggregate health** — Collect heartbeat success/failure rates for the `/healthz` endpoint.

---

## Coding Agent Tasks

### Task 1: Implement the agent crate

- [ ] Create `crates/logswarm-agents/src/lib.rs`.
- [ ] Define `Agent` struct with all fields described above.
- [ ] Implement the state machine: Created → Init → Active ↔ Polling → Stopped.
- [ ] Implement `poll_cycle` as an async method.

### Task 2: Implement heartbeat rate modulation

- [ ] Base rate from config.
- [ ] Attention multiplier: query the focus mask for overlap with `canvas_rect`.
- [ ] Activity multiplier: compute frames-per-second of assigned streams.
- [ ] Load dampening: read system CPU usage via `sysinfo` crate, halve rate above 80%.

### Task 3: Implement the URL router

- [ ] Create a trie-based `Router` in `crates/logswarm-agents/src/router.rs`.
- [ ] Register all route patterns from the table above.
- [ ] Implement `RouteHandler` trait: `fn handle(&self, bin: &NowBin, package: &QueryPackage) -> RenderPackage`.

### Task 4: Implement agent-to-agent messaging

- [ ] Define `AgentMessage` and `MessageKind`.
- [ ] Each agent holds a `mpsc::Receiver<AgentMessage>` and a map of `mpsc::Sender<AgentMessage>` for peers.
- [ ] Process incoming messages in the `poll_cycle` before the heartbeat query.

### Task 5: Implement the SwarmCoordinator

- [ ] Spawn/despawn logic based on stream count.
- [ ] Stream assignment: round-robin with load balancing.
- [ ] Layout trigger: re-layout when max importance change > 10%.
- [ ] Health aggregation for the `/healthz` endpoint.
