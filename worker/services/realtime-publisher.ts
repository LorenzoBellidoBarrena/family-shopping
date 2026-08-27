import type { Device } from '../domain/types';
import type { BroadcastRequest, SyncEvent, SyncEventType } from '../domain/sync-event';
import type { Env } from '../env';
import { D1Repository } from '../repositories/d1-repository';

export class RealtimePublisher {
  constructor(
    private readonly env: Env,
    private readonly repository: D1Repository,
    private readonly context: ExecutionContext,
  ) {}

  publish(device: Device, type: SyncEventType, payload: unknown): void {
    this.context.waitUntil(this.send(device, type, payload).catch(() => undefined));
  }

  private async send(device: Device, type: SyncEventType, payload: unknown): Promise<void> {
    const event: SyncEvent = {
      version: 1,
      id: crypto.randomUUID(),
      type,
      householdId: device.householdId,
      revision: await this.repository.nextRevision(device.householdId),
      occurredAt: new Date().toISOString(),
      payload,
    };
    const id = this.env.HOUSEHOLD_COORDINATOR.idFromName(device.householdId);
    const stub = this.env.HOUSEHOLD_COORDINATOR.get(id);
    const body: BroadcastRequest = { event, sourceDeviceId: device.id };
    const response = await stub.fetch('https://household.internal/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('Realtime broadcast failed');
  }
}
