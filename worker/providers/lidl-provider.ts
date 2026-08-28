import { classifyNormalizedProductName } from '../../src/shared/product-category';
import type {
  ImportedOffer,
  ImportedProduct,
  ImportedStore,
  OfferType,
  ParsedSupermarketProduct,
  SupermarketImportProvider,
} from '../domain/supermarket-import';
import { normalizeProductName } from '../validation';

const OVERVIEW_URL =
  'https://www.lidl.es/c/descubre-nuevas-ofertas-cada-semana-folletos-lidl/s10087402';
const ZAFRA_STORE_URL = 'https://www.lidl.es/s/es-ES/tiendas/zafra/c-torre-san-francisco-2a/';
const FLYER_API_ORIGIN = 'https://endpoints.leaflets.schwarz';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 9_000;
type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const nestedText = (value: unknown): string | undefined => {
  const direct = text(value);
  if (direct) return direct;
  const nested = record(value);
  return text(nested?.['text']) ?? text(nested?.['display']) ?? text(nested?.['value']);
};

const safeLidlUrl = (value: string): URL => {
  const url = new URL(value);
  const isOverview =
    url.hostname === 'www.lidl.es' && url.pathname === new URL(OVERVIEW_URL).pathname;
  const isStore =
    url.hostname === 'www.lidl.es' && url.pathname === new URL(ZAFRA_STORE_URL).pathname;
  const isFlyer =
    url.origin === FLYER_API_ORIGIN &&
    url.pathname === '/v4/flyer' &&
    /^[A-Za-z0-9-]{1,160}$/u.test(url.searchParams.get('flyer_identifier') ?? '') &&
    url.searchParams.get('region_id') === '0' &&
    [...url.searchParams.keys()].every((key) => key === 'flyer_identifier' || key === 'region_id');
  if (
    url.protocol !== 'https:' ||
    (!isOverview && !isStore && !isFlyer) ||
    url.hash ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error('LIDL_SOURCE_NOT_ALLOWED');
  }
  return url;
};

const readLimitedText = async (response: Response): Promise<string> => {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('LIDL_RESPONSE_TOO_LARGE');
    }
    result += decoder.decode(chunk.value, { stream: true });
  }
  return result + decoder.decode();
};

const moneyCents = (value: string | undefined): number | null => {
  if (!value) return null;
  const match = /^\s*((?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{1,2})?|\d+\.\d{1,2})\s*€\s*$/u.exec(value);
  if (!match) return null;
  let amount = match[1];
  if (amount.includes(',')) amount = amount.replaceAll('.', '').replace(',', '.');
  else if (/^\d{1,3}(?:\.\d{3})+$/u.test(amount)) amount = amount.replaceAll('.', '');
  const parsed = Number(amount);
  const cents = Math.round(parsed * 100);
  return Number.isFinite(parsed) && parsed >= 0 && Number.isSafeInteger(cents) ? cents : null;
};

const unitPrice = (value: string | undefined): { cents: number; unit: string } | null => {
  const match = /^\s*(.+?\s*€)\s*\/\s*(kg|l|litro|ud|unidad)\s*$/iu.exec(value ?? '');
  if (!match) return null;
  const cents = moneyCents(match[1]);
  return cents === null ? null : { cents, unit: match[2].toLocaleLowerCase('es') };
};

