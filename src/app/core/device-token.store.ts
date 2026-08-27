import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'family-shopping.device-token';

@Injectable({ providedIn: 'root' })
export class DeviceTokenStore {
  private readonly document = inject(DOCUMENT);
  private readonly storedToken = signal<string | null>(this.read());

  readonly token = this.storedToken.asReadonly();
  readonly hasToken = computed(() => this.storedToken() !== null);

  save(token: string): void {
    this.storedToken.set(token);
    this.storage()?.setItem(STORAGE_KEY, token);
  }

  clear(): void {
    this.storedToken.set(null);
    this.storage()?.removeItem(STORAGE_KEY);
  }

  private read(): string | null {
    try {
      return this.storage()?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private storage(): Storage | undefined {
    try {
      return this.document.defaultView?.localStorage;
    } catch {
      return undefined;
    }
  }
}
