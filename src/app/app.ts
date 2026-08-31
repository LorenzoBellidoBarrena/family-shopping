import { DOCUMENT } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  HostListener,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import QRCode from 'qrcode';
import type {
  OfferSupermarketId,
  OfferBrowseCategory,
  ListMatchCandidate,
  ShoppingItemOfferMatch,
  PairingDetails,
  ProductPreference,
  ProductCategory,
  ShoppingItem,
  Unit,
} from './core/api.models';
import { UNITS } from './core/api.models';
import { PRODUCT_CATEGORIES, productCategoryDefinition } from '../shared/product-category';
import { ShoppingStore } from './state/shopping.store';
import { OffersStore } from './state/offers.store';

@Component({
  imports: [FormsModule],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly store = inject(ShoppingStore);
  protected readonly offersState = inject(OffersStore);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly swUpdate = inject(SwUpdate, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private pairingTimer: number | null = null;
  protected readonly units = UNITS;
  protected readonly productCategories = PRODUCT_CATEGORIES;
  protected readonly categoryDetails = productCategoryDefinition;
  protected readonly view = signal<'list' | 'offers' | 'settings'>('list');
  protected readonly offerFilter = signal<OfferSupermarketId>('lidl');
  protected readonly offerCategory = signal<'all' | OfferBrowseCategory>('all');
  private readonly offerVisibleLimit = signal(24);
  protected readonly offerFilters: readonly {
    id: OfferSupermarketId;
    name: string;
    enabled: boolean;
  }[] = [
    { id: 'lidl', name: 'Lidl', enabled: true },
    { id: 'mercadona', name: 'Mercadona 🔒', enabled: false },
    { id: 'carrefour', name: 'Carrefour 🔒', enabled: false },
    { id: 'dia', name: 'DIA 🔒', enabled: false },
  ];
  protected readonly imageViewer = signal<{ url: string; name: string } | null>(null);
  private readonly failedImageUrls = signal<ReadonlySet<string>>(new Set());
  private imageViewerTrigger: HTMLElement | null = null;
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
  protected readonly activeOffers = computed(() => this.offersState.activeOffers());
  private readonly allUpcomingOffers = computed(() => this.offersState.upcomingOffers());
  protected readonly upcomingOffers = computed(() =>
    this.allUpcomingOffers().slice(0, this.offerVisibleLimit()),
  );
  protected readonly pendingOfferMatches = computed(() =>
    this.offersState.offerMatches().filter((match) => !match.checked),
  );
  protected readonly relatedOfferMatches = computed(() =>
    this.pendingOfferMatches().filter(
      (match) =>
        match.candidates.some((candidate) => candidate.activeOffers.length > 0) ||
        match.alternatives.length > 0,
    ),
  );
  private readonly allOtherActiveOffers = computed(() => {
    const relatedOfferIds = new Set(
      this.relatedOfferMatches().flatMap((match) =>
        [...match.candidates, ...match.alternatives].flatMap((candidate) =>
          candidate.activeOffers.map((offer) => offer.id),
        ),
      ),
    );
    return this.activeOffers().filter((offer) => !relatedOfferIds.has(offer.id));
  });
  protected readonly otherActiveOffers = computed(() =>
    this.allOtherActiveOffers().slice(0, this.offerVisibleLimit()),
  );
  protected readonly canLoadMoreOffers = computed(
    () =>
      this.allOtherActiveOffers().length > this.offerVisibleLimit() ||
      this.allUpcomingOffers().length > this.offerVisibleLimit(),
  );

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
    this.destroyRef.onDestroy(() => {
      this.stopPairingTimer();
      this.document.body.classList.remove('image-viewer-open');
    });
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
    this.store.searchSuggestions(this.quickName);
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
    this.offerVisibleLimit.set(24);
    this.view.set('offers');
    const filter = this.offerFilter();
    const category = this.offerCategory();
    this.offersState.enter(filter, category === 'all' ? undefined : category);
  }

  protected selectOfferFilter(filter: OfferSupermarketId): void {
    if (filter !== 'lidl') return;
    this.offerVisibleLimit.set(24);
    this.offerFilter.set(filter);
    const category = this.offerCategory();
    void this.offersState.load(filter, category === 'all' ? undefined : category);
  }

  protected selectOfferCategory(category: 'all' | OfferBrowseCategory): void {
    this.offerVisibleLimit.set(24);
    this.offerCategory.set(category);
    const filter = this.offerFilter();
    void this.offersState.load(filter, category === 'all' ? undefined : category);
  }

  protected imageAvailable(url: string | null): url is string {
    return Boolean(url && !this.failedImageUrls().has(url));
  }

  protected imageRequestUrl(url: string): string {
    const requestUrl = new URL(url, this.initialUrl);
    if (requestUrl.origin !== this.initialUrl.origin) {
      requestUrl.searchParams.set('ngsw-bypass', 'true');
    }
    return requestUrl.toString();
  }

  protected markImageFailed(url: string): void {
    if (this.failedImageUrls().has(url)) return;
    this.failedImageUrls.update((current) => new Set([...current, url]));
    if (this.imageViewer()?.url === url) this.closeImageViewer();
  }

  protected openImageViewer(url: string, name: string, event: Event): void {
    if (!this.imageAvailable(url)) return;
    this.imageViewerTrigger = event.currentTarget as HTMLElement;
    this.imageViewer.set({ url, name });
    this.document.body.classList.add('image-viewer-open');
    this.document.defaultView?.setTimeout(
      () =>
        (this.document.querySelector('.image-viewer-close') as HTMLButtonElement | null)?.focus(),
      0,
    );
  }

  protected closeImageViewer(): void {
    if (!this.imageViewer()) return;
    this.imageViewer.set(null);
    this.document.body.classList.remove('image-viewer-open');
    const trigger = this.imageViewerTrigger;
    this.imageViewerTrigger = null;
    queueMicrotask(() => trigger?.focus());
  }

  protected closeImageViewerFromBackdrop(event: Event): void {
    if (event.target === event.currentTarget) this.closeImageViewer();
  }

  @HostListener('document:keydown.escape')
  protected closeImageViewerWithEscape(): void {
    this.closeImageViewer();
  }

  protected showList(): void {
    this.offersState.leave();
    this.view.set('list');
  }

  protected showSettings(): void {
    this.offersState.leave();
    this.view.set('settings');
  }

  protected loadMoreOffers(): void {
    this.offerVisibleLimit.update((limit) => limit + 24);
  }

  protected formatPrice(cents: number): string {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(
      cents / 100,
    );
  }

  protected candidateOffer(candidate: ListMatchCandidate) {
    return candidate.activeOffers[0] ?? null;
  }

  protected hasActiveIdentityOffer(match: ShoppingItemOfferMatch): boolean {
    return match.candidates.some((candidate) => candidate.activeOffers.length > 0);
  }

  protected packageNeedLabel(candidate: ListMatchCandidate): string | null {
    const packs = candidate.package.packsNeeded;
    if (packs === null || packs <= 1) return null;
    return `Necesitarías ${packs} ${packs === 1 ? 'envase' : 'envases'}`;
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
