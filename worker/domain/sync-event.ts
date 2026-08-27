export const SYNC_EVENT_TYPES = [
  'ITEM_CREATED',
  'ITEM_UPDATED',
  'ITEM_CHECKED',
  'ITEM_UNCHECKED',
  'ITEM_DELETED',
  'LIST_CLOSED',
  'LIST_REPLACED',
] as const;

export type SyncEventType = (typeof SYNC_EVENT_TYPES)[number];

export interface SyncEvent {
  version: 1;
  id: string;
  type: SyncEventType;
  householdId: string;
  revision: number;
  occurredAt: string;
  payload: unknown;
}

export interface BroadcastRequest {
  event: SyncEvent;
  sourceDeviceId: string;
}
