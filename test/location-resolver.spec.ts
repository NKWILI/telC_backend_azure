import {
  addressRulesFor,
  resolveLocation,
} from '../src/modules/locations/location-resolver';

/**
 * The single authority on what a location means, used by every route that
 * writes one (center profile, manager profile).
 *
 * Pure on purpose: it takes what a client sent and returns either the resolved
 * location or the reason it cannot be resolved. It never throws — a caller
 * turns a refusal into the HTTP shape, and a UI asking "what is wrong with
 * this form" is not an error path.
 */
describe('resolveLocation', () => {
  it('derives the region from a known city, so the form never asks for one', () => {
    const result = resolveLocation({ countryCode: 'CM', cityId: 'douala' });

    expect(result).toEqual({
      countryCode: 'CM',
      regionId: 'littoral',
      cityId: 'douala',
      cityOther: null,
    });
  });

  it('accepts a country code in any case, because a client may send either', () => {
    expect(resolveLocation({ countryCode: 'de', cityId: 'essen' })).toEqual({
      countryCode: 'DE',
      regionId: 'nordrhein-westfalen',
      cityId: 'essen',
      cityOther: null,
    });
  });

  it('accepts an unlisted city as free text, so no school is ever blocked', () => {
    expect(
      resolveLocation({ countryCode: 'CM', cityOther: '  Bafoussam ' }),
    ).toEqual({
      countryCode: 'CM',
      regionId: null,
      cityId: null,
      cityOther: 'Bafoussam',
    });
  });

  it('refuses a country we do not serve', () => {
    expect(resolveLocation({ countryCode: 'FR', cityId: 'paris' })).toEqual({
      field: 'countryCode',
      code: 'UNKNOWN_COUNTRY',
    });
  });

  it("refuses a city that belongs to another country, not just one we don't know", () => {
    expect(resolveLocation({ countryCode: 'CM', cityId: 'essen' })).toEqual({
      field: 'cityId',
      code: 'UNKNOWN_CITY',
    });
  });

  it('refuses a request naming both a listed city and a free-text one', () => {
    expect(
      resolveLocation({
        countryCode: 'CM',
        cityId: 'douala',
        cityOther: 'Bafoussam',
      }),
    ).toEqual({ field: 'cityOther', code: 'CITY_AMBIGUOUS' });
  });

  it('refuses a location with no city at all', () => {
    expect(resolveLocation({ countryCode: 'CM' })).toEqual({
      field: 'cityId',
      code: 'CITY_REQUIRED',
    });
  });

  it('refuses free text that is blank or absurdly long', () => {
    expect(resolveLocation({ countryCode: 'CM', cityOther: '   ' })).toEqual({
      field: 'cityId',
      code: 'CITY_REQUIRED',
    });
    expect(
      resolveLocation({ countryCode: 'CM', cityOther: 'x'.repeat(101) }),
    ).toEqual({ field: 'cityOther', code: 'CITY_TOO_LONG' });
  });
});

/**
 * Which address fields a country requires. The rules belong to the school's
 * country, which is why they live beside the country list rather than in the
 * routes that apply them.
 */
describe('addressRulesFor', () => {
  it('requires a district in Cameroon and collects no postal code', () => {
    expect(addressRulesFor('CM')).toEqual({
      district: 'required',
      postalCode: 'absent',
      street: 'optional',
      houseNumber: 'optional',
    });
  });

  it('requires a full street address in Germany', () => {
    expect(addressRulesFor('DE')).toEqual({
      district: 'optional',
      postalCode: 'required',
      street: 'required',
      houseNumber: 'required',
    });
  });

  it('returns nothing for a country we do not serve', () => {
    expect(addressRulesFor('FR')).toBeNull();
  });
});
