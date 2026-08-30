import { computed, effect, inject, Injectable, signal } from '@angular/core';
import type {
  BootstrapInput,
  ClearAction,
  CatalogOffer,
  ItemInput,
  HouseholdLoyaltyProgram,
  LoyaltyStatus,
  ShoppingItemOfferMatch,
  OfferSupermarketId,
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
import { classifyNormalizedProductName } from '../../shared/product-category';
import { normalizeProductName } from '../../shared/product-name';

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
  private readonly currentOffers = signal<CatalogOffer[]>([]);
  private readonly currentOfferMatches = signal<ShoppingItemOfferMatch[]>([]);
  private readonly unmatchedOfferItemCountState = signal(0);
  private readonly offersLoadingState = signal(false);
  private readonly offersPartialState = signal(false);
  private readonly offersModeState = signal<'DEMO' | 'REAL'>('DEMO');
  private readonly offersLastUpdatedState = signal<string | null>(null);
  private readonly loyaltyProgramsState = signal<HouseholdLoyaltyProgram[]>([
    { program: 'LIDL_PLUS', status: 'UNKNOWN' },
  ]);
  private readonly loyaltyLoadingState = signal(false);
  private readonly loyaltySavingState = signal(false);
  private readonly loyaltyErrorState = signal<string | null>(null);
  private lastOfferFilter: OfferSupermarketId | undefined;
  private readonly loadingState = signal(true);
  private readonly busyState = signal(false);
  private readonly syncingState = signal(false);
  private readonly cachedState = signal(false);
  private readonly pendingOperationCount = signal(0);
  private readonly errorState = signal<string | null>(null);
  private readonly errorCodeState = signal<string | null>(null);

  readonly cycle = this.currentCycle.asReadonly();
  readonly supermarkets = this.availableSupermarkets.asReadonly();
  readonly habits = this.habitualProducts.asReadonly();
  readonly suggestions = this.currentSuggestions.asReadonly();
  readonly offers = this.currentOffers.asReadonly();
  readonly offerMatches = this.currentOfferMatches.asReadonly();
  readonly unmatchedOfferItemCount = this.unmatchedOfferItemCountState.asReadonly();
  readonly offersLoading = this.offersLoadingState.asReadonly();
  readonly offersPartial = this.offersPartialState.asReadonly();
  readonly offersMode = this.offersModeState.asReadonly();
  readonly offersLastUpdatedAt = this.offersLastUpdatedState.asReadonly();
  readonly loyaltyPrograms = this.loyaltyProgramsState.asReadonly();
  readonly loyaltyLoading = this.loyaltyLoadingState.asReadonly();
  readonly loyaltySaving = this.loyaltySavingState.asReadonly();
  readonly loyaltyError = this.loyaltyErrorState.asReadonly();
  readonly lidlPlusStatus = computed(
    () =>
      this.loyaltyProgramsState().find((setting) => setting.program === 'LIDL_PLUS')?.status ??
      'UNKNOWN',
  );
  readonly loading = this.loadingState.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly syncing = this.syncingState.asReadonly();
  readonly pendingOperations = this.pendingOperationCount.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly errorCode = this.errorCodeState.asReadonly();
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
    this.errorCodeState.set(null);
    let cached: ShoppingCycle | null = null;
    try {
      try {
        cached = await this.cache.loadCycle();
        if (cached) {
          this.currentCycle.set(cached);
          this.cachedState.set(true);
        }
        await this.updatePendingCount();
      } catch {
        // IndexedDB is an optional resilience layer. A damaged or unavailable cache
        // must not prevent the canonical online list from loading.
      }

      if (this.network.online()) {
        await Promise.all([this.reconcile(), this.loadMetadata()]);
      } else if (!cached) {
        this.errorState.set('Todavía no hay una lista guardada en este móvil.');
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.started = this.tokens.hasToken();
      if (this.started) this.startRealtime();
      this.loadingState.set(false);
    }
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
      this.errorCodeState.set('NETWORK_UNAVAILABLE');
      this.errorState.set('Conéctate a internet para añadir otro móvil.');
      return null;
    }
    if (this.busyState()) return null;
    this.busyState.set(true);
    this.errorState.set(null);
    this.errorCodeState.set(null);
    try {
      return await this.api.createPairing();
    } catch (error) {
      this.handleError(error);
      return null;
    } finally {
      this.busyState.set(false);
    }
  }

  async loadOffers(supermarket?: OfferSupermarketId): Promise<void> {
    if (this.offline() || this.offersLoadingState()) return;
    this.offersLoadingState.set(true);
    this.lastOfferFilter = supermarket;
    this.errorState.set(null);
    this.errorCodeState.set(null);
    try {
      let matchingFailed = false;
      const matchingPromise =
        supermarket === undefined || supermarket === 'lidl'
          ? this.api.getListOfferMatches().catch(() => {
              matchingFailed = true;
              return null;
            })
          : Promise.resolve(null);
      const [result, matching] = await Promise.all([
        this.api.getOffers(supermarket),
        matchingPromise,
      ]);
      this.currentOffers.set(result.offers);
      this.currentOfferMatches.set(matching?.matchedItems ?? []);
      this.unmatchedOfferItemCountState.set(matching?.unmatchedItems.length ?? 0);
      this.offersPartialState.set(result.partial || matchingFailed);
      this.offersModeState.set(result.mode);
      this.offersLastUpdatedState.set(result.lastUpdatedAt);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.offersLoadingState.set(false);
    }
  }

  async setLidlPlusStatus(status: Exclude<LoyaltyStatus, 'UNKNOWN'>): Promise<void> {
    if (this.offline() || this.loyaltySavingState()) return;
    this.loyaltySavingState.set(true);
    this.loyaltyErrorState.set(null);
    try {
      const setting = await this.api.setLoyaltyProgram('LIDL_PLUS', status);
      this.updateLoyaltySetting(setting);
      if (this.currentOffers().length > 0 || this.currentOfferMatches().length > 0) {
        await this.loadOffers(this.lastOfferFilter);
      }
    } catch (error) {
      this.loyaltyErrorState.set(
        error instanceof Error ? error.message : 'No se pudo guardar la configuración.',
      );
    } finally {
      this.loyaltySavingState.set(false);
    }
  }

  async confirmOfferMatch(itemId: string, externalProductId: string): Promise<void> {
    if (this.offline() || this.offersLoadingState()) return;
    this.offersLoadingState.set(true);
    try {
      await this.api.confirmProductMatch(itemId, externalProductId);
      const matching = await this.api.getListOfferMatches();
      this.currentOfferMatches.set(matching.matchedItems);
      this.unmatchedOfferItemCountState.set(matching.unmatchedItems.length);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.offersLoadingState.set(false);
    }
  }

  async dismissOfferMatch(itemId: string): Promise<void> {
    if (this.offline() || this.offersLoadingState()) return;
    this.offersLoadingState.set(true);
    try {
      await this.api.dismissProductMatch(itemId);
      const matching = await this.api.getListOfferMatches();
      this.currentOfferMatches.set(matching.matchedItems);
      this.unmatchedOfferItemCountState.set(matching.unmatchedItems.length);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.offersLoadingState.set(false);
    }
  }

  async addItem(input: ItemInput): Promise<boolean> {
    if (!this.startOnlineMutation()) return false;
    const previousCycle = this.currentCycle();
    if (!previousCycle) {
      this.busyState.set(false);
      return false;
    }
    const normalizedName = normalizeProductName(input.name);
    const learnedCategory = this.habitualProducts().find(
      (preference) => preference.normalizedName === normalizedName,
    )?.category;
    const now = new Date().toISOString();
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const optimistic: ShoppingItem = {
      id: optimisticId,
      shoppingCycleId: previousCycle.id,
      name: input.name.trim().replace(/\s+/gu, ' '),
      normalizedName,
      quantity: input.quantity ?? '1',
      unit: input.unit ?? 'unidad',
      supermarketId: input.supermarketId ?? null,
      category: input.category ?? learnedCategory ?? classifyNormalizedProductName(normalizedName),
      checked: false,
      sortOrder: Math.max(0, ...previousCycle.items.map((item) => item.sortOrder)) + 1000,
      createdAt: now,
      updatedAt: now,
      checkedAt: null,
    };
    this.updateItems((items) => [...items, optimistic]);
    try {
      const item = await this.api.addItem(input);
      this.updateItems((items) =>
        items.map((current) => (current.id === optimisticId ? item : current)),
      );
      this.persistCycleSafely();
      void this.refreshHabits();
      return true;
    } catch (error) {
      this.currentCycle.set(previousCycle);
      this.handleError(error);
      return false;
    } finally {
      this.busyState.set(false);
    }
  }

  async updateItem(itemId: string, input: ItemInput): Promise<boolean> {
    if (!this.startOnlineMutation()) return false;
    const previousCycle = this.currentCycle();
    const current = previousCycle?.items.find((item) => item.id === itemId);
    if (!previousCycle || !current) {
      this.busyState.set(false);
      return false;
    }
    const normalizedName = normalizeProductName(input.name);
    this.updateItems((items) =>
      items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              name: input.name.trim().replace(/\s+/gu, ' '),
              normalizedName,
              quantity: input.quantity ?? item.quantity,
              unit: input.unit ?? item.unit,
              supermarketId:
                input.supermarketId === undefined ? item.supermarketId : input.supermarketId,
              category: input.category ?? item.category,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
    try {
      const updated = await this.api.updateItem(itemId, input);
      this.updateItems((items) => items.map((item) => (item.id === itemId ? updated : item)));
      this.persistCycleSafely();
      void this.refreshHabits();
      return true;
    } catch (error) {
      this.currentCycle.set(previousCycle);
      this.handleError(error);
      return false;
    } finally {
      this.busyState.set(false);
    }
  }

  async toggleItem(itemId: string): Promise<boolean> {
    if (this.busyState()) return false;
    if (this.offline()) return this.toggleOffline(itemId);
    const previousCycle = this.currentCycle();
    const current = previousCycle?.items.find((item) => item.id === itemId);
    if (!previousCycle || !current) return false;
    const desiredChecked = !current.checked;
    const now = new Date().toISOString();
    this.busyState.set(true);
    this.errorState.set(null);
    this.errorCodeState.set(null);
    this.updateItems((items) =>
      items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              checked: desiredChecked,
              checkedAt: desiredChecked ? now : null,
              updatedAt: now,
            }
          : item,
      ),
    );
    try {
      const updated = await this.api.toggleItem(itemId);
      this.updateItems((items) => items.map((item) => (item.id === itemId ? updated : item)));
      this.persistCycleSafely();
      return true;
    } catch (error) {
      if (this.isNetworkFailure(error)) {
        await this.cache.queueToggle({ itemId, desiredChecked, createdAt: now });
        await this.updatePendingCount();
        await this.persistCycle();
        this.cachedState.set(true);
        return true;
      }
      this.currentCycle.set(previousCycle);
      this.handleError(error);
      return false;
    } finally {
      this.busyState.set(false);
    }
  }

  async deleteItem(itemId: string): Promise<boolean> {
    if (!this.startOnlineMutation()) return false;
    const previousCycle = this.currentCycle();
    if (!previousCycle?.items.some((item) => item.id === itemId)) {
      this.busyState.set(false);
      return false;
    }
    this.updateItems((items) => items.filter((item) => item.id !== itemId));
    try {
      await this.api.deleteItem(itemId);
      this.persistCycleSafely();
      return true;
    } catch (error) {
      this.currentCycle.set(previousCycle);
      this.handleError(error);
      return false;
    } finally {
      this.busyState.set(false);
    }
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
    this.errorCodeState.set(null);
  }

  forgetDevice(): void {
    this.realtime.disconnect();
    this.tokens.clear();
    this.currentCycle.set(null);
    this.availableSupermarkets.set([]);
    this.habitualProducts.set([]);
    this.currentSuggestions.set([]);
    this.loyaltyProgramsState.set([{ program: 'LIDL_PLUS', status: 'UNKNOWN' }]);
    this.errorState.set(null);
    this.errorCodeState.set(null);
    this.started = false;
    void this.cache.clear();
  }

  supermarketName(id: string | null): string {
    if (!id) return 'Sin supermercado';
    return this.availableSupermarkets().find((supermarket) => supermarket.id === id)?.name ?? id;
  }

  private startRealtime(): void {
    this.realtime.connect(
      (event) => {
        if (event.type === 'SETTINGS_UPDATED') void this.refreshLoyaltyAfterRemoteChange();
        else void this.reconcile();
      },
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
    await this.loadLoyaltyPrograms();
  }

  private async loadLoyaltyPrograms(): Promise<void> {
    if (!this.network.online()) return;
    this.loyaltyLoadingState.set(true);
    this.loyaltyErrorState.set(null);
    try {
      this.loyaltyProgramsState.set(await this.api.getLoyaltyPrograms());
    } catch (error) {
      this.loyaltyErrorState.set(
        error instanceof Error ? error.message : 'No se pudo cargar la configuración.',
      );
    } finally {
      this.loyaltyLoadingState.set(false);
    }
  }

  private updateLoyaltySetting(setting: HouseholdLoyaltyProgram): void {
    this.loyaltyProgramsState.update((settings) => [
      ...settings.filter((current) => current.program !== setting.program),
      setting,
    ]);
  }

  private async refreshLoyaltyAfterRemoteChange(): Promise<void> {
    await this.loadLoyaltyPrograms();
    if (this.currentOffers().length > 0 || this.currentOfferMatches().length > 0) {
      await this.loadOffers(this.lastOfferFilter);
    }
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
    if (!this.startOnlineMutation()) return false;
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

  private startOnlineMutation(): boolean {
    if (this.busyState()) return false;
    if (this.offline()) {
      this.errorCodeState.set('NETWORK_UNAVAILABLE');
      this.errorState.set('Sin conexión sólo se pueden marcar o desmarcar productos.');
      return false;
    }
    this.busyState.set(true);
    this.errorState.set(null);
    this.errorCodeState.set(null);
    return true;
  }

  private async persistCycle(): Promise<void> {
    const cycle = this.currentCycle();
    if (cycle) await this.cache.saveCycle(cycle);
  }

  private persistCycleSafely(): void {
    void this.persistCycle().catch(() => undefined);
  }

  private async updatePendingCount(): Promise<void> {
    this.pendingOperationCount.set((await this.cache.pendingToggles()).length);
  }

  private isNetworkFailure(error: unknown): boolean {
    return !this.network.online() || (error instanceof ShoppingApiError && error.status === 0);
  }

  private handleError(error: unknown): void {
    if (error instanceof ShoppingApiError && error.status === 401) {
      this.errorCodeState.set(error.code);
      this.realtime.disconnect();
      this.tokens.clear();
      this.currentCycle.set(null);
      this.errorState.set('Este dispositivo ya no está autorizado. Vuelve a vincularlo.');
      return;
    }
    if (this.isNetworkFailure(error)) {
      this.errorCodeState.set('NETWORK_UNAVAILABLE');
      this.cachedState.set(true);
      this.errorState.set('Sin conexión. Puedes seguir consultando y marcando la lista guardada.');
      return;
    }
    this.errorCodeState.set(error instanceof ShoppingApiError ? error.code : 'REQUEST_FAILED');
    this.errorState.set(
      error instanceof Error
        ? error.message
        : 'No se pudo actualizar la lista. Inténtalo de nuevo.',
    );
  }
}
