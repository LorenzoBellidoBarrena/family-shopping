import { badRequest } from './errors';
import { UNITS, type ClearAction, type ItemValues, type Unit } from './domain/types';

export type JsonObject = Record<string, unknown>;

export const readJsonObject = async (request: Request): Promise<JsonObject> => {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw badRequest('INVALID_JSON', 'El cuerpo debe ser JSON válido.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badRequest('INVALID_BODY', 'El cuerpo debe ser un objeto JSON.');
  }
  return value as JsonObject;
};

export const optionalName = (value: unknown, field = 'name'): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw badRequest('INVALID_INPUT', `${field} debe ser texto.`);
  }
  const trimmed = value.trim().replace(/\s+/gu, ' ');
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw badRequest('INVALID_INPUT', `${field} debe tener entre 1 y 80 caracteres.`);
  }
  return trimmed;
};

export const requiredName = (value: unknown, maximum = 120): string => {
  if (typeof value !== 'string') {
    throw badRequest('INVALID_NAME', 'El nombre es obligatorio.');
  }
  const trimmed = value.trim().replace(/\s+/gu, ' ');
  if (trimmed.length === 0 || trimmed.length > maximum) {
    throw badRequest('INVALID_NAME', `El nombre debe tener entre 1 y ${maximum} caracteres.`);
  }
  return trimmed;
};

export const normalizeProductName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es-ES')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();

export const parseQuantityMilli = (value: unknown): number => {
  if (value === undefined) return 1000;
  if (typeof value !== 'string' || !/^\d{1,6}(?:[.,]\d{1,3})?$/u.test(value)) {
    throw badRequest(
      'INVALID_QUANTITY',
      'quantity debe ser texto decimal positivo con hasta tres decimales.',
    );
  }
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  const milli =
    Number.parseInt(whole, 10) * 1000 + Number.parseInt(fraction.padEnd(3, '0') || '0', 10);
  if (!Number.isSafeInteger(milli) || milli <= 0) {
    throw badRequest('INVALID_QUANTITY', 'quantity debe ser mayor que cero.');
  }
  return milli;
};

export const quantityMilliToString = (milli: number): string => {
  const whole = Math.floor(milli / 1000);
  const fraction = String(milli % 1000)
    .padStart(3, '0')
    .replace(/0+$/u, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
};

const parseUnit = (value: unknown): Unit => {
  const unit = value === undefined ? 'unidad' : value;
  if (typeof unit !== 'string' || !(UNITS as readonly string[]).includes(unit)) {
    throw badRequest('INVALID_UNIT', `unit debe ser una de: ${UNITS.join(', ')}.`);
  }
  return unit as Unit;
};

const parseSupermarketId = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/u.test(value)) {
    throw badRequest('INVALID_SUPERMARKET', 'supermarketId no es válido.');
  }
  return value;
};

export const parseItemValues = (body: JsonObject): ItemValues => {
  const name = requiredName(body['name']);
  return {
    name,
    normalizedName: normalizeProductName(name),
    quantityMilli: parseQuantityMilli(body['quantity']),
    unit: parseUnit(body['unit']),
    supermarketId: parseSupermarketId(body['supermarketId']),
  };
};

export const parseItemPatch = (body: JsonObject, current: ItemValues): ItemValues => {
  const name = body['name'] === undefined ? current.name : requiredName(body['name']);
  return {
    name,
    normalizedName: normalizeProductName(name),
    quantityMilli:
      body['quantity'] === undefined ? current.quantityMilli : parseQuantityMilli(body['quantity']),
    unit: body['unit'] === undefined ? current.unit : parseUnit(body['unit']),
    supermarketId:
      body['supermarketId'] === undefined
        ? current.supermarketId
        : parseSupermarketId(body['supermarketId']),
  };
};

export const parseClearAction = (value: unknown): ClearAction => {
  if (value !== 'CANCEL' && value !== 'CLEAR_ALL' && value !== 'CARRY_PENDING') {
    throw badRequest('INVALID_ACTION', 'action debe ser CANCEL, CLEAR_ALL o CARRY_PENDING.');
  }
  return value;
};
