import { classifyNormalizedProductName } from '../../src/shared/product-category';
import type {
  ImportedOffer,
  ImportedProduct,
  ImportedStore,
  OfferChannel,
  ParsedSupermarketProduct,
  SupermarketImportProvider,
} from '../domain/supermarket-import';
import { normalizeProductName } from '../validation';

const HOME_URL = 'https://www.lidl.es/';
const OVERVIEW_URL =
  'https://www.lidl.es/c/descubre-nuevas-ofertas-cada-semana-folletos-lidl/s10087402';
const ZAFRA_STORE_URL = 'https://www.lidl.es/s/es-ES/tiendas/zafra/c-torre-san-francisco-2a/';
const FLYER_API_ORIGIN = 'https://endpoints.leaflets.schwarz';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 9_000;
const MAX_CAMPAIGNS = 5;
const MAX_DISCOVERED_CAMPAIGNS = 20;
const FOOD_CAMPAIGN_SLUGS = [
  'ofertas-semanales',
  'ofertas-proxima-semana',
  'frescos-frutas-y-verduras',
  'frescos-carne',
  'frescos-pescado',
  'ofertas-del-dia',
] as const;
type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const isCampaignPath = (pathname: string): boolean =>
  FOOD_CAMPAIGN_SLUGS.some((slug) =>
    new RegExp(`^/c/${slug}/[as]\\d{5,12}/?$`, 'u').test(pathname),
  );

const safeLidlUrl = (value: string): URL => {
  const url = new URL(value);
  const isHome = url.hostname === 'www.lidl.es' && url.pathname === '/';
  const isOverview =
    url.hostname === 'www.lidl.es' && url.pathname === new URL(OVERVIEW_URL).pathname;
  const isStore =
    url.hostname === 'www.lidl.es' && url.pathname === new URL(ZAFRA_STORE_URL).pathname;
  const isCampaign = url.hostname === 'www.lidl.es' && isCampaignPath(url.pathname);
  const isFlyer =
    url.origin === FLYER_API_ORIGIN &&
    url.pathname === '/v4/flyer' &&
    /^[A-Za-z0-9-]{1,160}$/u.test(url.searchParams.get('flyer_identifier') ?? '') &&
    url.searchParams.get('region_id') === '0' &&
    [...url.searchParams.keys()].every((key) => key === 'flyer_identifier' || key === 'region_id');
  if (
    url.protocol !== 'https:' ||
    (!isHome && !isOverview && !isStore && !isCampaign && !isFlyer) ||
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

const decodeHtmlAttribute = (value: string): string =>
  value
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

const centsFromNumber = (value: unknown): number | null => {
  const amount = finiteNumber(value);
  if (amount === null) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : null;
};

const moneyCents = (value: string | undefined): number | null => {
  if (!value) return null;
  const match = /^\s*((?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{1,2})?|\d+\.\d{1,2})\s*€\s*$/u.exec(value);
  if (!match) return null;
  let amount = match[1];
  if (amount.includes(',')) amount = amount.replaceAll('.', '').replace(',', '.');
  return centsFromNumber(Number(amount));
};

const priceText = (cents: number): string => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

const madridDate = (value: unknown, exclusiveEnd = false): string | undefined => {
  const candidate = text(value);
  if (!candidate) return undefined;
  let instant = new Date(candidate);
  if (Number.isNaN(instant.getTime())) return undefined;
  if (exclusiveEnd) instant = new Date(instant.getTime() - 1);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const result = `${get('year')}-${get('month')}-${get('day')}`;
  return /^\d{4}-\d{2}-\d{2}$/u.test(result) ? result : undefined;
};

const badajozPrice = (product: JsonRecord): JsonRecord | null => {
  const regions = record(product['regionsV2']);
  const region = Object.values(regions ?? {})
    .map(record)
    .find((candidate) => normalizeProductName(text(candidate?.['regionName']) ?? '') === 'badajoz');
  const regionPriceId = text(region?.['regionPriceId']);
  return regionPriceId ? record(record(product['regionsPrices'])?.[regionPriceId]) : null;
};

const unwrapPrice = (value: unknown): JsonRecord | null => {
  let current = record(value);
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (finiteNumber(current['price']) !== null) return current;
    current = record(current['price']);
  }
  return null;
};

const firstPrice = (...values: unknown[]): JsonRecord | null => {
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = unwrapPrice(entry);
        if (found) return found;
      }
    } else {
      const found = unwrapPrice(value);
      if (found) return found;
    }
  }
  return null;
};

const priceValidity = (
  node: JsonRecord,
): { validFrom: string | null; validUntil: string | null } => ({
  validFrom: madridDate(node['startDate']) ?? null,
  validUntil: madridDate(node['endDate']) ?? madridDate(node['endDateExclusive'], true) ?? null,
});

const discountPercentage = (node: JsonRecord): number | null => {
  const value = finiteNumber(record(node['discount'])?.['percentageDiscount']);
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 100 ? value : null;
};

