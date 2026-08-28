import { computed, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { App } from './app';
import type { BootstrapInput, PairingConsumeInput, ShoppingCycle } from './core/api.models';
import { DeviceTokenStore } from './core/device-token.store';
import { NetworkStatusService } from './core/network-status.service';
import { OfflineCacheService, type PendingToggle } from './core/offline-cache.service';
import { RealtimeService, type RealtimeStatus } from './core/realtime.service';
import { ShoppingApiError, ShoppingApiService } from './core/shopping-api.service';

const emptyCycle: ShoppingCycle = {
  id: 'cycle-1',
  householdId: 'household-1',
  status: 'ACTIVE',
  createdAt: '2026-08-28T00:00:00.000Z',
  closedAt: null,
  closeReason: null,
  items: [],
};

class OnboardingTokenStore {
  readonly token = signal<string | null>(null);
  readonly hasToken = computed(() => this.token() !== null);
  readonly save = vi.fn((token: string) => this.token.set(token));
  readonly clear = vi.fn(() => this.token.set(null));
}

class OnboardingApi {
  bootstrapFailure: Error | null = null;
  readonly bootstrap = vi.fn(async (input: BootstrapInput) => {
    if (this.bootstrapFailure) throw this.bootstrapFailure;
    return { token: 'first-device-token', activeCycle: structuredClone(emptyCycle), input };
  });
  readonly consumePairing = vi.fn(async (input: PairingConsumeInput) => {
    void input;
    return { token: 'second-device-token' };
  });
  readonly getActiveCycle = vi.fn(async () => structuredClone(emptyCycle));
  readonly getSupermarkets = vi.fn(async () => []);
  readonly getSuggestions = vi.fn(async () => []);
}

class OnboardingNetwork {
  readonly online = signal(true);
}

class OnboardingCache {
  readonly toggles = new Map<string, PendingToggle>();
  readonly loadCycle = vi.fn(async () => null);
  readonly saveCycle = vi.fn(async () => undefined);
  readonly queueToggle = vi.fn(async (toggle: PendingToggle) => {
    this.toggles.set(toggle.itemId, toggle);
  });
  readonly pendingToggles = vi.fn(async () => [...this.toggles.values()]);
  readonly removeToggle = vi.fn(async (itemId: string) => this.toggles.delete(itemId));
  readonly clear = vi.fn(async () => this.toggles.clear());
}

class OnboardingRealtime {
  readonly status = signal<RealtimeStatus>('CONNECTED');
  readonly connect = vi.fn(() => undefined);
  readonly disconnect = vi.fn();
}

describe('bootstrap and pairing onboarding', () => {
  let fixture: ComponentFixture<App>;
  let api: OnboardingApi;
  let tokens: OnboardingTokenStore;
  let realtime: OnboardingRealtime;

  beforeEach(async () => {
    window.history.replaceState({}, '', '/');
    api = new OnboardingApi();
    tokens = new OnboardingTokenStore();
    realtime = new OnboardingRealtime();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: ShoppingApiService, useValue: api },
        { provide: DeviceTokenStore, useValue: tokens },
        { provide: NetworkStatusService, useClass: OnboardingNetwork },
        { provide: OfflineCacheService, useClass: OnboardingCache },
        { provide: RealtimeService, useValue: realtime },
      ],
    }).compileComponents();
  });

  afterEach(() => window.history.replaceState({}, '', '/'));

  it('keeps first-device bootstrap and manual pairing as unambiguous choices', async () => {
    createApp();
    await settle();

    expect(text()).toContain('¿Es el primer móvil?');
    expect(text()).toContain('¿Ya existe la lista familiar?');
    click('Vincular este móvil');
    (
      fixture.componentInstance as unknown as {
        incomingPairingCode: WritableSignal<string>;
      }
    ).incomingPairingCode.set('ABCD2345');
    await settle();
    click('Vincular dispositivo');
    await vi.waitFor(() => expect(api.consumePairing).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(realtime.connect).toHaveBeenCalled());
    fixture.detectChanges();

    expect(api.consumePairing).toHaveBeenCalledWith({
      code: 'ABCD2345',
      deviceName: 'Mi móvil',
    });
    expect(api.bootstrap).not.toHaveBeenCalled();
    expect(tokens.save).toHaveBeenCalledWith('second-device-token');
    expect(api.getActiveCycle).toHaveBeenCalled();
    expect(realtime.connect).toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
    expect(text()).toContain('Tu lista');
  });

  it('recognizes /pair before bootstrap when no device token exists', async () => {
    window.history.replaceState({}, '', '/pair?code=EFGH6789');
    createApp();
    await settle();

    expect(text()).toContain('Vincular este dispositivo');
    expect(
      (fixture.nativeElement.querySelector('#pairing-code-input') as HTMLInputElement).value,
    ).toBe('EFGH6789');
    expect(fixture.nativeElement.querySelector('#access-key')).toBeNull();
    click('Vincular dispositivo');
    await vi.waitFor(() => expect(api.consumePairing).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(window.location.pathname).toBe('/'));

    expect(api.consumePairing).toHaveBeenCalledOnce();
    expect(api.bootstrap).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
  });

  it('explains an attempted second bootstrap and offers the pairing flow', async () => {
    api.bootstrapFailure = new ShoppingApiError(
      'El hogar ya está inicializado.',
      409,
      'HOUSEHOLD_ALREADY_INITIALIZED',
    );
    createApp();
    await settle();
    click('Configurar hogar');
    (fixture.componentInstance as unknown as { setupAccessKey: string }).setupAccessKey =
      'family-key';
    await settle();
    click('Crear hogar');
    await vi.waitFor(() => expect(api.bootstrap).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(text()).toContain('Esta lista familiar ya está configurada');
    });

    expect(text()).toContain('Esta lista familiar ya está configurada');
    expect(text()).toContain('vincúlalo desde un móvil ya autorizado');
    click('Vincular este móvil');
    expect(text()).toContain('Código de vinculación');
  });

  function createApp(): void {
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/gu, ' ') ?? '';
  }

  function click(label: string): void {
    const root = fixture.nativeElement as HTMLElement;
    const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.replace(/\s+/gu, ' ').trim() === label,
    );
    if (!button) throw new Error(`Button not found: ${label}`);
    button.click();
    fixture.detectChanges();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
