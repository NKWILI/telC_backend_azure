import {
  type AddressRules,
  type CountryCode,
  COUNTRIES,
  MAX_CITY_OTHER_LENGTH,
} from './locations.data';

/**
 * What a resolved location is, and what gets stored.
 *
 * Either `cityId` names a city we list — and then `regionId` is filled in from
 * that city, never from the client — or `cityOther` holds free text and there
 * is no region. Never both, so a row can always be read one way.
 */
export interface ResolvedLocation {
  countryCode: CountryCode;
  regionId: string | null;
  cityId: string | null;
  cityOther: string | null;
}

export type LocationRefusalCode =
  | 'UNKNOWN_COUNTRY'
  | 'UNKNOWN_CITY'
  | 'CITY_REQUIRED'
  | 'CITY_AMBIGUOUS'
  | 'CITY_TOO_LONG';

/**
 * Which field a client must fix, and why.
 *
 * The field travels with the code because these refusals end up next to an
 * input on a form: "unknown city" pointing at the country box helps nobody.
 */
export interface LocationRefusal {
  field: 'countryCode' | 'cityId' | 'cityOther';
  code: LocationRefusalCode;
}

export interface LocationInput {
  countryCode?: string | null;
  cityId?: string | null;
  cityOther?: string | null;
}

const isRefusal = (
  value: ResolvedLocation | LocationRefusal,
): value is LocationRefusal => 'code' in value;

/** Exported so a caller can narrow what `resolveLocation` handed back. */
export const isLocationRefusal = isRefusal;

const findCountry = (code: string) =>
  COUNTRIES.find((country) => country.code === code.trim().toUpperCase());

/**
 * The address fields a country expects, or null for a country we do not serve.
 *
 * Lives here rather than in the routes that apply it, because the rules belong
 * to the school's country and two routes already need the same answer.
 */
export function addressRulesFor(countryCode: string): AddressRules | null {
  return findCountry(countryCode)?.addressRules ?? null;
}

/**
 * Turns what a client sent into what we store, or says what is wrong.
 *
 * Never throws: a caller decides the HTTP shape, and a client asking "is this
 * form valid" is not an error path. This is the single authority — every route
 * that writes a location goes through it, so a city can never be saved under a
 * country it does not belong to.
 */
export function resolveLocation(
  input: LocationInput,
): ResolvedLocation | LocationRefusal {
  const country = findCountry(input.countryCode ?? '');

  if (!country) {
    return { field: 'countryCode', code: 'UNKNOWN_COUNTRY' };
  }

  const cityId = input.cityId?.trim() ?? '';
  const cityOther = input.cityOther?.trim() ?? '';

  // Both supplied is a client bug, not a preference to guess at. Picking one
  // would store a city the manager did not choose.
  if (cityId && cityOther) {
    return { field: 'cityOther', code: 'CITY_AMBIGUOUS' };
  }

  if (cityId) {
    const region = country.regions.find((candidate) =>
      candidate.cities.some((city) => city.id === cityId),
    );

    // Also the answer for a city that exists in the other country: it is not
    // this country's city, and that is the same refusal.
    if (!region) {
      return { field: 'cityId', code: 'UNKNOWN_CITY' };
    }

    return {
      countryCode: country.code,
      regionId: region.id,
      cityId,
      cityOther: null,
    };
  }

  if (!cityOther) {
    // Covers both "nothing sent" and "only spaces": neither names a place.
    return { field: 'cityId', code: 'CITY_REQUIRED' };
  }

  if (cityOther.length > MAX_CITY_OTHER_LENGTH) {
    return { field: 'cityOther', code: 'CITY_TOO_LONG' };
  }

  return {
    countryCode: country.code,
    regionId: null,
    cityId: null,
    cityOther,
  };
}
