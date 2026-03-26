# 03 — Input Streams

> **Goal:** Define the two fundamental stream types (space-like and time-like), the now-bin addressing scheme, and the stream routing protocol.

---

## Two Fundamental Stream Types

Every input stream in logswarm is classified as one of two types based on its temporal structure:

### Space-Like Streams

Space-like streams produce **snapshots** — discrete frames with no implicit time ordering. Each frame is a complete spatial representation that can be rendered independently.

| Source | Example data |
|--------|-------------|
| Display/screen capture | Pixel buffer of the current frame |
| Log output | Current tail of a log file |
| GUI state | Serialized widget tree |
| Visualization | SVG/canvas render commands |
| Camera feed | Individual video frames |

**Key property:** A space-like snapshot has no inherent "before" or "after." Two snapshots can be compared but not ordered without an external anchor.

**Labels** provide that anchor. When a label is accepted (see [02-frontend-dashboard.md](02-frontend-dashboard.md#labels-and-correction-windows)), it pins the snapshot to a position in the event sequence, creating an **origin of coordinates** for the GNN's neural compression of subsequent frames in that stream.

### Time-Like Streams

Time-like streams produce **continuous signals** with intrinsic temporal ordering. The canonical example is audio.

| Source | Example data |
|--------|-------------|
| Microphone | PCM audio samples |
| System audio | Loopback capture |
| Sensor fusion | Accelerometer + gyroscope time series |
| Network events | Packet arrival timestamps |

**Key property:** Time-like data is fundamentally non-spatial. Audio frequencies and their instantaneous probability distribution form the **outermost now-sequence ordering**. Each "now" moment is a probability distribution over frequency bins, and the ordering of these moments defines the global timeline.

---

## Now-Bins

A **now-bin** is a discrete time slot in the global event sequence. Now-bins are the atomic unit of time in logswarm.

### Structure

```
Now-Bin
├── timestamp_ns: u64          # Monotonic nanosecond timestamp
├── bin_id: u128               # Cryptographic hash (secret address)
├── frequency_histogram:       # Probability distribution over audio frequency bins
│   [f32; NUM_FREQ_BINS]       #   (from the outermost time-like ordering)
├── space_snapshots:           # Attached space-like snapshots
│   Vec<SpaceSnapshot>         #   (anchored by accepted labels)
└── agent_states:              # State of each virtual agent at this moment
    Vec<AgentState>
```

### Secret Address (bin_id)

Every now-bin has a **secret address** — a 128-bit identifier derived from:

```
bin_id = BLAKE3(
    timestamp_ns ||
    frequency_histogram ||
    previous_bin_id
)
```

This forms a hash chain. The bin_id is the **URL** of the now-bin in the logswarm network. Any agent or external client can query a now-bin by its address.

---

## Query Protocol

A now-bin can be queried with an arbitrary **route** and a single **query package**:

```
GET /now/{bin_id}/{route}
Content-Type: application/msgpack

{
  "protocol": "text/log",
  "format": "ansi",
  "max_size": 4096
}
```

- **`bin_id`** — The secret address of the now-bin.
- **`route`** — An arbitrary path that selects a view into the bin's data (e.g., `/audio/spectrum`, `/logs/stderr`, `/gnn/node/42`).
- **Query package body** — A single MessagePack-encoded object containing:
  - `protocol` — The protocol the caller understands.
  - `format` — The desired output format.
  - `max_size` — Optional size limit.

The response is a **render package** (see [02-frontend-dashboard.md](02-frontend-dashboard.md#rendering-protocol)) that can be directly rendered as part of the UI canvas.

---

## Stream Router

The **stream router** is the central hub that:

1. Receives raw input from all sources (device APIs, network, files).
2. Classifies each input as space-like or time-like.
3. Writes space-like snapshots into a ring buffer per stream.
4. Feeds time-like samples into the frequency analyzer to produce the now-bin histogram.
5. Assembles complete now-bins and publishes them to the event store.

### Data Flow

```
Input Device ──▶ Stream Source ──▶ Stream Router
                                     │
                         ┌───────────┴───────────┐
                         ▼                       ▼
                   Space-Like                Time-Like
                   Ring Buffer             Freq. Analyzer
                         │                       │
                         ▼                       ▼
                   Label Anchor ◀──────── Now-Bin Assembly
                         │                       │
                         └───────────┬───────────┘
                                     ▼
                              Event Store
                         (SpacetimeDB / Firebase)
```

### Ring Buffer

Each space-like stream maintains a fixed-size ring buffer (`ring_buffer_size` from config). When the buffer is full, the oldest un-anchored snapshot is evicted. Anchored snapshots (those pinned by an accepted label) are promoted to the event store before eviction.

---

## Frequency Analysis for Time-Like Streams

Audio and other time-like signals are processed through a sliding-window FFT:

1. **Window** — Hann window of `fft_window_size` samples (default 2048).
2. **FFT** — Real-valued FFT producing `fft_window_size / 2 + 1` frequency bins.
3. **Normalize** — Convert magnitudes to a probability distribution (softmax).
4. **Bin** — The resulting histogram becomes the `frequency_histogram` of the current now-bin.

The histogram is the **clock** of the system. The sequence of histograms defines the global ordering of events.

---

## Coding Agent Tasks

### Task 1: Implement the stream router crate

- [ ] Create `crates/logswarm-streams/src/lib.rs`.
- [ ] Define `StreamSource` trait: `fn poll(&mut self) -> Option<RawFrame>`.
- [ ] Implement `StreamRouter` that accepts `Vec<Box<dyn StreamSource>>` and classifies frames.
- [ ] Implement `RingBuffer<T>` with configurable capacity and eviction callback.

### Task 2: Implement frequency analysis

- [ ] Add `realfft` crate dependency for FFT computation.
- [ ] Implement `FrequencyAnalyzer` that consumes PCM samples and produces histograms.
- [ ] Write property tests: histogram sums to 1.0, pure sine wave peaks at the correct bin.

### Task 3: Implement now-bin assembly

- [ ] Define `NowBin` struct with all fields described above.
- [ ] Implement `bin_id` computation using `blake3`.
- [ ] Implement the query protocol: `fn query(bin: &NowBin, route: &str, package: &QueryPackage) -> RenderPackage`.

### Task 4: Implement stream sources for browser input devices

- [ ] `CameraSource` — wraps `getUserMedia` video track, emits raw pixel frames.
- [ ] `MicrophoneSource` — wraps `getUserMedia` audio track, emits PCM chunks.
- [ ] `GamepadSource` — polls `navigator.getGamepads()`, emits axis/button state frames.
