import { computed, effect, inject, Injectable, signal } from '@angular/core';
import type {
  BootstrapInput,
  ClearAction,
  ItemInput,
  PairingDetails,
  ProductPreference,
  ShoppingCycle,
  ShoppingItem,
  Supermarket,
} from '../core/api.models';
import { DeviceTokenStore } from '../core/device-token.store';
import { NetworkStatusService } from '../core/network-status.service';
import { OfflineCacheService } from '../core/offline-cache.service';
import { RealtimeService } from '../core/realtime.service';
import { ShoppingApiError, ShoppingApiService } from '../core/shopping-api.service';

@Injectable({ providedIn: 'root' })
export class ShoppingStore {
  private readonly api = inject(ShoppingApiService);
  private readonly tokens = inject(DeviceTokenStore);
  private readonly cache = inject(OfflineCacheService);
  private readonly network = inject(NetworkStatusService);
  private readonly realtime = inject(RealtimeService);
  private suggestionRequest = 0;
  private started = false;
  private reconcileRequested = false;

  private readonly currentCycle = signal<ShoppingCycle | null>(null);
  private readonly availableSupermarkets = signal<Supermarket[]>([]);
  private readonly habitualProducts = signal<ProductPreference[]>([]);
  private readonly currentSuggestions = signal<ProductPreference[]>([]);
  private readonly loadingState = signal(true);
  private readonly busyState = signal(false);
  private readonly syncingState = signal(false);
  private readonly cachedState = signal(false);
  private readonly pendingOperationCount = signal(0);
  private readonly errorState = signal<string | null>(null);

  readonly cycle = this.currentCycle.asReadonly();
  readonly supermarkets = this.availableSupermarkets.asReadonly();
  readonly habits = this.habitualProducts.asReadonly();
  readonly suggestions = this.currentSuggestions.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly syncing = this.syncingState.asReadonly();
  readonly pendingOperations = this.pendingOperationCount.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly hasToken = this.tokens.hasToken;
  readonly realtimeStatus = this.realtime.status;
  readonly offline = computed(() => !this.network.online() || this.cachedState());
  readonly items = computed(() => this.currentCycle()?.items ?? []);
  readonly allChecked = computed(() => {
    const items = this.items();
    return items.length > 0 && items.every((item) => item.checked);
  });
  readonly pendingCount = computed(() => this.items().filter((item) => !item.checked).length);

  constructor() {
    effect(() => {
      if (this.network.online() && this.started && this.tokens.hasToken()) void this.reconcile();
    });
  }

  async initialize(): Promise<void> {
    if (!this.tokens.hasToken()) {
      this.loadingState.set(false);
      return;
    }
    this.loadingState.set(true);
    this.errorState.set(null);
    const cached = await this.cache.loadCycle();
    if (cached) {
      this.currentCycle.set(cached);
      this.cachedState.set(true);
    }
    await this.updatePendingCount();
    if (this.network.online()) {
      await Promise.all([this.reconcile(), this.loadMetadata()]);
    } else if (!cached) {
      this.errorState.set('Todavía no hay una lista guardada en este móvil.');
    }
    this.started = true;
    this.startRealtime();
    this.loadingState.set(false);
  }

  async bootstrap(input: BootstrapInput): Promise<boolean> {
    return this.runOnline(async () => {
      const response = await this.api.bootstrap(input);
      this.tokens.save(response.token);
      this.currentCycle.set(response.activeCycle);
      await this.cache.saveCycle(response.activeCycle);
      await this.loadMetadata();
      this.cachedState.set(false);
      this.started = true;
      this.startRealtime();
    });
  }

  async consumePairing(code: string, deviceName: string): Promise<boolean> {
    return this.runOnline(async () => {
      const response = await this.api.consumePairing({ code, deviceName: deviceName || undefined });
      this.tokens.save(response.token);
      this.started = true;
      await Promise.all([this.reconcile(), this.loadMetadata()]);
      this.startRealtime();
    });
  }

