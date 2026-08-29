import type { Device } from '../domain/types';
import { ApiError, badRequest, conflict, unauthorized } from '../errors';
import { D1Repository } from '../repositories/d1-repository';
import {
  createDeviceToken,
  createPairingCode,
  normalizePairingCode,
  secretsMatch,
  sha256,
} from '../security/tokens';
import { optionalName, requiredName, type JsonObject } from '../validation';

const DEVICE_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export class AuthService {
  constructor(
    private readonly repository: D1Repository,
    private readonly householdAccessKey: string | undefined,
    private readonly context?: Pick<ExecutionContext, 'waitUntil'>,
  ) {}

  async bootstrap(body: JsonObject): Promise<{
    household: Awaited<ReturnType<D1Repository['bootstrap']>>['household'];
    device: Device;
    token: string;
    activeCycle: Awaited<ReturnType<D1Repository['bootstrap']>>['cycle'];
  }> {
    if (await this.repository.getHousehold()) {
      throw conflict('HOUSEHOLD_ALREADY_INITIALIZED', 'El hogar ya está inicializado.');
    }
    if (!this.householdAccessKey) {
      throw new ApiError(
        503,
        'HOUSEHOLD_ACCESS_KEY_NOT_CONFIGURED',
        'El acceso inicial no está configurado.',
      );
    }
    const accessKey = body['accessKey'];
    if (
      typeof accessKey !== 'string' ||
      !(await secretsMatch(accessKey, this.householdAccessKey))
    ) {
      throw unauthorized();
    }
    const householdName =
      body['householdName'] === undefined ? 'Mi hogar' : requiredName(body['householdName'], 80);
    const deviceName = optionalName(body['deviceName'], 'deviceName');
    const token = createDeviceToken();
    const now = new Date().toISOString();
    const result = await this.repository.bootstrap({
      householdId: crypto.randomUUID(),
      householdName,
      deviceId: crypto.randomUUID(),
      deviceName,
      tokenHash: await sha256(token),
      cycleId: crypto.randomUUID(),
      now,
    });
    return {
      household: result.household,
      device: result.device,
      token,
      activeCycle: result.cycle,
    };
  }

  async authorize(request: Request): Promise<Device> {
    const authorization = request.headers.get('authorization');
    const match = /^Bearer ([A-Za-z0-9_-]{40,100})$/u.exec(authorization ?? '');
    if (!match) throw unauthorized();
    return this.authorizeToken(match[1]);
  }

  async authorizeToken(token: string): Promise<Device> {
    if (!/^[A-Za-z0-9_-]{40,100}$/u.test(token)) throw unauthorized();
    const device = await this.repository.findActiveDevice(await sha256(token));
    if (!device) throw unauthorized();
    const lastSeen = new Date(device.lastSeenAt).getTime();
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen >= DEVICE_TOUCH_INTERVAL_MS) {
      const touch = this.repository.touchDevice(device.id, new Date().toISOString());
      if (this.context) this.context.waitUntil(touch.catch(() => undefined));
      else await touch;
    }
    return device;
  }

  async createPairing(
    device: Device,
    requestUrl: string,
  ): Promise<{
    code: string;
    expiresAt: string;
    pairingUrl: string;
  }> {
    const code = createPairingCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    await this.repository.createPairing({
      id: crypto.randomUUID(),
      householdId: device.householdId,
      codeHash: await sha256(code),
      deviceId: device.id,
      now: now.toISOString(),
      expiresAt,
    });
    const pairingUrl = new URL('/pair', requestUrl);
    pairingUrl.searchParams.set('code', code);
    return { code, expiresAt, pairingUrl: pairingUrl.toString() };
  }

  async consumePairing(body: JsonObject): Promise<{ device: Device; token: string }> {
    if (typeof body['code'] !== 'string') {
      throw badRequest('INVALID_PAIRING_CODE', 'El código de emparejamiento es obligatorio.');
    }
    const code = normalizePairingCode(body['code']);
    if (code.length !== 8) {
      throw badRequest('INVALID_PAIRING_CODE', 'El código de emparejamiento no es válido.');
    }
    const deviceName = optionalName(body['deviceName'], 'deviceName');
    const token = createDeviceToken();
    const device = await this.repository.consumePairing({
      deviceId: crypto.randomUUID(),
      deviceName,
      tokenHash: await sha256(token),
      codeHash: await sha256(code),
      now: new Date().toISOString(),
    });
    if (!device) {
      throw new ApiError(
        410,
        'PAIRING_UNAVAILABLE',
        'El código ha caducado, ya se utilizó o no existe.',
      );
    }
    return { device, token };
  }
}
