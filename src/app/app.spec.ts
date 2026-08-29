import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { App } from './app';
import type {
  BootstrapInput,
  BootstrapResponse,
  CatalogOffer,
  ClearAction,
  ItemInput,
  OfferSupermarketId,
  OffersResponse,
  PairingConsumeInput,
  ProductPreference,
  ShoppingCycle,
  ShoppingItem,
  Supermarket,
  SyncEvent,
} from './core/api.models';
import { DeviceTokenStore } from './core/device-token.store';
import { NetworkStatusService } from './core/network-status.service';
import { OfflineCacheService, type PendingToggle } from './core/offline-cache.service';
import { RealtimeService, type RealtimeStatus } from './core/realtime.service';
import { ShoppingApiService } from './core/shopping-api.service';
import { ShoppingStore } from './state/shopping.store';
import { classifyNormalizedProductName } from '../shared/product-category';

const item = (id: string, name: string, sortOrder: number, checked = false): ShoppingItem => ({
  id,
  shoppingCycleId: 'cycle-1',
  name,
  normalizedName: name.toLowerCase(),
  category: classifyNormalizedProductName(name.toLowerCase()),
  quantity: name === 'Leche' ? '6' : '1',
  unit: 'unidad',
  supermarketId: name === 'Leche' ? 'lidl' : null,
  checked,
  sortOrder,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
  checkedAt: checked ? '2026-08-27T00:01:00.000Z' : null,
});

const cycle = (items: ShoppingItem[]): ShoppingCycle => ({
  id: 'cycle-1',
  householdId: 'household-1',
  status: 'ACTIVE',
  createdAt: '2026-08-27T00:00:00.000Z',
  closedAt: null,
  closeReason: null,
  items,
});

class FakeTokenStore {
  readonly token = signal<string | null>('device-token');
  readonly hasToken = computed(() => this.token() !== null);

  save(token: string): void {
    this.token.set(token);
  }

  clear(): void {
    this.token.set(null);
  }
}

class FakeShoppingApi {
  offersMode: 'DEMO' | 'REAL' = 'DEMO';
  serverCycle = cycle([item('milk', 'Leche', 1000), item('bread', 'Pan', 2000, true)]);
  readonly supermarkets: Supermarket[] = [
    { id: 'lidl', code: 'LIDL', name: 'Lidl' },
    { id: 'mercadona', code: 'MERCADONA', name: 'Mercadona' },
    { id: 'any', code: 'ANY', name: 'Da igual' },
  ];
  readonly habits: ProductPreference[] = [
    {
      id: 'habit-eggs',
      normalizedName: 'huevos',
      name: 'Huevos',
      category: 'EGGS',
      supermarketId: 'mercadona',
      unit: 'caja',
      quantity: '1',
      useCount: 5,
      updatedAt: '2026-08-27T00:00:00.000Z',
    },
  ];
  readonly offerData: CatalogOffer[] = [
    {
      id: 'lidl-milk',
      supermarketId: 'lidl',
      supermarketName: 'Lidl',
      storeName: 'Lidl Zafra',
      city: 'Zafra',
      productName: 'Leche entera 1 litro',
      normalizedProductName: 'leche entera 1 litro',
      brand: 'Fixture Lidl',
      category: 'Lácteos',
      visualCategory: 'DAIRY',
      packageLabel: '1 l',
      normalPriceCents: 105,
      offerPriceCents: 89,
      unitPriceCents: 89,
      promotionType: 'Precio promocional de demostración',
      validFrom: '2026-08-24',
      validUntil: '2026-09-01',
      sourceUrl: 'https://www.lidl.es/',
      requiresLoyaltyCard: false,
      catalogAvailability: 'PUBLISHED',
      fixture: true,
      lidlPlusPriceCents: null,
      upcoming: false,
      geographicScope: 'STORE',
      channel: 'STORE',
      observedAt: '2026-08-28T00:00:00.000Z',
      relatedToList: true,
      matchedItemNames: ['Leche'],
    },
  ];