const isoDate = (value: unknown): string | undefined => {
  const candidate = text(value);
  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) return undefined;
  const date = new Date(`${candidate}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === candidate
    ? candidate
    : undefined;
};

const packageDetails = (name: string): { quantity?: number; unit?: string } => {
  const match = /(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|unidades?|uds?)\b/iu.exec(name);
  if (!match) return {};
  const quantity = Number(match[1].replace(',', '.'));
  return Number.isFinite(quantity) ? { quantity, unit: match[2].toLocaleLowerCase('es') } : {};
};

const safeImageUrl = (value: unknown): string | undefined => {
  const candidate = text(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' &&
      ['imgproxy.leaflets.schwarz', 'lidl.media.schwarz'].includes(url.hostname)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const percentageFrom = (value: string | undefined): number | null => {
  const match = /(?:-|ahorra\s+)(\d{1,3})\s*%/iu.exec(value ?? '');
  if (!match) return null;
  const result = Number.parseInt(match[1], 10);
  return result >= 1 && result <= 100 ? result : null;
};

const promotionType = (value: string | undefined, loyalty: boolean): OfferType | undefined => {
  const normalized = normalizeProductName(value ?? '');
  if (/\b(?:3\s*x\s*2|3x2)\b/u.test(normalized)) return 'BUY_X_PAY_Y';
  if (/2(?:a|ª)? unidad/u.test(normalized)) return 'SECOND_UNIT_DISCOUNT';
  if (loyalty) return 'LOYALTY_PRICE';
  if (percentageFrom(value) !== null) return 'PERCENTAGE_DISCOUNT';
  return value ? 'SPECIAL_PRICE' : undefined;
};

const offerFrom = (product: ParsedSupermarketProduct, priceCents: number): ImportedOffer | null => {
  const normalPriceCents = moneyCents(product.normalPriceText);
  const loyalty = product.promotionRequiresLoyalty === true;
  const type =
    product.promotionTypeHint ??
    promotionType(product.promotionText, loyalty) ??
    (normalPriceCents !== null && normalPriceCents > priceCents ? 'DIRECT_DISCOUNT' : undefined);
  if (!type) return null;
  const label = product.promotionText?.trim() || 'Precio promocional';
  const multiBuy = /(\d+)\s*x\s*(\d+)/iu.exec(label);
  return {
    type,
    label,
    normalPriceCents,
    offerPriceCents: priceCents,
    percentage: percentageFrom(label),
    buyQuantity: multiBuy ? Number.parseInt(multiBuy[1], 10) : null,
    payQuantity: multiBuy ? Number.parseInt(multiBuy[2], 10) : null,
    validFrom: product.validFrom ?? null,
    validUntil: product.validUntil ?? null,
    channel: 'STORE',
    geographicScope: 'UNKNOWN',
    requiresLoyaltyCard: loyalty,
    loyaltyProgram: loyalty ? 'LIDL_PLUS' : null,
  };
};

export class LidlProvider implements SupermarketImportProvider {
  readonly providerId = 'lidl' as const;
  readonly catalogStore = {
    externalId: 'leaflets-es-region-0',
    name: 'Lidl España · folleto general',
    address: 'Folleto público de alimentación',
    city: 'España',
    postalCode: 'N/A',
    latitude: null,
    longitude: null,
    active: true,
  } as const;
  private limit = 100;

  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  async discover(limit = 100): Promise<string[]> {
    this.limit = Math.min(Math.max(limit, 1), 100);
    return this.parseDiscovery(await this.fetchDocument(OVERVIEW_URL)).slice(0, 2);
  }

  parseDiscovery(document: string): string[] {
    const foodStart = document.search(
      /<div class="section-head">\s*Folletos de Alimentaci[oó]n\s*<\/div>/iu,
    );
    if (foodStart < 0) throw new Error('LIDL_FOOD_LEAFLETS_MISSING');
    const nextSection = document.indexOf('<div class="section-head">', foodStart + 30);
    const foodSection = document.slice(foodStart, nextSection < 0 ? undefined : nextSection);
    const identifiers = [...foodSection.matchAll(/id="flyer-([A-Za-z0-9-]{1,160})"/gu)].map(
      (match) => match[1],
    );
    return [...new Set(identifiers)].map((identifier) => {
      const url = new URL('/v4/flyer', FLYER_API_ORIGIN);
      url.searchParams.set('flyer_identifier', identifier);
      url.searchParams.set('region_id', '0');
      return url.toString();
    });
  }

  async discoverStores(): Promise<string[]> {
    return [ZAFRA_STORE_URL];
  }

  fetch(sourceUrl: string): Promise<string> {
    return this.fetchDocument(sourceUrl);
  }

  parse(document: string, sourceUrl: string): ParsedSupermarketProduct[] {
    const url = safeLidlUrl(sourceUrl);
    if (url.origin !== FLYER_API_ORIGIN) throw new Error('LIDL_FLYER_SOURCE_REQUIRED');
    let payload: JsonRecord;
    try {
      payload = record(JSON.parse(document)) ?? {};
    } catch (error) {
      throw new Error('LIDL_FLYER_JSON_INVALID', { cause: error });
    }
    const flyer = record(payload['flyer']);
    if (!flyer || payload['success'] !== true) throw new Error('LIDL_FLYER_JSON_INVALID');
    if (normalizeProductName(text(flyer['subcategory']) ?? '') !== 'folletos de alimentacion') {
      throw new Error('LIDL_NON_FOOD_FLYER');
    }
    const validFrom = isoDate(flyer['offerStartDate']);
    const validUntil = isoDate(flyer['offerEndDate']);
    const products = Array.isArray(flyer['products']) ? flyer['products'] : [];
    return products
      .flatMap((entry): ParsedSupermarketProduct[] => {
        const product = record(entry);
        if (!product) return [];
        const externalId =
          text(product['id']) ?? text(product['productId']) ?? text(product['articleId']);
        const name = text(product['title']) ?? text(product['name']);
        const priceText = nestedText(product['price']);
        if (!externalId || !name || moneyCents(priceText) === null) return [];
        const promotionText =
          nestedText(product['promotion']) ?? text(product['promotionText']) ?? undefined;
        const loyalty = /lidl\s*plus/iu.test(promotionText ?? '');
        const details = packageDetails(name);
        return [
          {
            externalId,
            name,
            brand: text(product['brand']),
            ean: text(product['ean']),
            commercialCategory: text(product['category']),
            imageUrl: safeImageUrl(product['imageUrl'] ?? product['image']),
            packageQuantity: details.quantity,
            packageUnit: details.unit,
            priceText: priceText!,
            normalPriceText: nestedText(product['normalPrice']),
            unitPriceText: nestedText(product['unitPrice']),
            promotionText,
            validFrom,
            validUntil,
            sourceUrl: url.toString(),
            promotionRequiresLoyalty: loyalty,
            promotionTypeHint: promotionType(promotionText, loyalty),
            channel: 'STORE',
            geographicScope: 'UNKNOWN',
          },
        ];
      })
      .slice(0, this.limit);
  }

  normalize(product: ParsedSupermarketProduct): ImportedProduct {
    const priceCents = moneyCents(product.priceText);
    if (!product.externalId || !product.name.trim() || priceCents === null) {
      throw new Error('LIDL_INVALID_PRODUCT');
    }
    const normalizedName = normalizeProductName(product.name);
    const unit = unitPrice(product.unitPriceText);
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
      unitPriceCents: unit?.cents ?? null,
      unitPriceUnit: unit?.unit ?? null,
      sourceUrl: safeLidlUrl(product.sourceUrl).toString(),
      channel: 'STORE',
      geographicScope: 'UNKNOWN',
      offer: offerFrom(product, priceCents),
    };
  }

  parseStores(document: string, sourceUrl: string): ImportedStore[] {
    if (safeLidlUrl(sourceUrl).toString() !== ZAFRA_STORE_URL) {
      throw new Error('LIDL_STORE_SOURCE_NOT_ALLOWED');
    }
    const scripts = [
      ...document.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/giu),
    ];
    for (const script of scripts) {
      try {
        const store = record(JSON.parse(script[1]));
        const address = record(store?.['address']);
        const geo = record(store?.['geo']);
        const name = text(store?.['name']);
        const street = text(address?.['streetAddress']);
        const postalCode = text(address?.['postalCode']);
        const latitude = typeof geo?.['latitude'] === 'number' ? geo['latitude'] : null;
        const longitude = typeof geo?.['longitude'] === 'number' ? geo['longitude'] : null;
        if (
          store?.['@type'] !== 'GroceryStore' ||
          text(address?.['addressLocality']) !== 'Zafra' ||
          !name ||
          !street ||
          postalCode !== '06300' ||
          latitude === null ||
          !Number.isFinite(latitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude === null ||
          !Number.isFinite(longitude) ||
          longitude < -180 ||
          longitude > 180
        ) {
          continue;
        }
        return [
          {
            externalId: 'zafra-c-torre-san-francisco-2a',
            name,
            address: street,
            city: 'Zafra',
            postalCode,
            latitude,
            longitude,
            active: true,
          },
        ];
      } catch {
        continue;
      }
    }
    throw new Error('LIDL_ZAFRA_STORE_MISSING');
  }

  private async fetchDocument(sourceUrl: string, redirectCount = 0): Promise<string> {
    const url = safeLidlUrl(sourceUrl);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await this.fetcher(url, {
          headers: {
            accept: url.origin === FLYER_API_ORIGIN ? 'application/json' : 'text/html',
            'user-agent': 'family-shopping/1.0 (public Lidl leaflet importer)',
          },
          redirect: 'manual',
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location || redirectCount >= 1) throw new Error('LIDL_REDIRECT_BLOCKED');
          let target: URL;
          try {
            target = safeLidlUrl(new URL(location, url).toString());
          } catch {
            throw new Error('LIDL_REDIRECT_BLOCKED');
          }
          return this.fetchDocument(target.toString(), redirectCount + 1);
        }
        if (!response.ok) throw new Error(`LIDL_HTTP_${response.status}`);
        const length = Number(response.headers.get('content-length') ?? '0');
        if (length > MAX_RESPONSE_BYTES) throw new Error('LIDL_RESPONSE_TOO_LARGE');
        return await readLimitedText(response);
      } catch (error) {
        lastError = error;
        if (attempt > 0 || (error instanceof Error && /LIDL_HTTP_4\d\d/u.test(error.message))) {
          throw error;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }
}
