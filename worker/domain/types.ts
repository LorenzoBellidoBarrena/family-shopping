import type { ProductCategory } from '../../src/shared/product-category';

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
export type CycleStatus = 'ACTIVE' | 'COMPLETED' | 'CLEARED';
export type ClearAction = 'CANCEL' | 'CLEAR_ALL' | 'CARRY_PENDING';

export interface Household {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  householdId: string;
  name: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface Supermarket {
  id: string;
  code: string;
  name: string;
}

export interface ShoppingItem {
  id: string;
  shoppingCycleId: string;
  name: string;
  normalizedName: string;
  quantity: string;
  unit: Unit;
  supermarketId: string | null;
  category: ProductCategory;
  checked: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  checkedAt: string | null;
}

export interface ShoppingCycle {
  id: string;
  householdId: string;
  status: CycleStatus;
  createdAt: string;
  closedAt: string | null;
  closeReason: string | null;
  items: ShoppingItem[];
}

export interface ProductPreference {
  id: string;
  normalizedName: string;
  name: string;
  supermarketId: string | null;
  category: ProductCategory;
  unit: Unit;
  quantity: string;
  useCount: number;
  updatedAt: string;
}

export interface ItemValues {
  name: string;
  normalizedName: string;
  quantityMilli: number;
  unit: Unit;
  supermarketId: string | null;
  category: ProductCategory;
}