  readonly getActiveCycle = vi.fn(async () => structuredClone(this.serverCycle));
  readonly getSupermarkets = vi.fn(async () => this.supermarkets);
  readonly getSuggestions = vi.fn(async (query = '') =>
    this.habits.filter((habit) => habit.normalizedName.startsWith(query.toLowerCase())),
  );
  readonly getOffers = vi.fn(async (supermarket?: OfferSupermarketId): Promise<OffersResponse> => ({
    offers: supermarket
      ? this.offerData.filter((offer) => offer.supermarketId === supermarket)
      : this.offerData,
    partial: false,
    mode: this.offersMode,
    lastUpdatedAt: '2026-08-28T00:00:00.000Z',
  }));
  readonly bootstrap = vi.fn(async (input: BootstrapInput): Promise<BootstrapResponse> => {
    void input;
    return {
      token: 'new-device-token',
      activeCycle: structuredClone(this.serverCycle),
    };
  });
  readonly createPairing = vi.fn(async () => ({
    code: 'ABCD-1234',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    pairingUrl: 'https://example.test/?code=ABCD-1234',
  }));
  readonly consumePairing = vi.fn(async (input: PairingConsumeInput) => {
    void input;
    return { token: 'paired-device-token' };
  });
  readonly addItem = vi.fn(async (input: ItemInput) => {
    const created: ShoppingItem = {
      ...item(
        `new-${this.serverCycle.items.length}`,
        input.name,
        this.serverCycle.items.length * 1000 + 1000,
      ),
      quantity: input.quantity ?? '1',
      unit: input.unit ?? 'unidad',
      supermarketId: input.supermarketId ?? null,
      category: input.category ?? classifyNormalizedProductName(input.name.toLowerCase()),
    };
    this.serverCycle = { ...this.serverCycle, items: [...this.serverCycle.items, created] };
    return created;
  });
  readonly updateItem = vi.fn(async (itemId: string, input: ItemInput) => {
    let updated!: ShoppingItem;
    this.serverCycle = {
      ...this.serverCycle,
      items: this.serverCycle.items.map((current) => {
        if (current.id !== itemId) return current;
        updated = {
          ...current,
          name: input.name,
          quantity: input.quantity ?? current.quantity,
          unit: input.unit ?? current.unit,
          supermarketId: input.supermarketId ?? null,
          category: input.category ?? current.category,
        };
        return updated;
      }),
    };
    return updated;
  });
  readonly toggleItem = vi.fn(async (itemId: string) => {
    let updated!: ShoppingItem;
    this.serverCycle = {
      ...this.serverCycle,
      items: this.serverCycle.items.map((current) => {
        if (current.id !== itemId) return current;
        updated = {
          ...current,
          checked: !current.checked,
          checkedAt: current.checked ? null : '2026-08-27T00:02:00.000Z',
        };
        return updated;
      }),
    };
    return updated;
  });
  readonly deleteItem = vi.fn(async (itemId: string) => {
    this.serverCycle = {
      ...this.serverCycle,
      items: this.serverCycle.items.filter((current) => current.id !== itemId),
    };
  });
  readonly complete = vi.fn(async () => {
    this.serverCycle = cycle([]);
    return this.serverCycle;
  });
  readonly clear = vi.fn(async (action: ClearAction) => {
    const carried =
      action === 'CARRY_PENDING'
        ? this.serverCycle.items
            .filter((current) => !current.checked)
            .map((current) => ({ ...current, id: `carried-${current.id}`, checked: false }))
        : [];
    this.serverCycle = { ...cycle(carried), id: 'cycle-2' };
    return this.serverCycle;
  });
}

class FakeNetworkStatus {
  readonly online = signal(true);
}

class FakeOfflineCache {
  cycle: ShoppingCycle | null = null;
  readonly toggles = new Map<string, PendingToggle>();

  async loadCycle(): Promise<ShoppingCycle | null> {
    return this.cycle ? structuredClone(this.cycle) : null;
  }

