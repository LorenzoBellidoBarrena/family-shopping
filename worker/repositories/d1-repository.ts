import { conflict, notFound } from '../errors';
import {
  classifyNormalizedProductName,
  type ProductCategory,
} from '../../src/shared/product-category';
import type {
  ClearAction,
  Device,
  Household,
  ItemValues,
  ProductPreference,
  ShoppingCycle,
  ShoppingItem,
  Supermarket,
  Unit,
} from '../domain/types';
import { quantityMilliToString } from '../validation';

interface HouseholdRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface DeviceRow {
  id: string;
  household_id: string;
  name: string | null;
  created_at: string;
  last_seen_at: string;
}

interface CycleRow {
  id: string;
  household_id: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CLEARED';
  created_at: string;
  closed_at: string | null;
  close_reason: string | null;
}

interface ItemRow {
  id: string;
  shopping_cycle_id: string;
  name: string;
  normalized_name: string;
  quantity_milli: number;
  unit: Unit;
  supermarket_id: string | null;
  category: ProductCategory;
  checked: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  checked_at: string | null;
}

interface SupermarketRow {
  id: string;
  code: string;
  name: string;
}

interface PreferenceRow {
  id: string;
  normalized_name: string;
  display_name: string;
  last_supermarket_id: string | null;
  last_unit: Unit;
  last_quantity_milli: number;
  category: ProductCategory | null;
  use_count: number;
  updated_at: string;
}

const mapHousehold = (row: HouseholdRow): Household => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapDevice = (row: DeviceRow): Device => ({
  id: row.id,
  householdId: row.household_id,
  name: row.name,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
});

const mapItem = (row: ItemRow): ShoppingItem => ({
  id: row.id,
  shoppingCycleId: row.shopping_cycle_id,
  name: row.name,
  normalizedName: row.normalized_name,
  quantity: quantityMilliToString(row.quantity_milli),
  unit: row.unit,
  supermarketId: row.supermarket_id,
  category: row.category,
  checked: row.checked === 1,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  checkedAt: row.checked_at,
});

export class D1Repository {
  constructor(private readonly db: D1Database) {}

  async getHousehold(): Promise<Household | null> {
    const row = await this.db
      .prepare(
        `SELECT h.id, h.name, h.created_at, h.updated_at
         FROM app_state s JOIN households h ON h.id = s.household_id
         WHERE s.singleton = 1`,
      )
      .first<HouseholdRow>();
    return row ? mapHousehold(row) : null;
  }

