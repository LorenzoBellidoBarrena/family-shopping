import { computed, inject, Injectable, signal } from '@angular/core';
import type {
  CatalogOffer,
  ListOfferMatchesResponse,
  OfferBrowseCategory,
  OfferBrowseCategorySummary,
  OffersResponse,
  OfferSupermarketId,
  ShoppingItemOfferMatch,
} from '../core/api.models';
import { ShoppingApiService } from '../core/shopping-api.service';
import { ShoppingStore } from './shopping.store';

interface CachedCatalog {
  result: OffersResponse;
  loadedAt: number;
}

const CATALOG_CACHE_MS = 5 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class OffersStore {
  private readonly api = inject(ShoppingApiService);
  private readonly shopping = inject(ShoppingStore);
  private readonly currentOffers = signal<CatalogOffer[]>([]);
  private readonly currentMatches = signal<ShoppingItemOfferMatch[]>([]);
  private readonly unmatchedCount = signal(0);
  private readonly loadingState = signal(false);
  private readonly partialState = signal(false);
  private readonly modeState = signal<'DEMO' | 'REAL'>('DEMO');
  private readonly lastUpdatedState = signal<string | null>(null);
  private readonly categoriesState = signal<OfferBrowseCategorySummary[]>([]);
  private readonly errorState = signal<string | null>(null);
  private readonly activeState = signal(false);
  private readonly catalogCache = new Map<string, CachedCatalog>();
  private matchingCache: { key: string; result: ListOfferMatchesResponse } | null = null;
  private controller: AbortController | null = null;
  private requestVersion = 0;

  readonly offers = this.currentOffers.asReadonly();
  readonly offerMatches = this.currentMatches.asReadonly();
  readonly unmatchedOfferItemCount = this.unmatchedCount.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly partial = this.partialState.asReadonly();
  readonly mode = this.modeState.asReadonly();
  readonly lastUpdatedAt = this.lastUpdatedState.asReadonly();
  readonly categories = this.categoriesState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly offline = this.shopping.offline;
  readonly activeOffers = computed(() => this.currentOffers().filter((offer) => !offer.upcoming));
  readonly upcomingOffers = computed(() => this.currentOffers().filter((offer) => offer.upcoming));

  enter(supermarket?: OfferSupermarketId, category?: OfferBrowseCategory): void {
    this.activeState.set(true);
    void this.load(supermarket, category);
  }

  leave(): void {
    this.activeState.set(false);
    this.requestVersion += 1;
    this.controller?.abort();
    this.controller = null;
    this.loadingState.set(false);
  }

  async load(supermarket?: OfferSupermarketId, category?: OfferBrowseCategory): Promise<void> {
    if (!this.activeState() || this.offline()) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const requestVersion = ++this.requestVersion;
    const loyaltyStatus = this.shopping.lidlPlusStatus();
    const catalogKey = `${supermarket ?? 'all'}:${category ?? 'all'}:${loyaltyStatus}`;
    const matchingKey = `${this.shopping.listVersion()}:${loyaltyStatus}`;
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      const cachedCatalog = this.catalogCache.get(catalogKey);
      const catalogPromise =
        cachedCatalog && Date.now() - cachedCatalog.loadedAt < CATALOG_CACHE_MS
          ? Promise.resolve(cachedCatalog.result)
          : this.api.getOffers(supermarket, category, controller.signal);
      const shouldMatch = supermarket === undefined || supermarket === 'lidl';
      const matchingPromise = shouldMatch
        ? this.matchingCache?.key === matchingKey
          ? Promise.resolve(this.matchingCache.result)
          : this.api.getListOfferMatches(controller.signal)
        : Promise.resolve(null);
      const [catalog, matching] = await Promise.allSettled([catalogPromise, matchingPromise]);
      if (
        controller.signal.aborted ||
        !this.activeState() ||
        requestVersion !== this.requestVersion
      ) {
        return;
      }
      if (catalog.status === 'rejected') throw catalog.reason;
      this.catalogCache.set(catalogKey, {
        result: catalog.value,
        loadedAt: Date.now(),
      });
      this.currentOffers.set(catalog.value.offers);
      this.categoriesState.set(catalog.value.categories);
      this.modeState.set(catalog.value.mode);
      this.lastUpdatedState.set(catalog.value.lastUpdatedAt);
      if (matching.status === 'fulfilled' && matching.value) {
        this.matchingCache = { key: matchingKey, result: matching.value };
        this.applyMatching(matching.value);
      } else if (!shouldMatch) {
        this.currentMatches.set([]);
        this.unmatchedCount.set(0);
      }
      this.partialState.set(catalog.value.partial || matching.status === 'rejected');
    } catch (error) {
      if (!controller.signal.aborted) {
        this.errorState.set(
          error instanceof Error ? error.message : 'No se pudieron cargar las ofertas.',
        );
      }
    } finally {
      if (requestVersion === this.requestVersion) this.loadingState.set(false);
    }
  }

  async confirmMatch(itemId: string, externalProductId: string): Promise<void> {
    if (!this.activeState() || this.offline() || this.loadingState()) return;
    this.loadingState.set(true);
    try {
      await this.api.confirmProductMatch(itemId, externalProductId);
      await this.refreshMatching();
    } catch (error) {
      this.errorState.set(
        error instanceof Error ? error.message : 'No se pudo guardar la relación.',
      );
    } finally {
      this.loadingState.set(false);
    }
  }

  async dismissMatch(itemId: string): Promise<void> {
    if (!this.activeState() || this.offline() || this.loadingState()) return;
    this.loadingState.set(true);
    try {
      await this.api.dismissProductMatch(itemId);
      await this.refreshMatching();
    } catch (error) {
      this.errorState.set(
        error instanceof Error ? error.message : 'No se pudo guardar la relación.',
      );
    } finally {
      this.loadingState.set(false);
    }
  }

  invalidatePricing(): void {
    this.catalogCache.clear();
    this.matchingCache = null;
  }

  private async refreshMatching(): Promise<void> {
    this.matchingCache = null;
    const result = await this.api.getListOfferMatches();
    const key = `${this.shopping.listVersion()}:${this.shopping.lidlPlusStatus()}`;
    this.matchingCache = { key, result };
    this.applyMatching(result);
  }

  private applyMatching(result: ListOfferMatchesResponse): void {
    this.currentMatches.set(result.matchedItems);
    this.unmatchedCount.set(result.unmatchedItems.length);
  }
}