  async saveCycle(value: ShoppingCycle): Promise<void> {
    this.cycle = structuredClone(value);
  }

  async queueToggle(toggle: PendingToggle): Promise<void> {
    this.toggles.set(toggle.itemId, { ...toggle });
  }

  async pendingToggles(): Promise<PendingToggle[]> {
    return [...this.toggles.values()].map((toggle) => ({ ...toggle }));
  }

  async removeToggle(itemId: string): Promise<void> {
    this.toggles.delete(itemId);
  }

  async clear(): Promise<void> {
    this.cycle = null;
    this.toggles.clear();
  }
}

class FakeRealtime {
  readonly status = signal<RealtimeStatus>('CONNECTED');
  eventHandler: ((event: SyncEvent) => void) | null = null;
  reconnectHandler: (() => void) | null = null;
  readonly connect = vi.fn((onEvent: (event: SyncEvent) => void, onReconnect: () => void): void => {
    this.eventHandler = onEvent;
    this.reconnectHandler = onReconnect;
  });
  readonly disconnect = vi.fn();
}

describe('Shopping list interface', () => {
  let fixture: ComponentFixture<App>;
  let api: FakeShoppingApi;
  let network: FakeNetworkStatus;
  let cache: FakeOfflineCache;
  let realtime: FakeRealtime;

  beforeEach(async () => {
    api = new FakeShoppingApi();
    network = new FakeNetworkStatus();
    cache = new FakeOfflineCache();
    realtime = new FakeRealtime();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: ShoppingApiService, useValue: api },
        { provide: DeviceTokenStore, useClass: FakeTokenStore },
        { provide: NetworkStatusService, useValue: network },
        { provide: OfflineCacheService, useValue: cache },
        { provide: RealtimeService, useValue: realtime },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await TestBed.inject(ShoppingStore).initialize();
    fixture.detectChanges();
  });

  it('renders products, quantities, supermarkets, and checked state', () => {
    const root = fixture.nativeElement as HTMLElement;
    const rows = root.querySelectorAll<HTMLLIElement>('.shopping-list li');

    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Leche');
    expect(rows[0].querySelector('.category-emoji')?.textContent?.trim()).toBe('🥛');
    expect(rows[0].textContent).toContain('6 unidades · Lidl');
    expect(rows[1].classList.contains('checked')).toBe(true);
    expect(rows[1].textContent).toContain('Sin supermercado');
  });

  it('adds a product from the quick field', async () => {
    const input = fixture.nativeElement.querySelector('#quick-name') as HTMLInputElement;
    input.value = 'Yogur';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button('Añadir').click();
    await settle();

    expect(api.addItem).toHaveBeenCalledWith({ name: 'Yogur' });
    expect(fixture.nativeElement.textContent).toContain('Yogur');
  });

  it('renders a new product before the server response arrives', async () => {
    let resolveRequest!: (created: ShoppingItem) => void;
    api.addItem.mockImplementationOnce(
      () => new Promise<ShoppingItem>((resolve) => (resolveRequest = resolve)),
    );
    const input = fixture.nativeElement.querySelector('#quick-name') as HTMLInputElement;
    input.value = 'Yogur';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    button('Añadir').click();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Yogur');
    expect(TestBed.inject(ShoppingStore).busy()).toBe(true);

    resolveRequest(item('server-yogurt', 'Yogur', 3000));
    await settle();
    expect(rowIds()).toContain('server-yogurt');
  });

  it('toggles an item without moving it', async () => {
    const before = rowIds();
    const firstCheck = fixture.nativeElement.querySelector('.item-toggle') as HTMLButtonElement;
    expect(firstCheck.getAttribute('aria-label')).toContain('Leche, pendiente');
    const emojiBefore = firstCheck.querySelector('.category-emoji')?.textContent?.trim();
    firstCheck.click();
    await settle();

    expect(api.toggleItem).toHaveBeenCalledWith('milk');
    expect(rowIds()).toEqual(before);
    expect(
      (fixture.nativeElement.querySelector('[data-item-id="milk"]') as HTMLElement).classList,
    ).toContain('checked');
    const toggled = fixture.nativeElement.querySelector('.item-toggle') as HTMLButtonElement;
    expect(toggled.getAttribute('aria-label')).toContain('Leche, comprado');
    expect(toggled.querySelector('.category-emoji')?.textContent?.trim()).toBe(emojiBefore);

    toggled.click();
    await settle();
    expect(rowIds()).toEqual(before);
    expect(
      (fixture.nativeElement.querySelector('[data-item-id="milk"]') as HTMLElement).classList,
    ).not.toContain('checked');
  });

  it('shows a toggle immediately and keeps it after the server confirms it', async () => {
    let resolveRequest!: (updated: ShoppingItem) => void;
    api.toggleItem.mockImplementationOnce(
      () => new Promise<ShoppingItem>((resolve) => (resolveRequest = resolve)),
    );
    const toggle = fixture.nativeElement.querySelector('.item-toggle') as HTMLButtonElement;

    toggle.click();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement.querySelector('[data-item-id="milk"]') as HTMLElement).classList,
    ).toContain('checked');

    resolveRequest({ ...item('milk', 'Leche', 1000, true), quantity: '6', supermarketId: 'lidl' });
    await settle();
    expect(
      (fixture.nativeElement.querySelector('[data-item-id="milk"]') as HTMLElement).classList,
    ).toContain('checked');
  });

  it('rolls back an optimistic toggle when the server rejects it', async () => {
    api.toggleItem.mockRejectedValueOnce(new Error('No se pudo guardar'));
    const toggle = fixture.nativeElement.querySelector('.item-toggle') as HTMLButtonElement;

    toggle.click();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('[data-item-id="milk"]') as HTMLElement).classList,
    ).toContain('checked');

    await settle();
    expect(
      (fixture.nativeElement.querySelector('[data-item-id="milk"]') as HTMLElement).classList,
    ).not.toContain('checked');
    expect(fixture.nativeElement.textContent).toContain('No se pudo guardar');
  });

  it('shows offer fixtures, highlights list matches, and filters by supermarket', async () => {
    button('％ Ofertas').click();
    await settle();

    const card = fixture.nativeElement.querySelector('.offer-card') as HTMLElement;
    expect(api.getOffers).toHaveBeenCalledWith(undefined);
    expect(card.textContent).toContain('Leche entera 1 litro');
    expect(card.textContent).toContain('Está en tu lista');
    expect(card.textContent).toContain('disponibilidad no confirmada');

    button('DIA').click();
    await settle();
    expect(api.getOffers).toHaveBeenLastCalledWith('dia');
    expect(fixture.nativeElement.querySelectorAll('.offer-card')).toHaveLength(0);
  });

  it('labels real Lidl data as Badajoz and never as demo', async () => {
    api.offersMode = 'REAL';
    api.offerData[0].fixture = false;
    api.offerData[0].lidlPlusPriceCents = 79;
    button('％ Ofertas').click();
    await settle();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Datos reales · Lidl');
    expect(text).toContain('Badajoz');
    expect(text).toContain('Lidl Plus: 0,79');
    expect(text).not.toContain('Los precios no son datos comerciales reales');
  });

  it('edits a product with explicit controls', async () => {
    button('Editar').click();
    await settle();
    const input = fixture.nativeElement.querySelector('input[name="editName"]') as HTMLInputElement;
    const category = fixture.nativeElement.querySelector(
      'select[name="editCategory"]',
    ) as HTMLSelectElement;
    input.value = 'Leche sin lactosa';
    input.dispatchEvent(new Event('input'));
    category.value = 'OTHER';
    category.dispatchEvent(new Event('change'));
    await settle();
    expect(input.value).toBe('Leche sin lactosa');
    button('Guardar').click();
    await settle();

    expect(api.updateItem).toHaveBeenCalledWith(
      'milk',
      expect.objectContaining({ name: 'Leche sin lactosa', category: 'OTHER' }),
    );
    expect(fixture.nativeElement.textContent).toContain('Leche sin lactosa');
  });

  it('shows the completion dialog and creates a new list only after confirmation', async () => {
    const firstCheck = fixture.nativeElement.querySelector('.item-toggle') as HTMLButtonElement;
    firstCheck.click();
    await settle();

    expect(fixture.nativeElement.textContent).toContain('Compra completada');
    expect(fixture.nativeElement.textContent).toContain(
      '¿Quieres cerrar esta compra y empezar una lista nueva?',
    );
    button('Nueva lista').click();
    await settle();

    expect(api.complete).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).toContain('La lista está vacía');
  });

  it('carries pending products from the clear dialog', async () => {
    button('Vaciar lista').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Hay productos que todavía no se han comprado. ¿Qué quieres hacer con ellos?',
    );
    button('Pasar pendientes a nueva lista').click();
    await settle();

    expect(api.clear).toHaveBeenCalledWith('CARRY_PENDING');
    expect(rowIds()).toEqual(['carried-milk']);
    expect(fixture.nativeElement.textContent).not.toContain('Pan');
  });

  it('adds a habitual product with one touch', async () => {
    button('🥚 Huevos').click();
    await settle();

    expect(api.addItem).toHaveBeenCalledWith({
      name: 'Huevos',
      quantity: '1',
      unit: 'caja',
      supermarketId: 'mercadona',
      category: 'EGGS',
    });
    expect(fixture.nativeElement.textContent).toContain('Huevos');
  });

  it('refreshes the visible list after a remote versioned event', async () => {
    api.serverCycle = cycle([item('remote', 'Aceite', 1000)]);
    realtime.eventHandler?.({
      version: 1,
      id: 'event-1',
      type: 'ITEM_CREATED',
      householdId: 'household-1',
      revision: 1,
      occurredAt: new Date().toISOString(),
      payload: { itemId: 'remote' },
    });
    await settle();

    expect(api.getActiveCycle).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Aceite');
    expect(fixture.nativeElement.textContent).not.toContain('Leche');
  });

  it('reloads canonical state when the realtime connection returns', async () => {
    api.serverCycle = cycle([item('reconnected', 'Arroz', 1000)]);
    realtime.reconnectHandler?.();
    await settle();

    expect(fixture.nativeElement.textContent).toContain('Arroz');
  });

  it('queues an offline toggle without moving the item', async () => {
    network.online.set(false);
    fixture.detectChanges();
    const before = rowIds();
    (fixture.nativeElement.querySelector('.item-toggle') as HTMLButtonElement).click();
    await settle();

    expect(api.toggleItem).not.toHaveBeenCalled();
    expect(cache.toggles.get('milk')?.desiredChecked).toBe(true);
    expect(rowIds()).toEqual(before);
    expect(fixture.nativeElement.textContent).toContain('1 cambio pendiente');
  });

  it('reconciles queued desired state against D1 after reconnecting', async () => {
    network.online.set(false);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.item-toggle') as HTMLButtonElement).click();
    await settle();

    network.online.set(true);
    await settle();

    expect(api.toggleItem).toHaveBeenCalledWith('milk');
    expect(cache.toggles.size).toBe(0);
    expect(rowIds()).toEqual(['milk', 'bread']);
    expect(
      (fixture.nativeElement.querySelector('[data-item-id="milk"]') as HTMLElement).classList,
    ).toContain('checked');
  });

  function button(text: string): HTMLButtonElement {
    const root = fixture.nativeElement as HTMLElement;
    const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.replace(/\s+/gu, ' ').trim() === text,
    );
    if (!found) throw new Error(`Button not found: ${text}`);
    return found;
  }

  function rowIds(): string[] {
    const root = fixture.nativeElement as HTMLElement;
    return [...root.querySelectorAll<HTMLLIElement>('.shopping-list li')].map(
      (row) => row.dataset['itemId'] ?? '',
    );
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
