/**
 * Canvas-first render loop.
 *
 * Drives the 6-layer rendering stack via requestAnimationFrame.
 * All UI is drawn onto a single <canvas> — no DOM widgets.
 */

import type { TrackedSource } from '../detection/index.js';
import { kalmanPosition } from '../detection/tracker.js';

// ── Layer indices ────────────────────────────────────────────────────
// 0  Background (video / navigation map)
// 1  Edges (reserved for GNN graph edges)
// 2  Nodes (tracked source overlays)
// 3  Labels (label correction UI)
// 4  Focus mask (attention region)
// 5  HUD (status bar, gauges)

export interface HUDState {
  isReceiving: boolean;
  isTransmitting: boolean;
  trackCount: number;
  fps: number;
  pipelineMs: number;
  lastEvent: string | null;
  flashColor: string | null;
}

export class RenderLoop {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animFrame = 0;
  private running = false;
  private lastFrameTime = 0;
  private frameCount = 0;
  private fpsTimer = 0;
  private currentFps = 0;

  // State provided externally each frame
  private videoFrame: HTMLVideoElement | null = null;
  private trackedSources: TrackedSource[] = [];
  private hud: HUDState = {
    isReceiving: false,
    isTransmitting: false,
    trackCount: 0,
    fps: 0,
    pipelineMs: 0,
    lastEvent: null,
    flashColor: null,
  };

