# 04 — Graph Neural Network

> **Goal:** Define the GNN engine that performs neural compression of stream data and controls which part of the UI canvas each node owns.

---

## Role of the GNN

The Graph Neural Network (GNN) is the computational core of logswarm. It serves two functions:

1. **Neural compression** — Compresses high-bandwidth input streams into compact latent representations using the accepted labels as the coordinate origin.
2. **Canvas ownership** — Each GNN node controls a rectangular region of the full-screen UI canvas and is responsible for rendering its assigned streams within that region.

---

## Graph Structure

```
Node ◀──────▶ Node
  │              │
  │   Message    │
  │   Passing    │
  ▼              ▼
Node ◀──────▶ Node
```

- **Nodes** correspond 1:1 with virtual agents.
- **Edges** connect nodes that share context (e.g., two agents processing the same data source, or spatially adjacent canvas regions).
- The graph is **dynamic** — edges are added/removed as stream topology changes.

### Node State

```rust
struct GnnNode {
    /// Unique identifier (matches the agent ID)
    id: u64,
    /// Learnable hidden state vector
    hidden: Vec<f32>,          // dim = config.gnn.hidden_dim
    /// Canvas region this node owns (in normalized [0,1] coordinates)
    canvas_rect: Rect,
    /// Currently assigned input streams
    assigned_streams: Vec<StreamId>,
    /// Accepted labels that define the compression origin
    label_origins: Vec<Label>,
}
```

### Edge State

```rust
struct GnnEdge {
    source: u64,
    target: u64,
    /// Message buffer: accumulated messages to be delivered on next pass
    message_buffer: Vec<f32>,
    /// Visual properties for rendering
    render_props: EdgeRenderProps,
}
```

---

## Message Passing

Each tick of the GNN engine performs `config.gnn.message_passes` rounds of message passing:

### Algorithm (per round)

```
for each node n:
    # 1. Aggregate incoming messages
    m_agg = aggregate([edge.message_buffer for edge in incoming_edges(n)])

    # 2. Update hidden state
    n.hidden = GRU(n.hidden, concat(m_agg, stream_embedding(n)))

    # 3. Produce outgoing messages
    for edge in outgoing_edges(n):
        edge.message_buffer = MLP_message(n.hidden)
```

**Aggregate** function: mean pooling (permutation-invariant).
**GRU**: Gated Recurrent Unit — chosen for its ability to maintain long-range state without vanishing gradients.
**MLP_message**: A 2-layer MLP that transforms the hidden state into a message vector.

### Stream Embedding

Each node's assigned streams are encoded into a fixed-size embedding:

```
stream_embedding(node) = mean([
    encoder(stream.latest_frame)
    for stream in node.assigned_streams
])
```

The `encoder` is protocol-specific:
- `image/raw` → CNN encoder (ResNet-18 backbone, truncated).
- `text/log` → Byte-pair encoding → small transformer.
- `audio/spectrum` → 1D convolution over frequency bins.

---

## Neural Compression

After label acceptance, the GNN uses the label as the **origin of coordinates** and compresses subsequent stream data relative to it:

### Compression Pipeline

```
Raw Frame
    │
    ▼
  Encoder ──▶ Latent Vector (z)
    │
    ▼
  Delta from Origin ──▶ Δz = z - z_origin
    │
    ▼
  Quantize ──▶ Compressed Δz (int8 or lower)
    │
    ▼
  Store in Now-Bin
```

- **z_origin** is the latent vector of the frame that was active when the label was accepted.
- **Δz** captures only the change, which is typically much smaller and more compressible.
- **Quantization** maps float deltas to 8-bit integers using a learned scale factor.

### Decompression (at render time)

```
Compressed Δz
    │
    ▼
  Dequantize ──▶ Δz (float)
    │
    ▼
  z = z_origin + Δz
    │
    ▼
  Decoder ──▶ Reconstructed Frame
```

---

## Canvas Ownership