  async createPairing(): Promise<PairingDetails | null> {
    if (this.offline()) {
      this.errorState.set('Conéctate a internet para añadir otro móvil.');
      return null;
    }
    if (this.busyState()) return null;
    this.busyState.set(true);
    this.errorState.set(null);
    try {
      return await this.api.createPairing();
    } catch (error) {
      this.handleError(error);
      return null;
    } finally {
      this.busyState.set(false);
    }
  }

  async addItem(input: ItemInput): Promise<boolean> {
    return this.runOnline(async () => {
      const item = await this.api.addItem(input);
      this.updateItems((items) => [...items, item]);
      void this.refreshHabits();
    });
  }

  async updateItem(itemId: string, input: ItemInput): Promise<boolean> {
    return this.runOnline(async () => {
      const updated = await this.api.updateItem(itemId, input);
      this.updateItems((items) => items.map((item) => (item.id === itemId ? updated : item)));
      void this.refreshHabits();
    });
  }

  async toggleItem(itemId: string): Promise<boolean> {
    if (this.busyState()) return false;
    if (this.offline()) return this.toggleOffline(itemId);
    this.busyState.set(true);
    this.errorState.set(null);
    try {
      const updated = await this.api.toggleItem(itemId);
      this.updateItems((items) => items.map((item) => (item.id === itemId ? updated : item)));
      await this.persistCycle();
      return true;
    } catch (error) {
      if (this.isNetworkFailure(error)) {
        this.cachedState.set(true);
        return this.toggleOffline(itemId);
      }
      this.handleError(error);
      return false;
    } finally {
      this.busyState.set(false);
    }
  }

  async deleteItem(itemId: string): Promise<boolean> {
    return this.runOnline(async () => {
      await this.api.deleteItem(itemId);
      this.updateItems((items) => items.filter((item) => item.id !== itemId));
    });
  }

  async complete(): Promise<boolean> {
    return this.runOnline(async () => this.currentCycle.set(await this.api.complete()));
  }

  async clear(action: ClearAction): Promise<boolean> {
    if (action === 'CANCEL') return true;
    return this.runOnline(async () => this.currentCycle.set(await this.api.clear(action)));
  }

  async reconcile(): Promise<void> {
    if (this.syncingState()) {
      this.reconcileRequested = true;
      return;
    }
    if (!this.tokens.hasToken() || !this.network.online()) return;
    this.syncingState.set(true);
    try {
      let canonical = await this.api.getActiveCycle();
      const operations = await this.cache.pendingToggles();
      for (const operation of operations) {
        const current = canonical.items.find((item) => item.id === operation.itemId);
        if (current && current.checked !== operation.desiredChecked) {
          const updated = await this.api.toggleItem(operation.itemId);
          canonical = {
            ...canonical,
            items: canonical.items.map((item) => (item.id === updated.id ? updated : item)),
          };
        }
        await this.cache.removeToggle(operation.itemId);
      }
      this.currentCycle.set(canonical);
      await this.cache.saveCycle(canonical);
      await this.updatePendingCount();
      this.cachedState.set(false);
      this.errorState.set(null);
    } catch (error) {
      if (this.isNetworkFailure(error)) {
        this.cachedState.set(true);
      } else {
        this.handleError(error);
      }
    } finally {
      this.syncingState.set(false);
      if (this.reconcileRequested) {
        this.reconcileRequested = false;
        void this.reconcile();
      }
    }
  }

  async searchSuggestions(query: string): Promise<void> {
    const request = ++this.suggestionRequest;
    if (query.trim().length < 2 || this.offline()) {
      this.currentSuggestions.set([]);
      return;
    }
    try {
      const suggestions = await this.api.getSuggestions(query.trim(), 5);
      if (request === this.suggestionRequest) this.currentSuggestions.set(suggestions);
    } catch {
      if (request === this.suggestionRequest) this.currentSuggestions.set([]);
    }
  }

