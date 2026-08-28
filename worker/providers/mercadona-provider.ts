import { FixtureProvider, type FixtureOfferInput } from './fixture-provider';

export class MercadonaProvider extends FixtureProvider {
  readonly supermarketId = 'mercadona' as const;
  protected readonly supermarketName = 'Mercadona';
  protected readonly storeName = 'Mercadona Zafra';
  protected readonly sourceUrl = 'https://tienda.mercadona.es/';
  protected readonly offers: readonly FixtureOfferInput[] = [
    {
      id: 'copos-avena',
      productName: 'Copos de avena 500 g',
      brand: 'Fixture Mercadona',
      category: 'Desayuno',
      packageLabel: '500 g',
      offerPriceCents: 135,
      unitPriceCents: 270,
      promotionType: 'Precio de catálogo de demostración',
    },
    {
      id: 'platano-canarias',
      productName: 'Plátano de Canarias 1 kg',
      brand: 'Fixture Mercadona',
      category: 'Fruta y verdura',
      packageLabel: '1 kg',
      offerPriceCents: 229,
      unitPriceCents: 229,
      promotionType: 'Precio de catálogo de demostración',
    },
  ];
}
