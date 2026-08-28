import type { Device } from '../domain/types';
import { badRequest } from '../errors';
import { D1Repository } from '../repositories/d1-repository';
import { classifyNormalizedProductName } from '../../src/shared/product-category';
import {
  normalizeProductName,
  parseClearAction,
  parseItemPatch,
  parseItemValues,
  parseProductCategory,
  parseQuantityMilli,
  requiredName,
  type JsonObject,
} from '../validation';

export class ShoppingService {
  constructor(private readonly repository: D1Repository) {}

  getActiveCycle(device: Device) {
    return this.repository.getActiveCycle(device.householdId);
  }

  getSupermarkets() {
    return this.repository.getSupermarkets();
  }

  async addItem(device: Device, body: JsonObject) {
    const normalizedName = normalizeProductName(requiredName(body['name']));
    const requestedCategory = parseProductCategory(body['category']);
    const learnedCategory = await this.repository.getPreferenceCategory(
      device.householdId,
      normalizedName,
    );
    const category =
      requestedCategory ?? learnedCategory ?? classifyNormalizedProductName(normalizedName);
    const values = parseItemValues(body, category);
    await this.validateSupermarket(values.supermarketId);
    return this.repository.addItem(
      device.householdId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      values,
      new Date().toISOString(),
    );
  }

  async updateItem(device: Device, itemId: string, body: JsonObject) {
    const current = await this.repository.getActiveItem(device.householdId, itemId);
    const values = parseItemPatch(body, {
      name: current.name,
      normalizedName: current.normalizedName,
      quantityMilli: parseQuantityMilli(current.quantity),
      unit: current.unit,
      supermarketId: current.supermarketId,
      category: current.category,
    });
    await this.validateSupermarket(values.supermarketId);
    return this.repository.updateItem(
      device.householdId,
      itemId,
      crypto.randomUUID(),
      values,
      new Date().toISOString(),
    );
  }

  toggleItem(device: Device, itemId: string) {
    return this.repository.toggleItem(device.householdId, itemId, new Date().toISOString());
  }

  deleteItem(device: Device, itemId: string) {
    return this.repository.deleteItem(device.householdId, itemId);
  }

  complete(device: Device) {
    return this.repository.completeCycle(
      device.householdId,
      crypto.randomUUID(),
      new Date().toISOString(),
    );
  }

  clear(device: Device, body: JsonObject) {
    return this.repository.clearCycle(
      device.householdId,
      parseClearAction(body['action']),
      crypto.randomUUID(),
      new Date().toISOString(),
    );
  }

  suggestions(device: Device, url: URL) {
    const rawQuery = url.searchParams.get('query') ?? '';
    if (rawQuery.length > 120) {
      throw badRequest('INVALID_QUERY', 'query no puede superar 120 caracteres.');
    }
    const rawLimit = url.searchParams.get('limit') ?? '10';
    if (!/^\d{1,2}$/u.test(rawLimit)) {
      throw badRequest('INVALID_LIMIT', 'limit debe ser un entero entre 1 y 20.');
    }
    const limit = Number.parseInt(rawLimit, 10);
    if (limit < 1 || limit > 20) {
      throw badRequest('INVALID_LIMIT', 'limit debe ser un entero entre 1 y 20.');
    }
    return this.repository.getSuggestions(
      device.householdId,
      normalizeProductName(rawQuery),
      limit,
    );
  }

  private async validateSupermarket(supermarketId: string | null): Promise<void> {
    if (supermarketId && !(await this.repository.supermarketExists(supermarketId))) {
      throw badRequest('INVALID_SUPERMARKET', 'El supermercado indicado no existe.');
    }
  }
}