  clearSuggestions(): void {
    this.suggestionRequest += 1;
    this.currentSuggestions.set([]);
  }

  clearError(): void {
    this.errorState.set(null);
  }

  forgetDevice(): void {
    this.realtime.disconnect();
    this.tokens.clear();
    this.currentCycle.set(null);
    this.availableSupermarkets.set([]);
    this.habitualProducts.set([]);
    this.currentSuggestions.set([]);
    this.errorState.set(null);
    this.started = false;
    void this.cache.clear();
  }

  supermarketName(id: string | null): string {
    if (!id) return 'Sin supermercado';
    return this.availableSupermarkets().find((supermarket) => supermarket.id === id)?.name ?? id;
  }

  private startRealtime(): void {
    this.realtime.connect(
      () => void this.reconcile(),
      () => void this.reconcile(),
    );
  }

  private async loadMetadata(): Promise<void> {
    const [supermarkets, habits] = await Promise.all([
      this.api.getSupermarkets(),
      this.api.getSuggestions('', 6),
    ]);
    this.availableSupermarkets.set(supermarkets);
    this.habitualProducts.set(habits);
  }

  private updateItems(update: (items: ShoppingItem[]) => ShoppingItem[]): void {
    this.currentCycle.update((cycle) => (cycle ? { ...cycle, items: update(cycle.items) } : cycle));
  }

  private async refreshHabits(): Promise<void> {
    try {
      this.habitualProducts.set(await this.api.getSuggestions('', 6));
    } catch {
      // The mutation already succeeded; habitual suggestions can refresh later.
    }
  }

  private async toggleOffline(itemId: string): Promise<boolean> {
    const item = this.items().find((current) => current.id === itemId);
    if (!item) return false;
    const desiredChecked = !item.checked;
    this.updateItems((items) =>
      items.map((current) =>
        current.id === itemId
          ? {
              ...current,
              checked: desiredChecked,
              checkedAt: desiredChecked ? new Date().toISOString() : null,
              updatedAt: new Date().toISOString(),
            }
          : current,
      ),
    );
    const cycle = this.currentCycle();
    if (cycle) await this.cache.saveCycle(cycle);
    await this.cache.queueToggle({
      itemId,
      desiredChecked,
      createdAt: new Date().toISOString(),
    });
    await this.updatePendingCount();
    this.cachedState.set(true);
    return true;
  }

  private async runOnline(operation: () => Promise<void>): Promise<boolean> {
    if (this.busyState()) return false;
    if (this.offline()) {
      this.errorState.set('Sin conexión sólo se pueden marcar o desmarcar productos.');
      return false;
    }
    this.busyState.set(true);
    this.errorState.set(null);
    try {
      await operation();
      await this.persistCycle();
      return true;
    } catch (error) {
      this.handleError(error);
      return false;
    } finally {
      this.busyState.set(false);
    }
  }

  private async persistCycle(): Promise<void> {
    const cycle = this.currentCycle();
    if (cycle) await this.cache.saveCycle(cycle);
  }

  private async updatePendingCount(): Promise<void> {
    this.pendingOperationCount.set((await this.cache.pendingToggles()).length);
  }

  private isNetworkFailure(error: unknown): boolean {
    return !this.network.online() || (error instanceof ShoppingApiError && error.status === 0);
  }

  private handleError(error: unknown): void {
    if (error instanceof ShoppingApiError && error.status === 401) {
      this.realtime.disconnect();
      this.tokens.clear();
      this.currentCycle.set(null);
      this.errorState.set('Este dispositivo ya no está autorizado. Vuelve a vincularlo.');
      return;
    }
    if (this.isNetworkFailure(error)) {
      this.cachedState.set(true);
      this.errorState.set('Sin conexión. Puedes seguir consultando y marcando la lista guardada.');
      return;
    }
    this.errorState.set(
      error instanceof Error
        ? error.message
        : 'No se pudo actualizar la lista. Inténtalo de nuevo.',
    );
  }
}
