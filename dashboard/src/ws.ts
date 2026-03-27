/**
 * WebSocket client for communication with the logswarm daemon.
 *
 * Wire format: MessagePack over binary WebSocket frames.
 * Reconnects automatically with exponential backoff.
 */

import { encode, decode } from '@msgpack/msgpack';

export interface WsMessage {
  type: string;
  payload: unknown;
}

export type WsMessageHandler = (msg: WsMessage) => void;

export class WsClient {
  private url: string;
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30_000;
  private handlers: WsMessageHandler[] = [];
  private shouldConnect = false;
  private token: string | null = null;

  constructor(url?: string) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = url ?? `${proto}//${location.host}/ws`;
  }

  /** Set JWT token for authentication. */
  setToken(jwt: string): void {
    this.token = jwt;
  }

  /** Register a message handler. */
  onMessage(handler: WsMessageHandler): void {
    this.handlers.push(handler);
  }

  /** Start connecting. */
  connect(): void {
    this.shouldConnect = true;
    this.reconnectDelay = 1000;
    this.doConnect();
  }

  /** Disconnect and stop reconnecting. */
  disconnect(): void {
    this.shouldConnect = false;
    this.ws?.close();
    this.ws = null;
  }

  /** Send a typed message. */
  send(type: string, payload: unknown = {}): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const data = encode({ type, payload });
    this.ws.send(data);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private doConnect(): void {
    if (!this.shouldConnect) return;

    const url = this.token
      ? `${this.url}?token=${encodeURIComponent(this.token)}`
      : this.url;

    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      console.log('[ws] connected');
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = decode(new Uint8Array(ev.data as ArrayBuffer)) as WsMessage;
        for (const h of this.handlers) h(msg);
      } catch (e) {
        console.warn('[ws] failed to decode message', e);
      }
    };

    this.ws.onclose = () => {
      console.log(`[ws] closed, reconnecting in ${this.reconnectDelay}ms`);
      setTimeout(() => this.doConnect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay,
      );
    };

    this.ws.onerror = (err) => {
      console.warn('[ws] error', err);
      this.ws?.close();
    };
  }
}
