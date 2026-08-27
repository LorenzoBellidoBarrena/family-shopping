import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';
import { SYNC_EVENT_TYPES, type SyncEvent } from './api.models';
import { DeviceTokenStore } from './device-token.store';
import { NetworkStatusService } from './network-status.service';

export type RealtimeStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly tokens = inject(DeviceTokenStore);
  private readonly network = inject(NetworkStatusService);
  private readonly connectionState = signal<RealtimeStatus>('DISCONNECTED');
  private socket: WebSocket | null = null;
  private timer: number | null = null;
  private attempt = 0;
  private stopped = true;
  private connectedBefore = false;
  private latestRevision = 0;
  private onEvent: ((event: SyncEvent) => void) | null = null;
  private onReconnect: (() => void) | null = null;

  readonly status = this.connectionState.asReadonly();

  constructor() {
    this.window?.addEventListener('online', () => this.schedule(0));
    this.window?.addEventListener('offline', () => {
      this.socket?.close();
      this.connectionState.set('DISCONNECTED');
    });
  }

  connect(onEvent: (event: SyncEvent) => void, onReconnect: () => void): void {
    this.disconnect();
    this.onEvent = onEvent;
    this.onReconnect = onReconnect;
    this.stopped = false;
    this.open();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.timer !== null && this.window) this.window.clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close(1000, 'client disconnect');
    this.socket = null;
    this.attempt = 0;
    this.connectedBefore = false;
    this.latestRevision = 0;
    this.connectionState.set('DISCONNECTED');
  }

  private open(): void {
    const token = this.tokens.token();
    if (this.stopped || !token || !this.network.online() || !this.window) return;
    this.connectionState.set('CONNECTING');
    const protocol = this.window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new this.window.WebSocket(`${protocol}//${this.window.location.host}/ws`, [
      'family-shopping',
      `bearer.${token}`,
    ]);
    this.socket = socket;
    socket.onopen = () => {
      const reconnect = this.connectedBefore;
      this.connectedBefore = true;
      this.attempt = 0;
      this.connectionState.set('CONNECTED');
      if (reconnect) this.onReconnect?.();
    };
    socket.onmessage = ({ data }) => {
      if (typeof data !== 'string') return;
      const event = this.parseEvent(data);
      if (!event || event.revision <= this.latestRevision) return;
      this.latestRevision = event.revision;
      this.onEvent?.(event);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.connectionState.set('DISCONNECTED');
      this.schedule();
    };
  }

  private schedule(delay?: number): void {
    if (this.stopped || !this.network.online() || !this.window || this.timer !== null) return;
    const wait = delay ?? Math.min(1000 * 2 ** this.attempt, 30_000);
    this.attempt += 1;
    this.timer = this.window.setTimeout(() => {
      this.timer = null;
      this.open();
    }, wait);
  }

  private parseEvent(value: string): SyncEvent | null {
    try {
      const candidate = JSON.parse(value) as Partial<SyncEvent>;
      if (
        candidate.version !== 1 ||
        typeof candidate.id !== 'string' ||
        typeof candidate.householdId !== 'string' ||
        typeof candidate.revision !== 'number' ||
        typeof candidate.type !== 'string' ||
        !(SYNC_EVENT_TYPES as readonly string[]).includes(candidate.type)
      ) {
        return null;
      }
      return candidate as SyncEvent;
    } catch {
      return null;
    }
  }
}