const oldPriceCents = (node: JsonRecord): number | null =>
  centsFromNumber(node['oldPrice']) ?? centsFromNumber(record(node['discount'])?.['deletedPrice']);

const explicitUnitPrice = (node: JsonRecord): { cents: number; unit: string } | null => {
  const base = record(node['basePrice']);
  const cents = centsFromNumber(base?.['price'] ?? base?.['value']);
  const unit = text(base?.['unit'] ?? base?.['baseUnit'] ?? base?.['displayUnit']);
  return cents !== null && unit ? { cents, unit: unit.toLocaleLowerCase('es') } : null;
};

const packageDetails = (value: string | undefined): { quantity?: number; unit?: string } => {
  if (!value) return {};
  const simple = /^(?:aprox\.?\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl|unidades?|uds?)$/iu.exec(
    value.trim(),
  );
  if (simple) {
    const quantity = Number(simple[1].replace(',', '.'));
    return Number.isFinite(quantity) ? { quantity, unit: simple[2].toLocaleLowerCase('es') } : {};
  }
  return { unit: value.trim().toLocaleLowerCase('es') };
};

const safeImageUrl = (value: unknown): string | undefined => {
  const candidate = text(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' &&
      ['www.lidl.es', 'imgproxy.leaflets.schwarz', 'lidl.media.schwarz'].includes(url.hostname)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const explicitChannel = (product: JsonRecord): OfferChannel => {
  const store = product['store'] === true;
  const online = product['online'] === true;
  if (store && !online) return 'STORE';
  if (online && !store) return 'ONLINE';
  return 'UNKNOWN';
};

const campaignOffers = (
  general: JsonRecord | null,
  plus: JsonRecord | null,
  channel: OfferChannel,
): ImportedOffer[] => {
  const offers: ImportedOffer[] = [];
  if (general) {
    const current = centsFromNumber(general['price']);
    const normal = oldPriceCents(general);
    if (current !== null && normal !== null && normal > current) {
      const percentage = discountPercentage(general);
      offers.push({
        type: percentage === null ? 'DIRECT_DISCOUNT' : 'PERCENTAGE_DISCOUNT',
        label: percentage === null ? 'Precio promocional Lidl' : `-${percentage}%`,
        normalPriceCents: normal,
        offerPriceCents: current,
        percentage,
        buyQuantity: null,
        payQuantity: null,
        ...priceValidity(general),
        channel,
        geographicScope: 'REGIONAL',
        requiresLoyaltyCard: false,
        loyaltyProgram: null,
      });
    }
  }
  if (plus) {
    const current = centsFromNumber(plus['price']);
    const normal = oldPriceCents(plus);
    if (current !== null && normal !== null && normal > current) {
      offers.push({
        type: 'LOYALTY_PRICE',
        label: 'Precio Lidl Plus',
        normalPriceCents: normal,
        offerPriceCents: current,
        percentage: discountPercentage(plus),
        buyQuantity: null,
        payQuantity: null,
        ...priceValidity(plus),
        channel,
        geographicScope: 'REGIONAL',
        requiresLoyaltyCard: true,
        loyaltyProgram: 'LIDL_PLUS',
      });
    }
  }
  return offers;
};

export class LidlProvider implements SupermarketImportProvider {
  readonly providerId = 'lidl' as const;
  readonly catalogStore = {
    externalId: 'campaign-region-badajoz',
    name: 'Lidl España · campañas para Badajoz',
    address: 'Campañas públicas con precio regional',
    city: 'Badajoz',
    postalCode: 'N/A',
    latitude: null,
    longitude: null,
    active: true,
  } as const;
  private limit = 100;

  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  async discover(limit = 100): Promise<string[]> {
    this.limit = Math.min(Math.max(limit, 1), 100);
    return this.parseCampaignDiscovery(await this.fetchDocument(HOME_URL)).slice(0, MAX_CAMPAIGNS);
  }

  parseCampaignDiscovery(document: string): string[] {
    const links = [...document.matchAll(/href=["']([^"']+)["']/giu)].flatMap((match): string[] => {
      try {
        const url = new URL(decodeHtmlAttribute(match[1]), HOME_URL);
        return url.hostname === 'www.lidl.es' && isCampaignPath(url.pathname)
          ? [url.origin + url.pathname]
          : [];
      } catch {
        return [];
      }
    });
    const unique = [...new Set(links)];
    if (unique.length === 0) throw new Error('LIDL_CAMPAIGNS_MISSING');
    const priority = (url: string): number => {
      const index = FOOD_CAMPAIGN_SLUGS.findIndex((slug) =>
        new URL(url).pathname.includes(`/${slug}/`),
      );
      return index < 0 ? 999 : index;
    };
    return unique.sort((a, b) => priority(a) - priority(b)).slice(0, MAX_DISCOVERED_CAMPAIGNS);
  }

  // Leaflets remain available for campaign metadata; product extraction no longer depends on them.
  parseDiscovery(document: string): string[] {
    const foodStart = document.search(
      /<div class="section-head">\s*Folletos de Alimentaci[oó]n\s*<\/div>/iu,
    );
    if (foodStart < 0) throw new Error('LIDL_FOOD_LEAFLETS_MISSING');
    const nextSection = document.indexOf('<div class="section-head">', foodStart + 30);
    const section = document.slice(foodStart, nextSection < 0 ? undefined : nextSection);
    return [
      ...new Set(
        [...section.matchAll(/id="flyer-([A-Za-z0-9-]{1,160})"/gu)].map((match) => match[1]),
      ),
    ].map((identifier) => {
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
    if (!isCampaignPath(url.pathname)) throw new Error('LIDL_CAMPAIGN_SOURCE_REQUIRED');
    const entries = [...document.matchAll(/data-grid-data=(["'])([\s\S]*?)\1/giu)];
    const products: ParsedSupermarketProduct[] = [];
    for (const entry of entries) {
      if (products.length >= this.limit) break;
      let raw: JsonRecord;
      try {
        const parsed = record(JSON.parse(decodeHtmlAttribute(entry[2])));
        if (!parsed) continue;
        raw = parsed;
      } catch {
        continue;
      }
      const externalId = String(raw['productId'] ?? raw['itemId'] ?? '').trim();
      const name = text(raw['fullTitle'] ?? raw['title']);
      const regional = badajozPrice(raw);
      if (!externalId || !name || !regional) continue;
      const general = firstPrice(
        regional['currentPrice'],
        regional['futurePrice'],
        regional['price'],
        raw['price'],
      );
      const plus = firstPrice(
        regional['currentLidlPlusPrice'],
        regional['futureLidlPlusPrices'],
        raw['lidlPlus'],
      );
      const generalCents = general ? centsFromNumber(general['price']) : null;
      const plusCents = plus ? centsFromNumber(plus['price']) : null;
      const baseCents = generalCents ?? (plus ? oldPriceCents(plus) : null) ?? plusCents;
      if (baseCents === null) continue;
      const channel = explicitChannel(raw);
      const packageText =
        text(record(general?.['packaging'])?.['text']) ??
        text(record(plus?.['packaging'])?.['text']) ??
        text(raw['packaging']);
      const pack = packageDetails(packageText);
      const unit = general ? explicitUnitPrice(general) : null;
      const keyfacts = record(raw['keyfacts']);
      const commercialCategory = text(keyfacts?.['wonCategoryPrimary']) ?? text(raw['category']);
      if (
        commercialCategory &&
        !normalizeProductName(commercialCategory).includes('comida y cerca de la comida')
      ) {
        continue;
      }
      products.push({
        externalId,
        name,
        brand: text(record(raw['brand'])?.['name']) ?? text(raw['brand']),
        ean: Array.isArray(raw['ians']) ? text(raw['ians'][0]) : undefined,
        commercialCategory,
        imageUrl: safeImageUrl(raw['image'] ?? record(raw['image_V1'])?.['image']),
        packageQuantity: pack.quantity,
        packageUnit: pack.unit,
        priceText: priceText(baseCents),
        sourceUrl: url.toString(),
        channel,
        geographicScope: 'REGIONAL',
        offers: campaignOffers(general, plus, channel),
        parsedPriceCents: baseCents,
        parsedUnitPriceCents: unit?.cents ?? null,
        parsedUnitPriceUnit: unit?.unit ?? null,
      });
    }
    return products;
  }

  normalize(product: ParsedSupermarketProduct): ImportedProduct {
    const priceCents = product.parsedPriceCents ?? moneyCents(product.priceText);
    if (!product.externalId || !product.name.trim() || priceCents === null)
      throw new Error('LIDL_INVALID_PRODUCT');
    const normalizedName = normalizeProductName(product.name);
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
      unitPriceCents: product.parsedUnitPriceCents ?? null,
      unitPriceUnit: product.parsedUnitPriceUnit?.trim() || null,
      sourceUrl: safeLidlUrl(product.sourceUrl).toString(),
      channel: product.channel ?? 'UNKNOWN',
      geographicScope: product.geographicScope ?? 'UNKNOWN',
      offers: product.offers ?? [],
    };
  }

  parseStores(document: string, sourceUrl: string): ImportedStore[] {
    if (safeLidlUrl(sourceUrl).toString() !== ZAFRA_STORE_URL)
      throw new Error('LIDL_STORE_SOURCE_NOT_ALLOWED');
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
          Math.abs(latitude) > 90 ||
          longitude === null ||
          !Number.isFinite(longitude) ||
          Math.abs(longitude) > 180
        )
          continue;
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
            'user-agent': 'family-shopping/1.0 (public Lidl campaign importer)',
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
        if (attempt > 0 || (error instanceof Error && /LIDL_HTTP_4\d\d/u.test(error.message)))
          throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }
}
