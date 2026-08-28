import { FixtureProvider, type FixtureOfferInput } from './fixture-provider';

export class DiaProvider extends FixtureProvider {
  readonly supermarketId = 'dia' as const;
  protected readonly supermarketName = 'DIA';
  protected readonly storeName = 'DIA Zafra';
  protected readonly sourceUrl = 'https://www.dia.es/tiendas/buscador-tiendas/badajoz/zafra';
  protected readonly offers: readonly FixtureOfferInput[] = [
    {
      id: 'yogur-natural',
      productName: 'Yogur natural pack 4',
      brand: 'Fixture DIA',
      category: 'Lácteos',
      packageLabel: '4 unidades',
      normalPriceCents: 159,
      offerPriceCents: 129,
      promotionType: 'Oferta Club de demostración',
      requiresLoyaltyCard: true,
    },
    {
      id: 'tomate-rama',
      productName: 'Tomate rama 1 kg',
      brand: 'Fixture DIA',
      category: 'Fruta y verdura',
      packageLabel: '1 kg',
      normalPriceCents: 229,
      offerPriceCents: 189,
      unitPriceCents: 189,
      promotionType: 'Precio promocional de demostración',
    },
  ];
}
