import { classifyNormalizedProductName } from '../../src/shared/product-category';
import type {
  ImportedOffer,
  ImportedProduct,
  ParsedCarrefourProduct,
  SupermarketImportProvider,
} from '../domain/supermarket-import';
import { normalizeProductName } from '../validation';

const SITEMAP_INDEX = 'https://www.carrefour.es/crs/cdn-static/sitemap-food/index.xml';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

type JsonRecord = Record<string, unknown>;

const records = (value: unknown): JsonRecord[] => {
  if (Array.isArray(value)) return value.flatMap(records);
  if (!value || typeof value !== 'object') return [];
  const record = value as JsonRecord;
  return [record, ...records(record['@graph'])];
};

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const firstRecord = (value: unknown): JsonRecord | undefined => {
  if (Array.isArray(value)) return records(value)[0];
  return value && typeof value === 'object' ? (value as JsonRecord) : undefined;
};

const typeIncludes = (record: JsonRecord, expected: string): boolean => {
  const value = record['@type'];
  return Array.isArray(value) ? value.includes(expected) : value === expected;
};

const parseJsonLd = (document: string): JsonRecord[] => {
  const matches = document.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu,
  );
  const parsed: JsonRecord[] = [];
  for (const match of matches) {
    try {
      parsed.push(...records(JSON.parse(match[1])));
    } catch {
      // An unrelated malformed JSON-LD block must not invalidate other products.
    }
  }
  return parsed;
};

const xmlLocations = (document: string): string[] =>
  [...document.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/giu)].map((match) => match[1].trim());

const safeCarrefourUrl = (value: string, kind: 'sitemap' | 'product'): URL => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'www.carrefour.es') {
    throw new Error('CARREFOUR_SOURCE_NOT_ALLOWED');
  }
  const allowed =
    kind === 'sitemap'
      ? url.pathname.startsWith('/crs/cdn-static/sitemap-food/')
      : /^\/supermercado\/.+\/R-[A-Za-z0-9-]+\/p$/u.test(url.pathname);
  if (!allowed || url.username || url.password || url.port) {
    throw new Error('CARREFOUR_SOURCE_NOT_ALLOWED');
  }
  return url;
};

const cents = (value: string | undefined): number | null => {
  if (!value) return null;
  const match = /([0-9]+(?:[.,][0-9]{1,2})?)/u.exec(value.replace(/\s/gu, ''));
  if (!match) return null;
  const [whole, fraction = ''] = match[1].replace(',', '.').split('.');
  const result = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, '0'), 10);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
};

const dateOnly = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/u.exec(value);
  return match?.[1];
};

const readLimitedText = async (response: Response): Promise<string> => {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('CARREFOUR_RESPONSE_TOO_LARGE');
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return body + decoder.decode();
};

const unitPrice = (value: string | undefined): { cents: number | null; unit: string | null } => {
  const amount = cents(value);
  const unit = value ? /€\s*\/\s*([A-Za-z]+)/u.exec(value)?.[1]?.toLocaleLowerCase('es') : null;
  return { cents: amount, unit: unit ?? null };
};

const promotion = (
  text: string | undefined,
  normalPriceCents: number | null,
  offerPriceCents: number,
  validFrom: string,
  validUntil: string,
): ImportedOffer | null => {
  const normalized = normalizeProductName(text ?? '');
  const base = {
    label: text?.trim() || 'Precio especial',
    normalPriceCents,
    offerPriceCents,
    percentage: null,
    buyQuantity: null,
    payQuantity: null,
    validFrom,
    validUntil,
    channel: 'ONLINE' as const,
    geographicScope: 'ONLINE' as const,
    requiresLoyaltyCard: false,
    loyaltyProgram: null,
  };
  const multiBuy = /(\d+)\s*x\s*(\d+)/u.exec(normalized);
  if (multiBuy) {
    return {
      ...base,
      type: 'BUY_X_PAY_Y',
      buyQuantity: Number.parseInt(multiBuy[1], 10),
      payQuantity: Number.parseInt(multiBuy[2], 10),
    };
  }
  const secondUnit = /segunda unidad(?: al)? (\d{1,3})/u.exec(normalized);
  if (secondUnit) {
    return {
      ...base,
      type: 'SECOND_UNIT_DISCOUNT',
      percentage: Number.parseInt(secondUnit[1], 10),
    };
  }
  const cashback = /(\d{1,3}) (?:que )?vuelve/u.exec(normalized);
  if (cashback) {
    return {
      ...base,
      type: 'CASHBACK',
      percentage: Number.parseInt(cashback[1], 10),
      offerPriceCents: normalPriceCents ?? offerPriceCents,
    };
  }
  if (/club|pass|cheque ahorro/u.test(normalized)) {
    return {
      ...base,
      type: 'LOYALTY_PRICE',
      requiresLoyaltyCard: true,
      loyaltyProgram: 'El Club Carrefour',
    };
  }
  const percentage = /(\d{1,3})\s*%/u.exec(text ?? '');
  if (percentage) {
    return { ...base, type: 'PERCENTAGE_DISCOUNT', percentage: Number(percentage[1]) };
  }
  if (normalPriceCents !== null && normalPriceCents > offerPriceCents) {
    return { ...base, type: 'DIRECT_DISCOUNT' };
  }
  return text ? { ...base, type: 'SPECIAL_PRICE' } : null;
};

