import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, fromEvent, takeUntil, type Observable } from 'rxjs';
import type {
  ApiErrorBody,
  BootstrapInput,
  BootstrapResponse,
  ClearAction,
  ItemInput,
  HouseholdLoyaltyProgram,
  LoyaltyProgramCode,
  LoyaltyStatus,
  ListOfferMatchesResponse,
  OfferBrowseCategory,
  OfferSupermarketId,
  OffersResponse,
  PairingConsumeInput,
  PairingConsumeResponse,
  PairingDetails,
  ProductPreference,
  ShoppingCycle,
  ShoppingItem,
  Supermarket,
} from './api.models';
import { DeviceTokenStore } from './device-token.store';

export class ShoppingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ShoppingApiError';
  }
}

@Injectable({ providedIn: 'root' })
export class ShoppingApiService {
  private readonly http = inject(HttpClient);
  private readonly tokens = inject(DeviceTokenStore);

  bootstrap(input: BootstrapInput): Promise<BootstrapResponse> {
    return this.request(firstValueFrom(this.http.post<BootstrapResponse>('/api/bootstrap', input)));
  }

  getActiveCycle(): Promise<ShoppingCycle> {
    return this.request(
      firstValueFrom(
        this.http.get<{ cycle: ShoppingCycle }>('/api/shopping-cycle/active', this.auth()),
      ).then(({ cycle }) => cycle),
    );
  }

  getSupermarkets(): Promise<Supermarket[]> {
    return this.request(
      firstValueFrom(
        this.http.get<{ supermarkets: Supermarket[] }>('/api/supermarkets', this.auth()),
      ).then(({ supermarkets }) => supermarkets),
    );
  }

  getSuggestions(query = '', limit = 10): Promise<ProductPreference[]> {
    const params = new HttpParams().set('query', query).set('limit', String(limit));
    return this.request(
      firstValueFrom(
        this.http.get<{ suggestions: ProductPreference[] }>(
          '/api/product-preferences/suggestions',
          { ...this.auth(), params },
        ),
      ).then(({ suggestions }) => suggestions),
    );
  }

  getOffers(
    supermarket?: OfferSupermarketId,
    category?: OfferBrowseCategory,
    signal?: AbortSignal,
  ): Promise<OffersResponse> {
    let params = new HttpParams();
    if (supermarket) params = params.set('supermarket', supermarket);
    if (category) params = params.set('category', category);
    return this.request(
      this.abortableFirst(
        this.http.get<OffersResponse>('/api/offers', { ...this.auth(), params }),
        signal,
      ),
    );
  }

  getListOfferMatches(signal?: AbortSignal): Promise<ListOfferMatchesResponse> {
    return this.request(
      this.abortableFirst(
        this.http.get<ListOfferMatchesResponse>('/api/offers/for-list', this.auth()),
        signal,
      ),
    );
  }

  getLoyaltyPrograms(): Promise<HouseholdLoyaltyProgram[]> {
    return this.request(
      firstValueFrom(
        this.http.get<{ loyaltyPrograms: HouseholdLoyaltyProgram[] }>(
          '/api/settings/loyalty-programs',
          this.auth(),
        ),
      ).then(({ loyaltyPrograms }) => loyaltyPrograms),
    );
  }

  setLoyaltyProgram(
    program: LoyaltyProgramCode,
    status: LoyaltyStatus,
  ): Promise<HouseholdLoyaltyProgram> {
    return this.request(
      firstValueFrom(
        this.http.put<HouseholdLoyaltyProgram>(
          `/api/settings/loyalty-programs/${program}`,
          { status },
          this.auth(),
        ),
      ),
    );
  }

  confirmProductMatch(itemId: string, externalProductId: string): Promise<void> {
    return this.request(
      firstValueFrom(
        this.http.put<void>(
          `/api/items/${itemId}/product-match`,
          { externalProductId },
          this.auth(),
        ),
      ),
    );
  }

  dismissProductMatch(itemId: string): Promise<void> {
    return this.request(
      firstValueFrom(this.http.delete<void>(`/api/items/${itemId}/product-match`, this.auth())),
    );
  }

  addItem(input: ItemInput): Promise<ShoppingItem> {
    return this.request(
      firstValueFrom(this.http.post<{ item: ShoppingItem }>('/api/items', input, this.auth())).then(
        ({ item }) => item,
      ),
    );
  }

  updateItem(itemId: string, input: ItemInput): Promise<ShoppingItem> {
    return this.request(
      firstValueFrom(
        this.http.patch<{ item: ShoppingItem }>(`/api/items/${itemId}`, input, this.auth()),
      ).then(({ item }) => item),
    );
  }

  toggleItem(itemId: string): Promise<ShoppingItem> {
    return this.request(
      firstValueFrom(
        this.http.post<{ item: ShoppingItem }>(`/api/items/${itemId}/toggle`, {}, this.auth()),
      ).then(({ item }) => item),
    );
  }

  deleteItem(itemId: string): Promise<void> {
    return this.request(
      firstValueFrom(this.http.delete<void>(`/api/items/${itemId}`, this.auth())),
    );
  }

  complete(): Promise<ShoppingCycle> {
    return this.request(
      firstValueFrom(
        this.http.post<{ cycle: ShoppingCycle }>('/api/shopping-cycle/complete', {}, this.auth()),
      ).then(({ cycle }) => cycle),
    );
  }

  clear(action: ClearAction): Promise<ShoppingCycle> {
    return this.request(
      firstValueFrom(
        this.http.post<{ cycle: ShoppingCycle }>(
          '/api/shopping-cycle/clear',
          { action },
          this.auth(),
        ),
      ).then(({ cycle }) => cycle),
    );
  }

  createPairing(): Promise<PairingDetails> {
    return this.request(
      firstValueFrom(this.http.post<PairingDetails>('/api/pairings', {}, this.auth())),
    );
  }

  consumePairing(input: PairingConsumeInput): Promise<PairingConsumeResponse> {
    return this.request(
      firstValueFrom(this.http.post<PairingConsumeResponse>('/api/pairings/consume', input)),
    );
  }

  private auth(): { headers: HttpHeaders } {
    const token = this.tokens.token();
    return { headers: new HttpHeaders({ authorization: `Bearer ${token ?? ''}` }) };
  }

  private abortableFirst<T>(source: Observable<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return firstValueFrom(source);
    if (signal.aborted) return Promise.reject(new DOMException('Request aborted', 'AbortError'));
    return firstValueFrom(source.pipe(takeUntil(fromEvent(signal, 'abort'))));
  }

  private async request<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        const body = error.error as ApiErrorBody | null;
        throw new ShoppingApiError(
          body?.error?.message ?? 'No se pudo conectar con la lista familiar.',
          error.status,
          body?.error?.code ?? 'REQUEST_FAILED',
        );
      }
      throw error;
    }
  }
}
