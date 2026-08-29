import { DOCUMENT } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import QRCode from 'qrcode';
import type {
  OfferSupermarketId,
  ListMatchCandidate,
  PairingDetails,
  ProductPreference,
  ProductCategory,
  ShoppingItem,
  Unit,
} from './core/api.models';
import { UNITS } from './core/api.models';
import { PRODUCT_CATEGORIES, productCategoryDefinition } from '../shared/product-category';
import { ShoppingStore } from './state/shopping.store';

@Component({
  imports: [FormsModule],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly store = inject(ShoppingStore);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly swUpdate = inject(SwUpdate, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private pairingTimer: number | null = null;
  protected readonly units = UNITS;
  protected readonly productCategories = PRODUCT_CATEGORIES;
  protected readonly categoryDetails = productCategoryDefinition;
  protected readonly view = signal<'list' | 'offers' | 'settings'>('list');
  protected readonly offerFilter = signal<'all' | OfferSupermarketId>('all');
  protected readonly offerFilters: readonly {
    id: 'all' | OfferSupermarketId;
    name: string;
  }[] = [
    { id: 'all', name: 'Todas' },
    { id: 'lidl', name: 'Lidl' },
    { id: 'mercadona', name: 'Mercadona' },
    { id: 'carrefour', name: 'Carrefour' },
    { id: 'dia', name: 'DIA' },
  ];
  protected readonly editingItem = signal<ShoppingItem | null>(null);
  protected readonly deletingItem = signal<ShoppingItem | null>(null);
  protected readonly clearDialogOpen = signal(false);
  protected readonly pairingDetails = signal<PairingDetails | null>(null);
  protected readonly pairingQr = signal<string | null>(null);
  protected readonly pairingSeconds = signal(0);
  private readonly initialUrl = new URL(
    this.document.defaultView?.location.href ?? 'https://app.invalid/',
  );
  protected readonly incomingPairingCode = signal(
    this.initialUrl.searchParams.get('code') ?? this.initialUrl.searchParams.get('token') ?? '',
  );
  protected readonly onboardingMode = signal<'choice' | 'bootstrap' | 'pair'>(
    this.initialUrl.pathname === '/pair' || this.incomingPairingCode() ? 'pair' : 'choice',
  );
  private readonly dismissedCompletionCycle = signal<string | null>(null);
  protected readonly completionDialogOpen = computed(() => {
    const cycle = this.store.cycle();
    return (
      this.store.allChecked() && cycle !== null && this.dismissedCompletionCycle() !== cycle.id
    );
  });
  protected readonly activeOffers = computed(() =>
    this.store.offers().filter((offer) => !offer.upcoming),
  );
  protected readonly upcomingOffers = computed(() =>
    this.store.offers().filter((offer) => offer.upcoming),
  );
  protected readonly pendingOfferMatches = computed(() =>
    this.store.offerMatches().filter((match) => !match.checked),
  );
  protected readonly relatedOfferMatches = computed(() =>
    this.pendingOfferMatches().filter((match) =>
      match.candidates.some((candidate) => candidate.activeOffers.length > 0),
    ),
  );
  protected readonly otherActiveOffers = computed(() => {
    const relatedOfferIds = new Set(
      this.relatedOfferMatches().flatMap((match) =>
        match.candidates.flatMap((candidate) => candidate.activeOffers.map((offer) => offer.id)),
      ),
    );
    return this.activeOffers().filter((offer) => !relatedOfferIds.has(offer.id));
  });

  protected setupAccessKey = '';
  protected householdName = 'Mi hogar';
  protected deviceName = 'Mi móvil';
  protected pairingDeviceName = 'Mi móvil';
  protected quickName = '';
  protected quickQuantity = '1';
  protected quickUnit: Unit = 'unidad';
  protected quickSupermarketId = '';
  protected quickCategory: ProductCategory | null = null;
  protected quickDetailsOpen = false;
  protected editName = '';
  protected editQuantity = '1';
  protected editUnit: Unit = 'unidad';
  protected editSupermarketId = '';
  protected editCategory: ProductCategory = 'OTHER';

  constructor() {
    this.destroyRef.onDestroy(() => this.stopPairingTimer());
    this.enableAutomaticAppUpdates();
  }

  async ngOnInit(): Promise<void> {
    await this.store.initialize();
  }

  protected async submitSetup(): Promise<void> {
    const success = await this.store.bootstrap({
      accessKey: this.setupAccessKey,
      householdName: this.householdName.trim() || undefined,
      deviceName: this.deviceName.trim() || undefined,
    });
    if (success) {
      this.setupAccessKey = '';
      this.navigateHome();
    }
  }

  protected async consumePairing(): Promise<void> {
    const success = await this.store.consumePairing(
      this.incomingPairingCode(),
      this.pairingDeviceName.trim(),
    );
    if (success) {
      this.incomingPairingCode.set('');
      this.navigateHome();
      this.view.set('list');
    }
  }

  protected choosePairing(): void {
    this.store.clearError();
    this.incomingPairingCode.set('');
    this.onboardingMode.set('pair');
  }

  protected chooseBootstrap(): void {
    this.store.clearError();
    this.onboardingMode.set('bootstrap');
  }

  protected returnToOnboarding(): void {
    this.store.clearError();
    this.onboardingMode.set('choice');
  }

  protected async createPairing(): Promise<void> {
    const details = await this.store.createPairing();
    if (!details) return;
    this.pairingDetails.set(details);
    this.pairingQr.set(
      await QRCode.toDataURL(details.pairingUrl, {
        width: 240,
        margin: 1,
        color: { dark: '#17201b', light: '#ffffff' },
      }),
    );
    this.updatePairingSeconds();
    this.stopPairingTimer();
    this.pairingTimer =
      this.document.defaultView?.setInterval(() => this.updatePairingSeconds(), 1000) ?? null;
  }

  protected closePairing(): void {
    this.stopPairingTimer();
    this.pairingDetails.set(null);
    this.pairingQr.set(null);
  }

  protected onQuickNameChange(): void {
    this.quickCategory = null;
    void this.store.searchSuggestions(this.quickName);
  }

  protected applySuggestion(preference: ProductPreference): void {
    this.quickName = preference.name;
    this.quickQuantity = preference.quantity;
    this.quickUnit = preference.unit;
    this.quickSupermarketId = preference.supermarketId ?? '';
    this.quickCategory = preference.category;
    this.quickDetailsOpen = true;
    this.store.clearSuggestions();
  }

  protected async addQuickItem(): Promise<void> {
    const name = this.quickName.trim();
    if (!name) return;
    const category = this.quickCategory ?? undefined;
    const success = await this.store.addItem(
      this.quickDetailsOpen
        ? {
            name,
            quantity: this.quickQuantity,
            unit: this.quickUnit,
            supermarketId: this.quickSupermarketId || null,
            category,
          }
        : { name, category },
    );
    if (success) this.resetQuickForm();
  }

  protected async addHabit(preference: ProductPreference): Promise<void> {
    await this.store.addItem({
      name: preference.name,
      quantity: preference.quantity,
      unit: preference.unit,
      supermarketId: preference.supermarketId,
      category: preference.category,
    });
  }

  protected async toggleItem(item: ShoppingItem): Promise<void> {
    await this.store.toggleItem(item.id);
    if (!this.store.allChecked()) this.dismissedCompletionCycle.set(null);
  }

  protected openEditor(item: ShoppingItem): void {
    this.editName = item.name;
    this.editQuantity = item.quantity;
    this.editUnit = item.unit;
    this.editSupermarketId = item.supermarketId ?? '';
    this.editCategory = item.category;
    this.editingItem.set(item);
  }

  protected async saveEdit(): Promise<void> {
    const item = this.editingItem();
    if (!item || !this.editName.trim()) return;
    const request = this.store.updateItem(item.id, {
      name: this.editName.trim(),
      quantity: this.editQuantity,
      unit: this.editUnit,
      supermarketId: this.editSupermarketId || null,
      category: this.editCategory,
    });
    this.editingItem.set(null);
    if (!(await request) && this.store.hasToken()) this.editingItem.set(item);
  }

  protected requestDelete(item: ShoppingItem): void {
    this.editingItem.set(null);
    this.deletingItem.set(item);
  }

  protected async confirmDelete(): Promise<void> {
    const item = this.deletingItem();
    if (!item) return;
    const request = this.store.deleteItem(item.id);
    this.deletingItem.set(null);
    if (!(await request) && this.store.hasToken()) this.deletingItem.set(item);
  }

  protected dismissCompletion(): void {
    this.dismissedCompletionCycle.set(this.store.cycle()?.id ?? null);
  }

  protected async startNewList(): Promise<void> {
    if (await this.store.complete()) this.dismissedCompletionCycle.set(null);
  }

  protected async clearList(action: 'CLEAR_ALL' | 'CARRY_PENDING'): Promise<void> {
    if (await this.store.clear(action)) {
      this.clearDialogOpen.set(false);
      this.dismissedCompletionCycle.set(null);
    }
  }

  protected showOffers(): void {
    this.view.set('offers');
    const filter = this.offerFilter();
    void this.store.loadOffers(filter === 'all' ? undefined : filter);
  }

  protected selectOfferFilter(filter: 'all' | OfferSupermarketId): void {
    this.offerFilter.set(filter);
    void this.store.loadOffers(filter === 'all' ? undefined : filter);
  }

  protected formatPrice(cents: number): string {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(
      cents / 100,
    );
  }

  protected candidateOffer(candidate: ListMatchCandidate) {
    return candidate.activeOffers[0] ?? null;
  }

  protected savingCents(normalPriceCents: number | null, offerPriceCents: number): number | null {
    if (normalPriceCents === null || normalPriceCents <= offerPriceCents) return null;
    return normalPriceCents - offerPriceCents;
  }

  protected confidenceLabel(confidence: ListMatchCandidate['confidence']): string {
    return confidence === 'HIGH' ? 'Coincidencia alta' : 'Sugerencia';
  }

  protected formatOfferDate(value: string | null): string {
    if (!value) return 'Sin fecha publicada';
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }

  protected formatUpdatedAt(value: string | null): string {
    if (!value) return 'Sin actualización registrada';
    return new Intl.DateTimeFormat('es-ES', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  protected formatUnit(quantity: string, unit: Unit): string {
    if (quantity === '1') return unit;
    const plurals: Partial<Record<Unit, string>> = {
      unidad: 'unidades',
      litro: 'litros',
      caja: 'cajas',
      botella: 'botellas',
    };
    return plurals[unit] ?? unit;
  }

  private resetQuickForm(): void {
    this.quickName = '';
    this.quickQuantity = '1';
    this.quickUnit = 'unidad';
    this.quickSupermarketId = '';
    this.quickCategory = null;
    this.quickDetailsOpen = false;
    this.store.clearSuggestions();
  }

  private navigateHome(): void {
    void this.router.navigateByUrl('/');
    this.document.defaultView?.history.replaceState({}, '', '/');
  }

  private enableAutomaticAppUpdates(): void {
    if (!this.swUpdate?.isEnabled) return;

    const updates = this.swUpdate.versionUpdates.subscribe((event) => {
      if (event.type !== 'VERSION_READY') return;

      void this.swUpdate
        ?.activateUpdate()
        .then(() => this.document.defaultView?.location.reload())
        .catch(() => undefined);
    });
    this.destroyRef.onDestroy(() => updates.unsubscribe());
    void this.swUpdate.checkForUpdate().catch(() => undefined);
  }

  private updatePairingSeconds(): void {
    const details = this.pairingDetails();
    if (!details) return;
    const seconds = Math.max(
      0,
      Math.ceil((new Date(details.expiresAt).getTime() - Date.now()) / 1000),
    );
    this.pairingSeconds.set(seconds);
    if (seconds === 0) this.stopPairingTimer();
  }

  private stopPairingTimer(): void {
    if (this.pairingTimer !== null) this.document.defaultView?.clearInterval(this.pairingTimer);
    this.pairingTimer = null;
  }
}
