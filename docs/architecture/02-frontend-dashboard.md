# 02 — Frontend Dashboard

> **Goal:** A browser-based full-screen canvas that renders all logswarm data streams as an interactive navigation map with UI overlays.

---

## Design Principles

1. **Canvas-first.** The entire viewport is a single `<canvas>` element. All UI (labels, overlays, controls) is rendered on the canvas — no DOM-based widgets except the initial permission/auth dialogs.
2. **GPU-accelerated.** Use WebGL 2 (fallback to Canvas 2D) for rendering graph nodes, edges, and background layers at 60 fps.
3. **Multiplayer-grade sync.** State updates arrive over WebSocket from SpacetimeDB at the same cadence as a multiplayer game tick (≈16–33 ms).
4. **Input-device aware.** On load, request all available input device permissions so the swarm can ingest local sensor data as streams.

---

## Page Lifecycle

```
┌─────────────────────────────────────────┐
│ 1. Load page                            │
│    └─ Request permissions (camera, mic, │
│       accelerometer, gamepad, MIDI …)   │
├─────────────────────────────────────────┤
│ 2. Authenticate                         │
│    └─ Local device fingerprint + 2FA    │
│       (see 07-authentication.md)        │
├─────────────────────────────────────────┤
│ 3. Establish WebSocket                  │
│    └─ Subscribe to stream topics        │
├─────────────────────────────────────────┤
│ 4. Render loop (requestAnimationFrame)  │
│    ├─ Receive state diffs               │
│    ├─ Update GNN node positions         │
│    ├─ Draw background (navigation map)  │
│    ├─ Draw nodes + edges                │
│    ├─ Draw UI overlays (labels, masks)  │
│    └─ Handle input (click, hover, kbd)  │
└─────────────────────────────────────────┘
```

---

## Permission Gate

When the dashboard loads, it immediately requests all available device permissions using the standard browser APIs:

```typescript
// Requested in parallel — the user sees one prompt per category
const streams = await Promise.allSettled([
  navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
  navigator.permissions.query({ name: "accelerometer" }),
  navigator.permissions.query({ name: "gyroscope" }),
  navigator.permissions.query({ name: "magnetometer" }),
  navigator.getGamepads?.(),          // Gamepad API (no prompt)
  navigator.requestMIDIAccess?.(),     // Web MIDI
]);
```

Each granted permission creates a new **input stream** that the swarm can subscribe to. Denied permissions are logged but non-blocking — the dashboard remains usable.

---

## Canvas Architecture

### Layer Stack (bottom → top)

| Z | Layer | Description |
|---|-------|-------------|
| 0 | **Background** | Navigation map — a spatial projection of the full concept space. Rendered as a tiled grid or procedural noise field that shifts as the user navigates. |
| 1 | **Edges** | Connections between GNN nodes, drawn as Bézier curves. Thickness encodes message volume; color encodes latency. |
| 2 | **Nodes** | One rectangle per GNN node. Each node owns a rectangular region and renders its assigned stream content inside that region. |
| 3 | **Labels** | Text overlays on nodes/edges. Labels are editable within a correction time window (see §Labels below). |
| 4 | **Focus Mask** | A semi-transparent overlay that desaturates/dims regions not currently focused by the user's input devices. |
| 5 | **HUD** | Heads-up display: status bar, agent count, stream bandwidth, latency gauges. |

### Focus Mask

Every input device has an associated **attention region** on the canvas:

- **Mouse/touch** — a circular gradient centered on the pointer.
- **Keyboard** — highlights the currently focused node.
- **Gaze tracking** (if available) — ellipse around the gaze point.

The mask modulates **saturation** and **brightness** of all layers beneath it:

```glsl
// Fragment shader excerpt
float focus = smoothstep(outerRadius, innerRadius, dist);
vec3 color  = mix(desaturate(baseColor, 0.7) * 0.4,
                  baseColor,
                  focus);
```

This ensures the user's visual attention is always drawn to the region they are interacting with.

---

## Labels and Correction Windows

Labels are text annotations attached to nodes or edges. They serve as **anchors** that bridge spatial snapshots into a semi-ordered event sequence.

### Lifecycle

1. **Proposed** — A label is auto-generated (e.g., from stream metadata or GNN inference).
2. **Correction window** — For a configurable duration (`label_correction_window_ms`, default 5000 ms), the user can edit or reject the label.
3. **Accepted** — After the window closes, the label becomes the **origin of coordinates** for subsequent neural compression of that stream region.
4. **Immutable** — Accepted labels are written to the event store and cannot be changed (they are referenced by later compressed frames).

```
   proposed ──[user edits]──▶ corrected ──[timeout]──▶ accepted
       │                                                   │
       └──────────[timeout, no edit]───────────────────────┘
```

---

## Rendering Protocol

Each GNN node renders its owned canvas region by receiving **render packages** from the backend:

```typescript
interface RenderPackage {
  /** Protocol identifier: "image/raw", "text/log", "audio/spectrum", … */
  protocol: string;
  /** MIME-like output format hint for the renderer */
  format: string;
  /** Binary payload — interpretation depends on protocol */
  data: ArrayBuffer;
  /** Metadata for layout (position, size, z-index within the node) */
  layout: { x: number; y: number; w: number; h: number };
}
```

A **renderer registry** maps `protocol` → renderer function:

| Protocol | Renderer | Notes |
|----------|----------|-------|
| `image/raw` | WebGL texture blit | Raw pixel data, uploaded as texture |
| `text/log` | Monospace text renderer | Scrolling log lines, syntax highlighted |
| `audio/spectrum` | Bar chart / waveform | Frequency bins drawn as vertical bars |
| `gui/snapshot` | DOM-to-canvas serializer | Rasterized DOM snapshot |
| `graph/adjacency` | Force-directed sub-graph | Recursive mini-graph inside a node |

---

## Coding Agent Tasks

### Task 1: Scaffold the frontend project

- [ ] Initialize a TypeScript project in `frontend/` with Vite.
- [ ] Add dependencies: `typescript`, `vite`, a WebGL helper (e.g., `twgl.js` or raw WebGL).
- [ ] Create the HTML shell: a single `<canvas id="main">` that fills the viewport.

### Task 2: Implement the permission gate

- [ ] On load, request all available device permissions (see snippet above).
- [ ] For each granted stream, emit a `StreamAvailable` event to the WebSocket.
- [ ] Display a minimal permission status overlay while requests are pending.

### Task 3: Implement the render loop

- [ ] Create a `RenderLoop` class driven by `requestAnimationFrame`.
- [ ] Implement the layer stack (background, edges, nodes, labels, focus mask, HUD).
- [ ] Accept `RenderPackage` messages from the WebSocket and dispatch to the renderer registry.

### Task 4: Implement the focus mask

- [ ] Track all active input devices and their attention regions.
- [ ] Write a fragment shader that modulates saturation/brightness based on distance to attention centers.
- [ ] Composite the mask over the node layer.

### Task 5: Implement label correction UI

- [ ] When a label is in the "proposed" state, render an editable text field on the canvas at the label position.
- [ ] Accept keyboard input to edit the label text.
- [ ] On timeout or explicit accept, emit a `LabelAccepted` event and transition the label to immutable rendering.
