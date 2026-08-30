import { describe, expect, it } from 'vitest';
import {
  classifyOfferBrowseCategory,
  offerBrowseCategoryDefinition,
} from './offer-browse-category';

describe('offer browse categories', () => {
  it('keeps the browse taxonomy independent from visual product categories', () => {
    expect(
      classifyOfferBrowseCategory({
        officialCategory: null,
        campaign: null,
        visualCategory: 'DAIRY',
      }),
    ).toBe('FOOD');
    expect(
      classifyOfferBrowseCategory({
        officialCategory: 'Comida y cerca de la comida',
        campaign: null,
        visualCategory: 'VEGETABLES',
      }),
    ).toBe('FRESH');
    expect(
      classifyOfferBrowseCategory({
        officialCategory: 'Comida y cerca de la comida',
        campaign: null,
        visualCategory: 'DRINKS',
      }),
    ).toBe('DRINKS');
  });

  it('prioritizes official and campaign evidence for non-food products', () => {
    expect(
      classifyOfferBrowseCategory({
        officialCategory: 'Bricolaje y jardín',
        campaign: 'Tu jardín podado y más bonito',
        visualCategory: 'OTHER',
      }),
    ).toBe('GARDEN');
    expect(
      classifyOfferBrowseCategory({
        officialCategory: 'Limpieza del hogar y cuidado de la ropa',
        campaign: null,
        visualCategory: 'OTHER',
      }),
    ).toBe('CLEANING');
  });

  it('uses OTHER only when no stable evidence exists', () => {
    expect(
      classifyOfferBrowseCategory({
        officialCategory: null,
        campaign: null,
        visualCategory: 'OTHER',
        normalizedName: 'producto misterioso',
      }),
    ).toBe('OTHER');
    expect(offerBrowseCategoryDefinition('OTHER')).toMatchObject({ emoji: '🛒', label: 'Otros' });
  });

  it('matches complete words and avoids accidental category substrings', () => {
    expect(
      classifyOfferBrowseCategory({
        officialCategory: 'Papel higiénico',
        visualCategory: 'OTHER',
        normalizedName: 'W5 Estropajos de colores',
      }),
    ).toBe('CLEANING');
    expect(
      classifyOfferBrowseCategory({
        officialCategory: 'Cocina y hogar/Platos precocinados/Pasta fresca y masas',
        visualCategory: 'OTHER',
        normalizedName: 'Masa para empanada',
      }),
    ).toBe('FOOD');
  });
});