export class CarrefourImportProvider implements SupermarketImportProvider {
  readonly providerId = 'carrefour' as const;

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async discover(limit = 20): Promise<string[]> {
    const index = await this.fetchDocument(SITEMAP_INDEX, 'sitemap');
    const sitemap = xmlLocations(index).find((url) => {
      try {
        safeCarrefourUrl(url, 'sitemap');
        return true;
      } catch {
        return false;
      }
    });
    if (!sitemap) throw new Error('CARREFOUR_DISCOVERY_EMPTY');
    const productMap = await this.fetchDocument(sitemap, 'sitemap');
    return xmlLocations(productMap)
      .filter((url) => {
        try {
          safeCarrefourUrl(url, 'product');
          return true;
        } catch {
          return false;
        }
      })
      .slice(0, Math.min(Math.max(limit, 1), 100));
  }

  fetch(sourceUrl: string): Promise<string> {
    return this.fetchDocument(sourceUrl, 'product');
  }

  parse(document: string, sourceUrl: string): ParsedCarrefourProduct[] {
    safeCarrefourUrl(sourceUrl, 'product');
    return parseJsonLd(document)
      .filter((record) => typeIncludes(record, 'Product'))
      .flatMap((product): ParsedCarrefourProduct[] => {
        const offer = firstRecord(product['offers']);
        const name = stringValue(product['name']);
        const priceText = stringValue(offer?.['price']);
        const url = stringValue(product['url']) ?? sourceUrl;
        const externalId =
          stringValue(product['sku']) ??
          stringValue(product['productID']) ??
          /\/(R-[A-Za-z0-9-]+)\/p$/u.exec(new URL(url).pathname)?.[1];
        if (!name || !priceText || !externalId) return [];
        const brandRecord = firstRecord(product['brand']);
        const image = Array.isArray(product['image']) ? product['image'][0] : product['image'];
        const promotionText =
          stringValue(offer?.['description']) ?? stringValue(product['description']);
        return [
          {
            externalId,
            name,
            brand: stringValue(brandRecord?.['name']) ?? stringValue(product['brand']),
            ean: stringValue(product['gtin13']) ?? stringValue(product['gtin']),
            commercialCategory: stringValue(product['category']),
            imageUrl: stringValue(image),
            priceText,
            normalPriceText: stringValue(offer?.['highPrice']),
            unitPriceText: stringValue(offer?.['unitPrice']),
            promotionText,
            validFrom: dateOnly(stringValue(offer?.['validFrom'])),
            validUntil: dateOnly(
              stringValue(offer?.['priceValidUntil']) ?? stringValue(offer?.['validThrough']),
            ),
            sourceUrl,
          },
        ];
      });
  }

  normalize(product: ParsedCarrefourProduct): ImportedProduct {
    const priceCents = cents(product.priceText);
    if (!product.externalId || !product.name.trim() || priceCents === null) {
      throw new Error('CARREFOUR_INVALID_PRODUCT');
    }
    const normalizedName = normalizeProductName(product.name);
    const observed = new Date().toISOString().slice(0, 10);
    const validFrom = product.validFrom ?? observed;
    const validUntil = product.validUntil ?? validFrom;
    const normalPriceCents = cents(product.normalPriceText);
    const parsedUnitPrice = unitPrice(product.unitPriceText);
    return {
      externalId: product.externalId,
      ean: product.ean?.trim() || null,
      name: product.name.trim(),
      normalizedName,
      brand: product.brand?.trim() || null,
      commercialCategory: product.commercialCategory?.trim() || null,
      visualCategory: classifyNormalizedProductName(normalizedName),
      imageUrl: product.imageUrl?.trim() || null,
      packageQuantity: product.packageQuantity ?? null,
      packageUnit: product.packageUnit?.trim() || null,
      priceCents,
      unitPriceCents: parsedUnitPrice.cents,
      unitPriceUnit: parsedUnitPrice.unit,
      sourceUrl: safeCarrefourUrl(product.sourceUrl, 'product').toString(),
      channel: 'ONLINE',
      geographicScope: 'ONLINE',
      offer: promotion(product.promotionText, normalPriceCents, priceCents, validFrom, validUntil),
    };
  }

  private async fetchDocument(sourceUrl: string, kind: 'sitemap' | 'product'): Promise<string> {
    const url = safeCarrefourUrl(sourceUrl, kind);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await this.fetcher(url, {
        headers: { accept: kind === 'sitemap' ? 'application/xml,text/xml' : 'text/html' },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`CARREFOUR_HTTP_${response.status}`);
      safeCarrefourUrl(response.url || url.toString(), kind);
      const declaredSize = Number(response.headers.get('content-length') ?? '0');
      if (declaredSize > MAX_RESPONSE_BYTES) throw new Error('CARREFOUR_RESPONSE_TOO_LARGE');
      return readLimitedText(response);
    } finally {
      clearTimeout(timeout);
    }
  }
}
