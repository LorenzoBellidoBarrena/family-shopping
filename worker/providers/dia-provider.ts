import { classifyNormalizedProductName } from '../../src/shared/product-category';
import { classifyOfferBrowseCategory } from '../../src/shared/offer-browse-category';
import type {
  ImportedOffer,
  ImportedProduct,
  ImportedStore,
  OfferType,
  ParsedSupermarketProduct,
  SupermarketImportProvider,
} from '../domain/supermarket-import';
import { normalizeProductName } from '../validation';

const CATALOG_URL = 'https://www.dia.es/ofertas';
const ZAFRA_STORES_URL = 'https://www.dia.es/tiendas/buscador-tiendas/badajoz/zafra/06300';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 9_000;
type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const boolean = (value: unknown): boolean => value === true;

const safeDiaUrl = (value: string): URL => {
  const url = new URL(value);
  const allowedPath =
    url.pathname === '/' ||
    url.pathname === '/compra-online' ||
    url.pathname === '/compra-online/' ||
    url.pathname === '/ofertas' ||
    url.pathname === '/tiendas/buscador-tiendas/badajoz/zafra/06300';
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.dia.es' ||
    !allowedPath ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('DIA_SOURCE_NOT_ALLOWED');
  return url;
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
      throw new Error('DIA_RESPONSE_TOO_LARGE');
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return body + decoder.decode();
};

const centsFromNumber = (value: unknown): number | null => {
  const amount = number(value);
  if (amount === undefined || amount < 0) return null;
  const result = Math.round(amount * 100);
  return Number.isSafeInteger(result) ? result : null;
};

const dateInMadrid = (value: unknown): string | undefined => {
  const source = text(value);
  if (!source || Number.isNaN(Date.parse(source))) return undefined;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(source));
};

const pageContext = (document: string): JsonRecord => {
  const match = /<script[^>]+id=["']vike_pageContext["'][^>]*>([\s\S]*?)<\/script>/iu.exec(
    document,
  );
  if (!match) throw new Error('DIA_PAGE_CONTEXT_MISSING');
  try {
    const result = record(JSON.parse(match[1]));
    if (!result) throw new Error('DIA_PAGE_CONTEXT_INVALID');
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('DIA_')) throw error;
    throw new Error('DIA_PAGE_CONTEXT_INVALID', { cause: error });
  }
};

interface ProductContext {
  product: JsonRecord;
  validFrom?: string;
  validUntil?: string;
}

const productContexts = (
  value: unknown,
  validity: { from?: string; until?: string } = {},
): ProductContext[] => {
  if (Array.isArray(value)) return value.flatMap((entry) => productContexts(entry, validity));
  const current = record(value);
  if (!current) return [];
  const next = {
    from: dateInMadrid(current['start_time']) ?? validity.from,
    until: dateInMadrid(current['end_time']) ?? validity.until,
  };
  const self =
    text(current['sku_id']) && record(current['prices'])
      ? [{ product: current, validFrom: next.from, validUntil: next.until }]
      : [];
  const products = current['products'];
  const direct = Array.isArray(products)
    ? products.flatMap((item): ProductContext[] => {
        const product = record(item);
        return product ? [{ product, validFrom: next.from, validUntil: next.until }] : [];
      })
    : [];
  return [
    ...self,
    ...direct,
    ...Object.entries(current)
      .filter(([key]) => key !== 'products')
      .flatMap(([, child]) => productContexts(child, next)),
  ];
};

const packageDetails = (name: string): { quantity?: number; unit?: string } => {
  const matches = [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|unidades?|lavados?)\b/giu)];
  const match = matches.at(-1);
  if (!match) return {};
  const quantity = Number(match[1].replace(',', '.'));
  return Number.isFinite(quantity) ? { quantity, unit: match[2].toLocaleLowerCase('es') } : {};
};

const promotionHint = (
  description: string | undefined,
  loyalty: boolean,
): OfferType | undefined => {
  const normalized = normalizeProductName(description ?? '');
  if (/2[ªa]? (?:ud|unidad)|segunda unidad/u.test(normalized)) return 'SECOND_UNIT_DISCOUNT';
  if (/\b\d+\s*x\s*\d+\b/u.test(normalized)) return 'BUY_X_PAY_Y';
  if (loyalty) return 'LOYALTY_PRICE';
  return description ? 'SPECIAL_PRICE' : undefined;
};