  async bootstrap(input: {
    householdId: string;
    householdName: string;
    deviceId: string;
    deviceName: string | null;
    tokenHash: string;
    cycleId: string;
    now: string;
  }): Promise<{ household: Household; device: Device; cycle: ShoppingCycle }> {
    try {
      await this.db.batch([
        this.db
          .prepare(`INSERT INTO households (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
          .bind(input.householdId, input.householdName, input.now, input.now),
        this.db
          .prepare(`INSERT INTO app_state (singleton, household_id) VALUES (1, ?) `)
          .bind(input.householdId),
        this.db
          .prepare(
            `INSERT INTO devices
               (id, household_id, token_hash, name, created_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            input.deviceId,
            input.householdId,
            input.tokenHash,
            input.deviceName,
            input.now,
            input.now,
          ),
        this.db
          .prepare(
            `INSERT INTO shopping_cycles (id, household_id, status, created_at)
             VALUES (?, ?, 'ACTIVE', ?)`,
          )
          .bind(input.cycleId, input.householdId, input.now),
        this.db
          .prepare(`INSERT INTO household_revisions (household_id, revision) VALUES (?, 0)`)
          .bind(input.householdId),
      ]);
    } catch {
      throw conflict('HOUSEHOLD_ALREADY_INITIALIZED', 'El hogar ya está inicializado.');
    }

    return {
      household: {
        id: input.householdId,
        name: input.householdName,
        createdAt: input.now,
        updatedAt: input.now,
      },
      device: {
        id: input.deviceId,
        householdId: input.householdId,
        name: input.deviceName,
        createdAt: input.now,
        lastSeenAt: input.now,
      },
      cycle: {
        id: input.cycleId,
        householdId: input.householdId,
        status: 'ACTIVE',
        createdAt: input.now,
        closedAt: null,
        closeReason: null,
        items: [],
      },
    };
  }

  async findActiveDevice(tokenHash: string): Promise<Device | null> {
    const row = await this.db
      .prepare(
        `SELECT id, household_id, name, created_at, last_seen_at
         FROM devices WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .bind(tokenHash)
      .first<DeviceRow>();
    return row ? mapDevice(row) : null;
  }

  async touchDevice(deviceId: string, now: string): Promise<void> {
    await this.db
      .prepare(`UPDATE devices SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL`)
      .bind(now, deviceId)
      .run();
  }

  async nextRevision(householdId: string): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO household_revisions (household_id, revision) VALUES (?, 1)
         ON CONFLICT(household_id) DO UPDATE SET revision = revision + 1
         RETURNING revision`,
      )
      .bind(householdId)
      .first<{ revision: number }>();
    if (!row) throw new Error('Unable to allocate household revision');
    return row.revision;
  }

  async createPairing(input: {
    id: string;
    householdId: string;
    codeHash: string;
    deviceId: string;
    now: string;
    expiresAt: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO pairing_codes
           (id, household_id, code_hash, created_by_device_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.id, input.householdId, input.codeHash, input.deviceId, input.now, input.expiresAt)
      .run();
  }

  async consumePairing(input: {
    deviceId: string;
    deviceName: string | null;
    tokenHash: string;
    codeHash: string;
    now: string;
  }): Promise<Device | null> {
    const results = await this.db.batch<DeviceRow>([
      this.db
        .prepare(
          `INSERT INTO devices
             (id, household_id, token_hash, name, created_at, last_seen_at)
           SELECT ?, household_id, ?, ?, ?, ?
           FROM pairing_codes
           WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
           RETURNING id, household_id, name, created_at, last_seen_at`,
        )
        .bind(
          input.deviceId,
          input.tokenHash,
          input.deviceName,
          input.now,
          input.now,
          input.codeHash,
          input.now,
        ),
      this.db
        .prepare(
          `UPDATE pairing_codes SET used_at = ?
           WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
        )
        .bind(input.now, input.codeHash, input.now),
    ]);
    const row = results[0]?.results[0];
    return row ? mapDevice(row) : null;
  }

  async getSupermarkets(): Promise<Supermarket[]> {
    const { results } = await this.db
      .prepare(`SELECT id, code, name FROM supermarkets WHERE active = 1 ORDER BY sort_order`)
      .all<SupermarketRow>();
    return results;
  }

  async supermarketExists(id: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT id FROM supermarkets WHERE id = ? AND active = 1`)
      .bind(id)
      .first<{ id: string }>();
    return row !== null;
  }

  async getActiveCycle(householdId: string): Promise<ShoppingCycle> {
    const cycle = await this.db
      .prepare(
        `SELECT id, household_id, status, created_at, closed_at, close_reason
         FROM shopping_cycles WHERE household_id = ? AND status = 'ACTIVE'`,
      )
      .bind(householdId)
      .first<CycleRow>();
    if (!cycle) throw notFound('No existe un ciclo de compra activo.');
    const { results } = await this.db
      .prepare(
        `SELECT id, shopping_cycle_id, name, normalized_name, quantity_milli, unit,
                supermarket_id, category, checked, sort_order, created_at, updated_at, checked_at
         FROM shopping_items WHERE shopping_cycle_id = ? ORDER BY sort_order, created_at, id`,
      )
      .bind(cycle.id)
      .all<ItemRow>();
    return {
      id: cycle.id,
      householdId: cycle.household_id,
      status: cycle.status,
      createdAt: cycle.created_at,
      closedAt: cycle.closed_at,
      closeReason: cycle.close_reason,
      items: results.map(mapItem),
    };
  }

  async getActiveItem(householdId: string, itemId: string): Promise<ShoppingItem> {
    const row = await this.db
      .prepare(
        `SELECT i.id, i.shopping_cycle_id, i.name, i.normalized_name, i.quantity_milli,
                i.unit, i.supermarket_id, i.category, i.checked, i.sort_order, i.created_at,
                i.updated_at, i.checked_at
         FROM shopping_items i
         JOIN shopping_cycles c ON c.id = i.shopping_cycle_id
         WHERE i.id = ? AND c.household_id = ? AND c.status = 'ACTIVE'`,
      )
      .bind(itemId, householdId)
      .first<ItemRow>();
    if (!row) throw notFound('El producto no existe en la lista activa.');
    return mapItem(row);
  }

  async addItem(
    householdId: string,
    itemId: string,
    preferenceId: string,
    values: ItemValues,
    now: string,
  ): Promise<ShoppingItem> {
    const cycle = await this.getActiveCycle(householdId);
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO shopping_items
             (id, shopping_cycle_id, name, normalized_name, quantity_milli, unit,
              supermarket_id, category, checked, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0,
             (SELECT COALESCE(MAX(sort_order), 0) + 1000 FROM shopping_items
              WHERE shopping_cycle_id = ?), ?, ?)`,
        )
        .bind(
          itemId,
          cycle.id,
          values.name,
          values.normalizedName,
          values.quantityMilli,
          values.unit,
          values.supermarketId,
          values.category,
          cycle.id,
          now,
          now,
        ),
      this.preferenceStatement(householdId, preferenceId, values, now, true),
    ]);
    return this.getActiveItem(householdId, itemId);
  }

  async updateItem(
    householdId: string,
    itemId: string,
    preferenceId: string,
    values: ItemValues,
    now: string,
  ): Promise<ShoppingItem> {
    await this.getActiveItem(householdId, itemId);
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE shopping_items SET name = ?, normalized_name = ?, quantity_milli = ?,
             unit = ?, supermarket_id = ?, category = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(
          values.name,
          values.normalizedName,
          values.quantityMilli,
          values.unit,
          values.supermarketId,
          values.category,
          now,
          itemId,
        ),
      this.preferenceStatement(householdId, preferenceId, values, now, false),
    ]);
    return this.getActiveItem(householdId, itemId);
  }

  async toggleItem(householdId: string, itemId: string, now: string): Promise<ShoppingItem> {
    await this.getActiveItem(householdId, itemId);
    await this.db
      .prepare(
        `UPDATE shopping_items
         SET checked = CASE checked WHEN 0 THEN 1 ELSE 0 END,
             checked_at = CASE checked WHEN 0 THEN ? ELSE NULL END,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, now, itemId)
      .run();
    return this.getActiveItem(householdId, itemId);
  }

  async deleteItem(householdId: string, itemId: string): Promise<void> {
    await this.getActiveItem(householdId, itemId);
    await this.db.prepare(`DELETE FROM shopping_items WHERE id = ?`).bind(itemId).run();
  }

  async completeCycle(
    householdId: string,
    newCycleId: string,
    now: string,
  ): Promise<{
    closedCycleId: string;
    cycle: ShoppingCycle;
  }> {
    const current = await this.getActiveCycle(householdId);
    if (current.items.length === 0 || current.items.some((item) => !item.checked)) {
      throw conflict(
        'PENDING_ITEMS',
        'La compra sólo puede completarse cuando todos los productos están comprados.',
      );
    }
    await this.replaceCycle(current, newCycleId, now, 'COMPLETED', 'COMPLETED', []);
    return { closedCycleId: current.id, cycle: await this.getActiveCycle(householdId) };
  }

  async clearCycle(
    householdId: string,
    action: ClearAction,
    newCycleId: string,
    now: string,
  ): Promise<{ cancelled: boolean; closedCycleId?: string; cycle: ShoppingCycle }> {
    const current = await this.getActiveCycle(householdId);
    if (action === 'CANCEL') return { cancelled: true, cycle: current };
    const pending = action === 'CARRY_PENDING' ? current.items.filter((item) => !item.checked) : [];
    await this.replaceCycle(current, newCycleId, now, 'CLEARED', action, pending);
    return {
      cancelled: false,
      closedCycleId: current.id,
      cycle: await this.getActiveCycle(householdId),
    };
  }

  async getSuggestions(
    householdId: string,
    query: string,
    limit: number,
  ): Promise<ProductPreference[]> {
    const escaped = query.replace(/[\\%_]/gu, (character) => `\\${character}`);
    const { results } = await this.db
      .prepare(
        `SELECT id, normalized_name, display_name, last_supermarket_id, last_unit,
                last_quantity_milli, category, use_count, updated_at
         FROM product_preferences
         WHERE household_id = ? AND normalized_name LIKE ? ESCAPE '\\'
         ORDER BY use_count DESC, updated_at DESC LIMIT ?`,
      )
      .bind(householdId, `${escaped}%`, limit)
      .all<PreferenceRow>();
    return results.map((row) => ({
      id: row.id,
      normalizedName: row.normalized_name,
      name: row.display_name,
      supermarketId: row.last_supermarket_id,
      category: row.category ?? classifyNormalizedProductName(row.normalized_name),
      unit: row.last_unit,
      quantity: quantityMilliToString(row.last_quantity_milli),
      useCount: row.use_count,
      updatedAt: row.updated_at,
    }));
  }

  async getPreferenceCategory(
    householdId: string,
    normalizedName: string,
  ): Promise<ProductCategory | null> {
    const row = await this.db
      .prepare(
        `SELECT category FROM product_preferences
         WHERE household_id = ? AND normalized_name = ?`,
      )
      .bind(householdId, normalizedName)
      .first<{ category: ProductCategory | null }>();
    return row?.category ?? null;
  }

  private preferenceStatement(
    householdId: string,
    preferenceId: string,
    values: ItemValues,
    now: string,
    increment: boolean,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO product_preferences
           (id, household_id, normalized_name, display_name, last_supermarket_id,
            last_unit, last_quantity_milli, category, use_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(household_id, normalized_name) DO UPDATE SET
           display_name = excluded.display_name,
           last_supermarket_id = excluded.last_supermarket_id,
           last_unit = excluded.last_unit,
           last_quantity_milli = excluded.last_quantity_milli,
           category = excluded.category,
           use_count = product_preferences.use_count + ?,
           updated_at = excluded.updated_at`,
      )
      .bind(
        preferenceId,
        householdId,
        values.normalizedName,
        values.name,
        values.supermarketId,
        values.unit,
        values.quantityMilli,
        values.category,
        now,
        now,
        increment ? 1 : 0,
      );
  }

  private async replaceCycle(
    current: ShoppingCycle,
    newCycleId: string,
    now: string,
    status: 'COMPLETED' | 'CLEARED',
    reason: string,
    itemsToCarry: ShoppingItem[],
  ): Promise<void> {
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `UPDATE shopping_cycles SET status = ?, closed_at = ?, close_reason = ?
           WHERE id = ? AND status = 'ACTIVE'`,
        )
        .bind(status, now, reason, current.id),
      this.db
        .prepare(
          `INSERT INTO shopping_cycles (id, household_id, status, created_at)
           VALUES (?, ?, 'ACTIVE', ?)`,
        )
        .bind(newCycleId, current.householdId, now),
    ];
    for (const item of itemsToCarry) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO shopping_items
               (id, shopping_cycle_id, name, normalized_name, quantity_milli, unit,
                supermarket_id, category, checked, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            newCycleId,
            item.name,
            item.normalizedName,
            this.quantityStringToMilli(item.quantity),
            item.unit,
            item.supermarketId,
            item.category,
            item.sortOrder,
            now,
            now,
          ),
      );
    }
    await this.db.batch(statements);
  }

  private quantityStringToMilli(quantity: string): number {
    const [whole, fraction = ''] = quantity.split('.');
    return Number.parseInt(whole, 10) * 1000 + Number.parseInt(fraction.padEnd(3, '0') || '0', 10);
  }
}