Each GNN node owns a rectangular sub-region of the full-screen canvas. The layout is determined by a **space-filling algorithm**:

### Layout Algorithm

1. Start with the full canvas `[0,0,1,1]`.
2. For each node, recursively subdivide the remaining space using a **binary tree split**:
   - Split direction alternates between horizontal and vertical.
   - Split ratio is proportional to the node's `importance` score (derived from stream bandwidth + user attention).
3. Assign the resulting rectangle to `node.canvas_rect`.

```
┌──────────────────────────────┐
│          Node A              │
│    (logs, high bandwidth)    │
├───────────────┬──────────────┤
│   Node B      │   Node C     │
│  (camera)     │  (audio)     │
├───────────────┼──────┬───────┤
│   Node D      │ E    │  F    │
│  (gamepad)    │(net) │(misc) │
└───────────────┴──────┴───────┘
```

### Focus and Input Routing

When the user's input device attention region (see [02-frontend-dashboard.md](02-frontend-dashboard.md#focus-mask)) overlaps a node's `canvas_rect`:

1. That node receives **input focus**.
2. User input events (clicks, keystrokes) are routed to that node's agent.
3. The node's rendering priority increases (more GPU time, higher update rate).
4. The focus mask brightens that region and desaturates others.

Multiple nodes can have partial focus if the attention region spans multiple rectangles.

---

## Training

The GNN is trained online in a self-supervised manner:

### Loss Function

```
L = L_reconstruction + λ_compress * L_compression + λ_layout * L_layout

L_reconstruction = MSE(decoded_frame, original_frame)
L_compression    = ||Δz||₁  (L1 sparsity penalty on deltas)
L_layout         = -entropy(attention_distribution)  (encourage even attention spread)
```

### Training Loop

1. Collect a mini-batch of `(frame, label, previous_frames)` tuples from the ring buffers.
2. Forward pass through encoder → GNN message passing → decoder.
3. Compute loss and backpropagate.
4. Update weights with AdamW (learning rate `1e-4`, weight decay `1e-2`).

Training runs continuously in a background thread, consuming at most 20% of available compute.

---

## Coding Agent Tasks

### Task 1: Implement the GNN engine crate

- [ ] Create `crates/logswarm-gnn/src/lib.rs`.
- [ ] Define `GnnNode`, `GnnEdge`, `GnnGraph` structs.
- [ ] Implement message passing with configurable rounds.
- [ ] Use `burn` or `candle` for tensor operations.

### Task 2: Implement protocol-specific encoders

- [ ] `ImageEncoder` — CNN-based, accepts raw pixel buffers, returns latent vector.
- [ ] `TextEncoder` — BPE tokenization + small transformer, returns latent vector.
- [ ] `AudioEncoder` — 1D convolution over frequency bins, returns latent vector.
- [ ] All encoders implement a shared `Encoder` trait: `fn encode(&self, data: &[u8]) -> Vec<f32>`.

### Task 3: Implement neural compression / decompression

- [ ] `compress(frame: &[u8], origin: &[f32], encoder: &dyn Encoder) -> CompressedDelta`.
- [ ] `decompress(delta: &CompressedDelta, origin: &[f32], decoder: &dyn Decoder) -> Vec<u8>`.
- [ ] Write round-trip property tests: `decompress(compress(x)) ≈ x` within quantization tolerance.

### Task 4: Implement canvas layout

- [ ] `fn layout(nodes: &mut [GnnNode], canvas: Rect)` — assigns `canvas_rect` to each node.
- [ ] Importance scoring: `importance(node) = stream_bandwidth(node) * attention_weight(node)`.
- [ ] Write tests: all rects tile the canvas without overlap or gaps.

### Task 5: Implement online training loop

- [ ] Background `tokio::task` that pulls mini-batches from stream ring buffers.
- [ ] Forward/backward pass using the `burn` training API.
- [ ] Rate-limit to 20% CPU usage using `tokio::time::interval`.
