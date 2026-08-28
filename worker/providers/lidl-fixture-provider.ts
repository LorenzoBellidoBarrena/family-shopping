import { FixtureProvider, type FixtureOfferInput } from './fixture-provider';

export class LidlFixtureProvider extends FixtureProvider {
  readonly supermarketId = 'lidl' as const;
  protected readonly supermarketName = 'Lidl';
  protected readonly storeName = 'Lidl Zafra';
  protected readonly sourceUrl =
    'https://www.lidl.es/c/descubre-nuevas-ofertas-cada-semana-folletos-lidl/s10087402';
  protected readonly offers: readonly FixtureOfferInput[] = [
    {
      id: 'leche-entera',
      productName: 'Leche entera 1 litro',
      brand: 'Fixture Lidl',
      category: 'Lácteos',
      packageLabel: '1 l',
      normalPriceCents: 105,
      offerPriceCents: 89,
      unitPriceCents: 89,
      promotionType: 'Precio promocional de demostración',
    },
    {
      id: 'huevos-docena',
      productName: 'Huevos frescos docena',
      brand: 'Fixture Lidl',
      category: 'Huevos',
      packageLabel: '12 unidades',
      normalPriceCents: 249,
      offerPriceCents: 219,
      promotionType: 'Precio promocional de demostración',
    },
  ];
}
