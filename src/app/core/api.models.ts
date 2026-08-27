export const UNITS = [
  'unidad',
  'pack',
  'kg',
  'g',
  'litro',
  'ml',
  'caja',
  'botella',
  'otro',
] as const;

export type Unit = (typeof UNITS)[number];
export type ClearAction = 'CANCEL' | 'CLEAR_ALL' | 'CARRY_PENDING';

export interface ShoppingItem {
  id: string;
  shoppingCycleId: string;
  name: string;
  normalizedName: string;
  quantity: string;
  unit: Unit;
  supermarketId: string | null;
  checked: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  checkedAt: string | null;
}

export interface ShoppingCycle {
  id: string;
  householdId: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CLEARED';
  createdAt: string;
  closedAt: string | null;
  closeReason: string | null;
  items: ShoppingItem[];
}

export interface Supermarket {
  id: string;
  code: string;
  name: string;
}

export interface ProductPreference {
  id: string;
  normalizedName: string;
  name: string;
  supermarketId: string | null;
  unit: Unit;
  quantity: string;
  useCount: number;
  updatedAt: string;
}

export interface ItemInput {
  name: string;
  quantity?: string;
  unit?: Unit;
  supermarketId?: string | null;
}

export interface BootstrapInput {
  accessKey: string;
  householdName?: string;
  deviceName?: string;
}

export interface BootstrapResponse {
  token: string;
  activeCycle: ShoppingCycle;
}

export interface PairingDetails {
  code: string;
  expiresAt: string;
  pairingUrl: string;
}

export interface PairingConsumeInput {
  code: string;
  deviceName?: string;
}

export interface PairingConsumeResponse {
  token: string;
}

export const SYNC_EVENT_TYPES = [
  'ITEM_CREATED',
  'ITEM_UPDATED',
  'ITEM_CHECKED',
  'ITEM_UNCHECKED',
  'ITEM_DELETED',
  'LIST_CLOSED',
  'LIST_REPLACED',
] as const;

export interface SyncEvent {
  version: 1;
  id: string;
  type: (typeof SYNC_EVENT_TYPES)[number];
  householdId: string;
  revision: number;
  occurredAt: string;
  payload: unknown;
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string };
}