const parsedProduct = (
  context: ProductContext,
  sourceUrl: string,
): ParsedSupermarketProduct | null => {
  const product = context.product;
  const prices = record(product['prices']);
  const externalId = text(product['sku_id']) ?? text(product['object_id']);
  const name = text(product['display_name']);
  const price = centsFromNumber(prices?.['price']);
  const productPath = text(product['url']);
  if (!externalId || !name || price === null || !productPath) return null;
  const promotions = Array.isArray(product['promotions'])
    ? product['promotions'].map(record).filter((item): item is JsonRecord => item !== null)
    : [];
  const description = text(promotions[0]?.['description']);
  const discount = number(prices?.['discount_percentage']);
  const promotional = boolean(prices?.['is_promo_price']) || Boolean(description);
  const loyalty =
    boolean(prices?.['is_club_price']) ||
    promotions.some((item) => boolean(item['only_club_dia'])) ||
    text(product['headband_promotion']) === 'exclusive_offer';
  const details = packageDetails(name);
  const normalPrice = centsFromNumber(prices?.['strikethrough_price']);
  const unitPrice = centsFromNumber(prices?.['price_per_unit']);
  const unit = text(prices?.['measure_unit']);
  const category = productPath.split('/').filter(Boolean)[0]?.replaceAll('-', ' ');
  const image = text(product['image']);
  return {
    externalId,
    name,
    brand: text(product['brand']),
    commercialCategory: category,
    imageUrl: image ? new URL(image, CATALOG_URL).toString() : undefined,
    packageQuantity: details.quantity,
    packageUnit: details.unit,
    priceText: String(price),
    normalPriceText: promotional && normalPrice !== null ? String(normalPrice) : undefined,
    unitPriceText: unitPrice === null ? undefined : `${unitPrice}/${unit ?? ''}`,
    promotionText:
      description ??
      (promotional && discount !== undefined ? `${Math.round(discount)}% dto.` : undefined),
    validFrom: context.validFrom,
    validUntil: context.validUntil,
    sourceUrl,
    promotionRequiresLoyalty: loyalty,
    promotionTypeHint:
      promotionHint(description, loyalty) ??
      (promotional && discount ? (loyalty ? 'LOYALTY_PRICE' : 'PERCENTAGE_DISCOUNT') : undefined),
    channel: 'ONLINE',
    geographicScope: 'ONLINE',
  };
};

const integerCents = (value: string | undefined): number | null => {
  if (!value || !/^\d+$/u.test(value)) return null;
  const result = Number.parseInt(value, 10);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
};
const percentageFrom = (value: string | undefined): number | null => {
  const match = /(\d{1,3})\s*%/u.exec(value ?? '');
  return match ? Number.parseInt(match[1], 10) : null;
};

const offerFrom = (product: ParsedSupermarketProduct, priceCents: number): ImportedOffer | null => {
  if (!product.promotionTypeHint || !product.promotionText) return null;
  const multiBuy = /(\d+)\s*x\s*(\d+)/iu.exec(product.promotionText);
  return {
    type: product.promotionTypeHint,
    label: product.promotionText,
    normalPriceCents: integerCents(product.normalPriceText),
    offerPriceCents: priceCents,
    percentage: percentageFrom(product.promotionText),
    buyQuantity: multiBuy ? Number.parseInt(multiBuy[1], 10) : null,
    payQuantity: multiBuy ? Number.parseInt(multiBuy[2], 10) : null,
    validFrom: product.validFrom ?? null,
    validUntil: product.validUntil ?? null,
    channel: product.channel ?? 'ONLINE',
    geographicScope: product.geographicScope ?? 'ONLINE',
    requiresLoyaltyCard: product.promotionRequiresLoyalty ?? false,
    loyaltyProgram: product.promotionRequiresLoyalty ? 'CLUB_DIA' : null,
  };
};

