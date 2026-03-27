/**
 * Receiver module — manages camera input, runs the detection pipeline
 * frame-by-frame, and feeds results into the render loop.
 *
 * Replaces the old grid-based approach with automatic object detection.
 */

import { DetectionPipeline, type DetectionEvent } from './detection/index.js';
import { RenderLoop } from './renderer/loop.js';

export type ReceiverEventCallback = (events: DetectionEvent[]) => void;

export class Receiver {
  private video: HTMLVideoElement;
  private workCanvas: HTMLCanvasElement;
  private workCtx: CanvasRenderingContext2D;
  private pipeline: DetectionPipeline;
  private renderLoop: RenderLoop;
  private running = false;
  private animFrame = 0;
  private onEvents: ReceiverEventCallback | null = null;

  /** Available cameras. */
  cameras: MediaDeviceInfo[] = [];
  selectedCamera = '';

  constructor(renderLoop: RenderLoop) {
    this.renderLoop = renderLoop;
    this.pipeline = new DetectionPipeline();

    // Hidden video element for camera feed
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;

    // Hidden canvas for frame extraction
    this.workCanvas = document.createElement('canvas');
    const ctx = this.workCanvas.getContext('2d', {
      willReadFrequently: true,
    });
    if (!ctx) throw new Error('Cannot create 2D context for frame extraction');
    this.workCtx = ctx;
  }

  /** Call to receive decoded packet events. */
  onPacketEvents(cb: ReceiverEventCallback): void {
    this.onEvents = cb;
  }

  /** Enumerate available cameras. */
  async enumerateCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.cameras = devices.filter((d) => d.kind === 'videoinput');
    if (this.cameras.length > 0 && !this.selectedCamera) {
      // Prefer back/environment camera
      const back = this.cameras.find(
        (d) =>
          d.label.toLowerCase().includes('back') ||
          d.label.toLowerCase().includes('environment'),
      );
      this.selectedCamera = back
        ? back.deviceId
        : this.cameras[0].deviceId;
    }
    return this.cameras;
  }

  /** Start receiving (activates camera + detection loop). */
  async start(): Promise<void> {
    if (this.running) return;

    const constraints: MediaStreamConstraints = {
      video: this.selectedCamera
        ? { deviceId: { exact: this.selectedCamera }, frameRate: { ideal: 60 } }
        : { facingMode: 'environment', frameRate: { ideal: 60 } },
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = stream;
    await this.video.play();

    this.running = true;
    this.renderLoop.setVideoSource(this.video);
    this.renderLoop.updateHUD({ isReceiving: true });

    // Start frame processing loop
    this.processLoop();
  }

  /** Stop receiving (stops camera + detection). */
  stop(): void {
    this.running = false;
    if (this.animFrame) cancelAnimationFrame(this.animFrame);

    if (this.video.srcObject) {
      for (const track of (this.video.srcObject as MediaStream).getTracks()) {
        track.stop();
      }
      this.video.srcObject = null;
    }

    this.renderLoop.setVideoSource(null);
    this.renderLoop.updateHUD({ isReceiving: false, trackCount: 0 });
    this.pipeline.reset();
  }

  /** Switch camera by device ID. Restarts if currently running. */
  async switchCamera(deviceId: string): Promise<void> {
    this.selectedCamera = deviceId;
    if (this.running) {
      this.stop();
      await this.start();
    }
  }

  private processLoop = (): void => {
    if (!this.running) return;
    this.animFrame = requestAnimationFrame(this.processLoop);

    const video = this.video;
    if (video.readyState < video.HAVE_ENOUGH_DATA) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) return;

    // Draw video onto work canvas to extract pixels
    if (this.workCanvas.width !== vw || this.workCanvas.height !== vh) {
      this.workCanvas.width = vw;
      this.workCanvas.height = vh;
    }
    this.workCtx.drawImage(video, 0, 0, vw, vh);
    const imageData = this.workCtx.getImageData(0, 0, vw, vh);

    // Run detection pipeline
    const t0 = performance.now();
    const events = this.pipeline.processFrame(imageData.data, vw, vh);
    const pipelineMs = performance.now() - t0;

    // Update render loop
    const sources = this.pipeline.getTrackedSources();
    this.renderLoop.updateTrackedSources(sources);
    this.renderLoop.setDetectionScale(vw >> 1, vh >> 1);
    this.renderLoop.updateHUD({
      trackCount: this.pipeline.trackCount,
      pipelineMs,
    });

    // Emit events
    if (events.length > 0 && this.onEvents) {
      this.onEvents(events);
    }
  };

  get isRunning(): boolean {
    return this.running;
  }
}
