/**
 * logswarm dashboard — main entry point.
 *
 * Canvas-first UI: entire viewport is a single <canvas>. All interaction
 * is via keyboard shortcuts and the detection pipeline.
 *
 * Keyboard controls:
 *   R       — Toggle receiver (camera + detection)
 *   T       — Open transmit prompt (type message, Enter to send, Esc to cancel)
 *   1/2/3   — Set baud rate (Fast/Standard/Slow)
 *   C       — Cycle cameras
 *   Esc     — Stop current action
 */

import { RenderLoop } from './renderer/loop.js';
import { Receiver } from './receiver.js';
import { Transmitter } from './transmitter.js';
import { WsClient } from './ws.js';
import { authenticate } from './auth.js';
import { requestAllPermissions } from './permissions.js';
import type { DetectionEvent } from './detection/index.js';

// ── Bootstrap ───────────────────────────────────────────────────────

const canvas = document.getElementById('main') as HTMLCanvasElement;
if (!canvas) throw new Error('Canvas #main not found');

const renderLoop = new RenderLoop(canvas);
const receiver = new Receiver(renderLoop);
const transmitter = new Transmitter(renderLoop);
const wsClient = new WsClient();

// Log ring buffer (last 30 events)
const logRing: string[] = [];
function log(msg: string): void {
  logRing.push(msg);
  if (logRing.length > 30) logRing.shift();
  renderLoop.updateHUD({ lastEvent: msg });
  console.log(`[dashboard] ${msg}`);
}

// ── Permission gate + auth ──────────────────────────────────────────

async function init(): Promise<void> {
  renderLoop.start();

  log('Requesting permissions...');
  const perms = await requestAllPermissions();
  log(
    `Permissions — cam:${perms.camera} mic:${perms.microphone} gyro:${perms.gyroscope}`,
  );

  // Enumerate cameras after permission is granted
  if (perms.camera === 'granted') {
    await receiver.enumerateCameras();
    log(`Found ${receiver.cameras.length} camera(s)`);
  }

  // Attempt authentication (non-blocking, will retry on WS connect)
  const authResult = await authenticate();
  if (authResult) {
    wsClient.setToken(authResult.token);
    log(`Authenticated as ${authResult.deviceId}`);
  } else {
    log('Auth unavailable — running in local mode');
  }

  // Connect WebSocket (non-blocking, auto-reconnects)
  wsClient.onMessage((msg) => {
    log(`WS: ${msg.type}`);
  });
  wsClient.connect();

  // Notify user of controls
  log('Ready — press R to receive, T to transmit');
}

// ── Receiver events ─────────────────────────────────────────────────

receiver.onPacketEvents((events: DetectionEvent[]) => {
  for (const ev of events) {
    const { sourceId, result } = ev;
    if (result.valid) {
      log(`[${sourceId}] ✓ ${result.text} (${result.corrections} FEC fixes)`);
    } else {
      log(`[${sourceId}] ✗ corrupted: ${result.text}`);
    }
    // Forward to daemon
    wsClient.send('packet_decoded', {
      source: sourceId,
      text: result.text,
      valid: result.valid,
      corrections: result.corrections,
    });
  }
});

// ── Keyboard controls ───────────────────────────────────────────────

let transmitInput = '';
let isTypingTransmit = false;

document.addEventListener('keydown', async (e: KeyboardEvent) => {
  // When typing a transmit message
  if (isTypingTransmit) {
    if (e.key === 'Escape') {
      isTypingTransmit = false;
      transmitInput = '';
      log('Transmit cancelled');
      return;
    }
    if (e.key === 'Enter') {
      const msg = transmitInput;
      isTypingTransmit = false;
      transmitInput = '';
      if (msg) {
        log(`Transmitting: ${msg}`);
        await transmitter.transmit(msg);
        log('Transmission complete');
      }
      return;
    }
    if (e.key === 'Backspace') {
      transmitInput = transmitInput.slice(0, -1);
      log(`TX> ${transmitInput}█`);
      return;
    }
    if (e.key.length === 1 && transmitInput.length < 16) {
      transmitInput += e.key;
      log(`TX> ${transmitInput}█`);
      return;
    }
    return;
  }

  switch (e.key.toLowerCase()) {
    case 'r':
      if (receiver.isRunning) {
        receiver.stop();
        log('Receiver stopped');
      } else {
        try {
          await receiver.start();
          log('Receiver started — scanning for sources');
        } catch (err) {
          log(`Camera error: ${err}`);
        }
      }
      break;

    case 't':
      if (transmitter.isTransmitting) {
        transmitter.abort();
        log('Transmission aborted');
      } else {
        isTypingTransmit = true;
        transmitInput = '';
        log('TX> █ (type message, Enter to send, Esc to cancel)');
      }
      break;

    case '1':
      transmitter.baudRate = 100;
      log('Baud rate: Fast (100ms)');
      break;
    case '2':
      transmitter.baudRate = 200;
      log('Baud rate: Standard (200ms)');
      break;
    case '3':
      transmitter.baudRate = 400;
      log('Baud rate: Slow (400ms)');
      break;

    case 'c':
      if (receiver.cameras.length > 1) {
        const idx = receiver.cameras.findIndex(
          (c) => c.deviceId === receiver.selectedCamera,
        );
        const next = (idx + 1) % receiver.cameras.length;
        const cam = receiver.cameras[next];
        await receiver.switchCamera(cam.deviceId);
        log(`Camera: ${cam.label || cam.deviceId.slice(0, 8)}`);
      }
      break;

    case 'escape':
      if (receiver.isRunning) {
        receiver.stop();
        log('Receiver stopped');
      }
      break;
  }
});

// ── GO ──────────────────────────────────────────────────────────────

init().catch((err) => console.error('Init failed:', err));