  /** Ratio to scale half-res detection coordinates to canvas coordinates. */
  private scaleX = 1;
  private scaleY = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.fpsTimer = this.lastFrameTime;
    this.tick(this.lastFrameTime);
  }

  stop(): void {
    this.running = false;
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
  }

  // ── External state updates ──────────────────────────────────────────

  setVideoSource(video: HTMLVideoElement | null): void {
    this.videoFrame = video;
  }

  updateTrackedSources(sources: TrackedSource[]): void {
    this.trackedSources = sources;
  }

  updateHUD(partial: Partial<HUDState>): void {
    Object.assign(this.hud, partial);
  }

  /**
   * Set the scale factors to convert half-resolution detection
   * coordinates to full canvas coordinates.
   */
  setDetectionScale(halfW: number, halfH: number): void {
    this.scaleX = this.canvas.width / halfW;
    this.scaleY = this.canvas.height / halfH;
  }

  // ── Render tick ─────────────────────────────────────────────────────

  private tick = (now: number): void => {
    if (!this.running) return;
    this.animFrame = requestAnimationFrame(this.tick);

    // FPS counter
    this.frameCount++;
    if (now - this.fpsTimer >= 1000) {
      this.currentFps = this.frameCount;
      this.frameCount = 0;
      this.fpsTimer = now;
    }
    this.hud.fps = this.currentFps;

    const { canvas, ctx } = this;

    // Resize canvas to device pixels
    const dpr = window.devicePixelRatio || 1;
    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;
    const w = Math.round(displayW * dpr);
    const h = Math.round(displayH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Layer 0: Background
    this.drawBackground(displayW, displayH);

    // Layer 1: Edges (placeholder)
    // Layer 2: Nodes (detected sources)
    this.drawNodes(displayW, displayH);

    // Layer 3: Labels (placeholder for correction UI)

    // Layer 4: Focus mask / vignette
    this.drawVignette(displayW, displayH);

    // Layer 5: HUD
    this.drawHUD(displayW, displayH);

    ctx.restore();
    this.lastFrameTime = now;
  };

  // ── Layer 0: Background ─────────────────────────────────────────────

  private drawBackground(w: number, h: number): void {
    const { ctx } = this;

    if (this.hud.isTransmitting && this.hud.flashColor) {
      // Fullscreen flash for transmitting
      ctx.fillStyle = this.hud.flashColor;
      ctx.fillRect(0, 0, w, h);
      // TRANSMITTING label
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.min(w, h) * 0.06}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalCompositeOperation = 'difference';
      ctx.fillText('TRANSMITTING', w / 2, h / 2);
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    if (this.videoFrame && this.hud.isReceiving) {
      const video = this.videoFrame;
      if (video.readyState >= video.HAVE_ENOUGH_DATA) {
        // Draw video covering the canvas
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const scale = Math.max(w / vw, h / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
        return;
      }
    }

    // Idle: dark background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
  }

  // ── Layer 2: Detected source overlays ─────────────────────────────

  private drawNodes(_w: number, _h: number): void {
    if (this.hud.isTransmitting) return;

    const { ctx, trackedSources, scaleX, scaleY } = this;

    for (const source of trackedSources) {
      const { bbox, protocol, confidence, id } = source;
      const predicted = kalmanPosition(source.kalman);

      // Scale from half-res detection coordinates to display coordinates
      const bx = bbox.x * scaleX;
      const by = bbox.y * scaleY;
      const bw = bbox.w * scaleX;
      const bh = bbox.h * scaleY;

      const isActive = protocol.isReceivingPacket;
      const hasResult =
        Date.now() - protocol.lastUpdate < 4000 && protocol.lastDecoded;

      if (!isActive && !hasResult && confidence < 0.2) continue;

      // Bounding box
      const alpha = Math.max(0.3, confidence);
      ctx.strokeStyle = isActive
        ? `rgba(16, 185, 129, ${alpha})`
        : `rgba(59, 130, 246, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);

      // Corner accents (top-left, top-right, bottom-left, bottom-right)
      const accentLen = Math.min(12, bw * 0.2, bh * 0.2);
      ctx.lineWidth = 3;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(bx, by + accentLen);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + accentLen, by);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(bx + bw - accentLen, by);
      ctx.lineTo(bx + bw, by);
      ctx.lineTo(bx + bw, by + accentLen);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(bx, by + bh - accentLen);
      ctx.lineTo(bx, by + bh);
      ctx.lineTo(bx + accentLen, by + bh);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(bx + bw - accentLen, by + bh);
      ctx.lineTo(bx + bw, by + bh);
      ctx.lineTo(bx + bw, by + bh - accentLen);
      ctx.stroke();

      // Kalman predicted centroid crosshair (faint)
      const px = predicted.x * scaleX;
      const py = predicted.y * scaleY;
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.3})`;
      ctx.lineWidth = 1;
      const crossSize = 6;
      ctx.beginPath();
      ctx.moveTo(px - crossSize, py);
      ctx.lineTo(px + crossSize, py);
      ctx.moveTo(px, py - crossSize);
      ctx.lineTo(px, py + crossSize);
      ctx.stroke();

      // Label background
      const labelH = 18;
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.8})`;
      ctx.fillRect(bx, by - labelH - 2, bw, labelH);

      // Label text
      ctx.fillStyle = isActive
        ? `rgba(16, 185, 129, ${alpha})`
        : `rgba(59, 130, 246, ${alpha})`;
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const statusText = isActive
        ? 'SYNCING...'
        : protocol.lastDecoded || '—';
      ctx.fillText(
        `${id}: ${statusText}`,
        bx + 4,
        by - labelH / 2 - 2,
      );

      // Confidence bar
      const barW = bw * confidence;
      ctx.fillStyle = isActive
        ? 'rgba(16, 185, 129, 0.4)'
        : 'rgba(59, 130, 246, 0.3)';
      ctx.fillRect(bx, by + bh + 2, barW, 3);
    }
  }

  // ── Layer 4: Vignette / focus mask ────────────────────────────────

  private drawVignette(w: number, h: number): void {
    if (this.hud.isTransmitting || !this.hud.isReceiving) return;

    const { ctx } = this;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);

    const grad = ctx.createRadialGradient(cx, cy, maxR * 0.35, cx, cy, maxR);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // ── Layer 5: HUD ──────────────────────────────────────────────────

  private drawHUD(w: number, h: number): void {
    if (this.hud.isTransmitting) return;

    const { ctx, hud } = this;
    const pad = 12;
    const barH = 32;

    // Top bar background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, w, barH);

    // Protocol name
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('LUMINA PROTOCOL', pad, barH / 2);

    // Right side stats
    ctx.textAlign = 'right';
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px monospace';

    const stats: string[] = [];
    if (hud.isReceiving) stats.push('● SCANNING');
    stats.push(`${hud.trackCount} SRC`);
    stats.push(`${hud.fps} FPS`);
    if (hud.pipelineMs > 0) stats.push(`${hud.pipelineMs.toFixed(1)}ms`);

    ctx.fillText(stats.join('  │  '), w - pad, barH / 2);

    // Receiving indicator (pulsing dot)
    if (hud.isReceiving) {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      const dotX = pad + ctx.measureText('LUMINA PROTOCOL').width + 12;
      ctx.arc(dotX, barH / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Bottom bar: last event
    if (hud.lastEvent) {
      const bottomBarH = 24;
      const bottomY = h - bottomBarH;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, bottomY, w, bottomBarH);
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(hud.lastEvent, w / 2, bottomY + bottomBarH / 2);
    }
  }
}
