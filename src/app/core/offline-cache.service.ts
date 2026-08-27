import { Injectable } from '@angular/core';
import type { ShoppingCycle } from './api.models';

export interface PendingToggle {
  itemId: string;
  desiredChecked: boolean;
  createdAt: string;
}

const DATABASE_NAME = 'family-shopping-cache';
const DATABASE_VERSION = 1;

@Injectable({ providedIn: 'root' })
export class OfflineCacheService {
  private databasePromise: Promise<IDBDatabase | null> | null = null;
  private memoryCycle: ShoppingCycle | null = null;
  private readonly memoryToggles = new Map<string, PendingToggle>();

  async loadCycle(): Promise<ShoppingCycle | null> {
    const database = await this.database();
    if (!database) return this.clone(this.memoryCycle);
    const value = await this.request<ShoppingCycle | undefined>(
      database.transaction('state').objectStore('state').get('active-cycle'),
    );
    return value ? this.clone(value) : null;
  }

  async saveCycle(cycle: ShoppingCycle): Promise<void> {
    this.memoryCycle = this.clone(cycle);
    const database = await this.database();
    if (!database) return;
    await this.transaction(database, 'state', 'readwrite', (store) =>
      store.put(cycle, 'active-cycle'),
    );
  }

  async queueToggle(toggle: PendingToggle): Promise<void> {
    this.memoryToggles.set(toggle.itemId, { ...toggle });
    const database = await this.database();
    if (!database) return;
    await this.transaction(database, 'operations', 'readwrite', (store) => store.put(toggle));
  }

  async pendingToggles(): Promise<PendingToggle[]> {
    const database = await this.database();
    if (!database) return [...this.memoryToggles.values()].map((toggle) => ({ ...toggle }));
    return this.request<PendingToggle[]>(
      database.transaction('operations').objectStore('operations').getAll(),
    );
  }

  async removeToggle(itemId: string): Promise<void> {
    this.memoryToggles.delete(itemId);
    const database = await this.database();
    if (!database) return;
    await this.transaction(database, 'operations', 'readwrite', (store) => store.delete(itemId));
  }

  async clear(): Promise<void> {
    this.memoryCycle = null;
    this.memoryToggles.clear();
    const database = await this.database();
    if (!database) return;
    await Promise.all([
      this.transaction(database, 'state', 'readwrite', (store) => store.clear()),
      this.transaction(database, 'operations', 'readwrite', (store) => store.clear()),
    ]);
  }

  private database(): Promise<IDBDatabase | null> {
    if (this.databasePromise) return this.databasePromise;
    if (!globalThis.indexedDB) return Promise.resolve(null);
    this.databasePromise = new Promise((resolve) => {
      const opening = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      opening.onupgradeneeded = () => {
        const database = opening.result;
        if (!database.objectStoreNames.contains('state')) database.createObjectStore('state');
        if (!database.objectStoreNames.contains('operations')) {
          database.createObjectStore('operations', { keyPath: 'itemId' });
        }
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => resolve(null);
      opening.onblocked = () => resolve(null);
    });
    return this.databasePromise;
  }

  private transaction(
    database: IDBDatabase,
    storeName: string,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      action(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  private request<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }
}
