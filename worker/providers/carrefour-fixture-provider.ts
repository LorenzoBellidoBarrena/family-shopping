import { FixtureProvider, type FixtureOfferInput } from './fixture-provider';

export class CarrefourFixtureProvider extends FixtureProvider {
  readonly supermarketId = 'carrefour' as const;
  protected readonly supermarketName = 'Carrefour';
  protected readonly storeName = 'Carrefour Zafra';
  protected readonly sourceUrl =
    'https://www.carrefour.es/tiendas-carrefour/hipermercados/carrefour/zafra.aspx';
  protected readonly offers: readonly FixtureOfferInput[] = [
    {
      id: 'arroz-largo',
      productName: 'Arroz largo 1 kg',
      brand: 'Fixture Carrefour',
      category: 'Despensa',
      packageLabel: '1 kg',
      normalPriceCents: 149,
      offerPriceCents: 119,
      unitPriceCents: 119,
      promotionType: 'Precio promocional de demostración',
    },
    {
      id: 'aceite-oliva',
      productName: 'Aceite de oliva virgen extra 1 litro',
      brand: 'Fixture Carrefour',
      category: 'Despensa',
      packageLabel: '1 l',
      normalPriceCents: 799,
      offerPriceCents: 699,
      unitPriceCents: 699,
      promotionType: 'Precio promocional de demostración',
    },
  ];
}
