import { DOCUMENT } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import QRCode from 'qrcode';
import type { PairingDetails, ProductPreference, ShoppingItem, Unit } from './core/api.models';
import { UNITS } from './core/api.models';
import { ShoppingStore } from './state/shopping.store';

@Component({
  imports: [FormsModule],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly store = inject(ShoppingStore);
  private readonly document = inject(DOCUMENT);
  private pairingTimer: number | null = null;
  protected readonly units = UNITS;
  protected readonly view = signal<'list' | 'settings'>('list');
  protected readonly editingItem = signal<ShoppingItem | null>(null);
  protected readonly deletingItem = signal<ShoppingItem | null>(null);
  protected readonly clearDialogOpen = signal(false);
  protected readonly pairingDetails = signal<PairingDetails | null>(null);
  protected readonly pairingQr = signal<string | null>(null);
  protected readonly pairingSeconds = signal(0);
  protected readonly incomingPairingCode = signal(
    new URL(this.document.defaultView?.location.href ?? 'https://app.invalid/').searchParams.get(
      'code',
    ) ?? '',
  );
  private readonly dismissedCompletionCycle = signal<string | null>(null);
  protected readonly completionDialogOpen = computed(() => {
    const cycle = this.store.cycle();
    return (
      this.store.allChecked() && cycle !== null && this.dismissedCompletionCycle() !== cycle.id
    );
  });

  protected setupAccessKey = '';
  protected householdName = 'Mi hogar';
  protected deviceName = 'Mi móvil';
  protected pairingDeviceName = 'Mi móvil';
  protected quickName = '';
  protected quickQuantity = '1';
  protected quickUnit: Unit = 'unidad';
  protected quickSupermarketId = '';
  protected quickDetailsOpen = false;
  protected editName = '';
  protected editQuantity = '1';
  protected editUnit: Unit = 'unidad';
  protected editSupermarketId = '';

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopPairingTimer());
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
    if (success) this.setupAccessKey = '';
  }

  protected async consumePairing(): Promise<void> {
    const success = await this.store.consumePairing(
      this.incomingPairingCode(),
      this.pairingDeviceName.trim(),
    );
    if (success) {
      this.incomingPairingCode.set('');
      this.document.defaultView?.history.replaceState({}, '', '/');
      this.view.set('list');
    }
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
    void this.store.searchSuggestions(this.quickName);
  }

  protected applySuggestion(preference: ProductPreference): void {
    this.quickName = preference.name;
    this.quickQuantity = preference.quantity;
    this.quickUnit = preference.unit;
    this.quickSupermarketId = preference.supermarketId ?? '';
    this.quickDetailsOpen = true;
    this.store.clearSuggestions();
  }

  protected async addQuickItem(): Promise<void> {
    const name = this.quickName.trim();
    if (!name) return;
    const success = await this.store.addItem(
      this.quickDetailsOpen
        ? {
            name,
            quantity: this.quickQuantity,
            unit: this.quickUnit,
            supermarketId: this.quickSupermarketId || null,
          }
        : { name },
    );
    if (success) this.resetQuickForm();
  }

  protected async addHabit(preference: ProductPreference): Promise<void> {
    await this.store.addItem({
      name: preference.name,
      quantity: preference.quantity,
      unit: preference.unit,
      supermarketId: preference.supermarketId,
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
    this.editingItem.set(item);
  }

  protected async saveEdit(): Promise<void> {
    const item = this.editingItem();
    if (!item || !this.editName.trim()) return;
    const success = await this.store.updateItem(item.id, {
      name: this.editName.trim(),
      quantity: this.editQuantity,
      unit: this.editUnit,
      supermarketId: this.editSupermarketId || null,
    });
    if (success) this.editingItem.set(null);
  }

  protected requestDelete(item: ShoppingItem): void {
    this.editingItem.set(null);
    this.deletingItem.set(item);
  }

  protected async confirmDelete(): Promise<void> {
    const item = this.deletingItem();
    if (!item) return;
    const success = await this.store.deleteItem(item.id);
    if (success) this.deletingItem.set(null);
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
    this.quickDetailsOpen = false;
    this.store.clearSuggestions();
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