const decodeHtml = (value: string): string =>
  value
    .replaceAll('&aacute;', 'á')
    .replaceAll('&eacute;', 'é')
    .replaceAll('&iacute;', 'í')
    .replaceAll('&oacute;', 'ó')
    .replaceAll('&uacute;', 'ú')
    .replaceAll('&ntilde;', 'ñ')
    .replaceAll('&amp;', '&')
    .replace(/<[^>]+>/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

export class DiaProvider implements SupermarketImportProvider {
  readonly providerId = 'dia' as const;
  readonly catalogStore = {
    externalId: 'online-es',
    name: 'DIA online España',
    address: 'Canal online público',
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
    return [CATALOG_URL];
  }
  async discoverStores(): Promise<string[]> {
    return [ZAFRA_STORES_URL];
  }
  fetch(sourceUrl: string): Promise<string> {
    return this.fetchDocument(sourceUrl);
  }

  parse(document: string, sourceUrl: string): ParsedSupermarketProduct[] {
    safeDiaUrl(sourceUrl);
    const initialState = record(pageContext(document)['INITIAL_STATE']);
    if (!initialState) throw new Error('DIA_PAGE_CONTEXT_INVALID');
    const seen = new Set<string>();
    return productContexts(initialState)
      .flatMap((context) => {
        const product = parsedProduct(context, sourceUrl);
        if (!product || seen.has(product.externalId)) return [];
        seen.add(product.externalId);
        return [product];
      })
      .slice(0, this.limit);
  }

  normalize(product: ParsedSupermarketProduct): ImportedProduct {
    const priceCents = integerCents(product.priceText);
    if (!product.externalId || !product.name.trim() || priceCents === null)
      throw new Error('DIA_INVALID_PRODUCT');
    const normalizedName = normalizeProductName(product.name);
    const unitParts = product.unitPriceText?.split('/');
    const visualCategory = classifyNormalizedProductName(normalizedName);
    return {
      externalId: product.externalId,
      ean: product.ean?.trim() || null,
      name: product.name.trim(),
      normalizedName,
      brand: product.brand?.trim() || null,
      commercialCategory: product.commercialCategory?.trim() || null,
      visualCategory,
      offerBrowseCategory: classifyOfferBrowseCategory({
        officialCategory: product.commercialCategory,
        visualCategory,
        normalizedName,
      }),
      imageUrl: product.imageUrl?.trim() || null,
      packageQuantity: product.packageQuantity ?? null,
      packageUnit: product.packageUnit?.trim() || null,
      priceCents,
      unitPriceCents: integerCents(unitParts?.[0]),
      unitPriceUnit: unitParts?.[1]?.trim().toLocaleLowerCase('es') || null,
      sourceUrl: safeDiaUrl(product.sourceUrl).toString(),
      channel: product.channel ?? 'ONLINE',
      geographicScope: product.geographicScope ?? 'ONLINE',
      offers: [offerFrom(product, priceCents)].filter(
        (offer): offer is ImportedOffer => offer !== null,
      ),
    };
  }

  parseStores(document: string, sourceUrl: string): ImportedStore[] {
    if (safeDiaUrl(sourceUrl).toString() !== ZAFRA_STORES_URL)
      throw new Error('DIA_STORE_SOURCE_NOT_ALLOWED');
    return [
      ...document.matchAll(
        /<div class="row">([\s\S]*?)<div class="botonesCompartir">([\s\S]*?)<\/div>\s*<\/div>/giu,
      ),
    ].flatMap((match): ImportedStore[] => {
      const row = `${match[1]}${match[2]}`;
      const address = /class="direccionTienda"[^>]+title="([^"]+)"/iu.exec(row)?.[1];
      const externalId = /buscador-folletos\/badajoz\/zafra\/06300\/(\d+)/iu.exec(row)?.[1];
      if (!address || !externalId || !/Zafra\s+06300/iu.test(row)) return [];
      const decoded = decodeHtml(address);
      return [
        {
          externalId,
          name: `DIA ${decoded}`,
          address: decoded,
          city: 'Zafra',
          postalCode: '06300',
          latitude: null,
          longitude: null,
          active: true,
        },
      ];
    });
  }

  private async fetchDocument(sourceUrl: string, redirectCount = 0): Promise<string> {
    const url = safeDiaUrl(sourceUrl);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await this.fetcher(url, {
          headers: {
            accept: 'text/html,application/xhtml+xml',
            'user-agent': 'family-shopping/1.0 (public DIA catalogue importer)',
          },
          redirect: 'manual',
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location || redirectCount >= 1) throw new Error('DIA_REDIRECT_BLOCKED');
          const rawTarget = new URL(location, url);
          let target: URL;
          try {
            target = safeDiaUrl(rawTarget.toString());
          } catch {
            const pathCode = rawTarget.pathname.replace(/[^A-Za-z0-9]+/gu, '_').slice(0, 40);
            throw new Error(`DIA_REDIRECT_BLOCKED_${pathCode}`);
          }
          return this.fetchDocument(target.toString(), redirectCount + 1);
        }
        if (!response.ok) throw new Error(`DIA_HTTP_${response.status}`);
        const size = Number(response.headers.get('content-length') ?? '0');
        if (size > MAX_RESPONSE_BYTES) throw new Error('DIA_RESPONSE_TOO_LARGE');
        return await readLimitedText(response);
      } catch (error) {
        lastError = error;
        if (attempt > 0 || (error instanceof Error && /DIA_HTTP_4\d\d/u.test(error.message)))
          throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }
}
