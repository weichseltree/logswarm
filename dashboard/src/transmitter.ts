/**
 * Transmitter module — encodes a text message and flashes the screen
 * with protocol colors via the render loop.
 *
 * Protocol sequence: WHITE(start) → [BLUE(clock) → RED/GREEN(bit)]* → YELLOW(end)
 */

import { encodePacketData } from './protocol/packet.js';
import type { BaudRate } from './protocol/constants.js';
import { RenderLoop } from './renderer/loop.js';

export class Transmitter {
  private renderLoop: RenderLoop;
  private transmitting = false;
  private abortController: AbortController | null = null;

  baudRate: BaudRate = 200;

  constructor(renderLoop: RenderLoop) {
    this.renderLoop = renderLoop;
  }

  get isTransmitting(): boolean {
    return this.transmitting;
  }

  /**
   * Transmit a text message by flashing the screen.
   * Resolves when the transmission is complete.
   */
  async transmit(message: string): Promise<void> {
    if (this.transmitting || !message) return;

    this.transmitting = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.renderLoop.updateHUD({ isTransmitting: true });

    const fecBits = encodePacketData(message);
    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });

    try {
      // START: WHITE
      this.renderLoop.updateHUD({ flashColor: '#FFFFFF' });
      await wait(this.baudRate * 3);

      // Data bits
      for (let i = 0; i < fecBits.length; i++) {
        if (signal.aborted) break;

        // CLOCK: BLUE
        this.renderLoop.updateHUD({ flashColor: '#0000FF' });
        await wait(this.baudRate);

        // BIT: GREEN (1) or RED (0)
        this.renderLoop.updateHUD({
          flashColor: fecBits[i] === '1' ? '#00FF00' : '#FF0000',
        });
        await wait(this.baudRate);
      }

      // END: YELLOW
      this.renderLoop.updateHUD({ flashColor: '#FFFF00' });
      await wait(this.baudRate * 3);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        // cancelled — fall through
      } else {
        throw e;
      }
    } finally {
      this.renderLoop.updateHUD({
        isTransmitting: false,
        flashColor: null,
      });
      this.transmitting = false;
      this.abortController = null;
    }
  }

  /** Cancel an in-progress transmission. */
  abort(): void {
    this.abortController?.abort();
  }
}
