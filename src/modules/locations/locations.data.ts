/**
 * Where our schools are, and what an address means in each country.
 *
 * Constants rather than a database table, for the same reasons as
 * `TIER_PRICES_XAF`: git carries a free history of when a city was added and
 * why, a change gets a review instead of an INSERT someone runs at night, and
 * two countries do not justify an admin surface. A table also adds a query to
 * a route that is read on every onboarding form.
 *
 * Ids are slugs and are what gets stored. Renaming a display name later must
 * not rewrite rows, which is why `douala` is the identity and "Douala" is only
 * what a human reads.
 *
 * Regions exist so a city list can be grouped on screen — the manager never
 * chooses one. A known city carries its region (see `resolveLocation`), and a
 * city we have not listed simply has none.
 */

/** Countries we serve. Anything else is refused rather than stored. */
export const COUNTRY_CODES = ['CM', 'DE'] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

/**
 * How a field behaves in one country: it must be supplied, it may be, or it is
 * not collected at all.
 *
 * `absent` is not `optional`. Cameroon has no postal code worth asking for, so
 * the field is not shown; Germany requires it. A form that treats both as
 * "optional" asks Cameroonian schools for something meaningless.
 */
export type FieldRule = 'required' | 'optional' | 'absent';

export interface AddressRules {
  district: FieldRule;
  postalCode: FieldRule;
  street: FieldRule;
  houseNumber: FieldRule;
}

export interface City {
  id: string;
  name: string;
}

export interface Region {
  id: string;
  name: string;
  cities: City[];
}

export interface Country {
  code: CountryCode;
  name: string;
  addressRules: AddressRules;
  regions: Region[];
}

/**
 * The cities we list today. Deliberately short: a school in a town that is
 * missing types it in as free text and is never blocked, and a name typed
 * often enough is promoted here in one commit.
 */
export const COUNTRIES: readonly Country[] = [
  {
    code: 'CM',
    name: 'Cameroun',
    // A quarter ("quartier") is how an address is actually given in Cameroon,
    // and there is no postal code to ask for.
    addressRules: {
      district: 'required',
      postalCode: 'absent',
      street: 'optional',
      houseNumber: 'optional',
    },
    regions: [
      {
        id: 'littoral',
        name: 'Littoral',
        cities: [
          { id: 'douala', name: 'Douala' },
          { id: 'nkongsamba', name: 'Nkongsamba' },
        ],
      },
      {
        id: 'centre',
        name: 'Centre',
        cities: [{ id: 'yaounde', name: 'Yaoundé' }],
      },
      {
        id: 'ouest',
        name: 'Ouest',
        cities: [
          { id: 'bafoussam', name: 'Bafoussam' },
          { id: 'dschang', name: 'Dschang' },
        ],
      },
      {
        id: 'nord-ouest',
        name: 'Nord-Ouest',
        cities: [{ id: 'bamenda', name: 'Bamenda' }],
      },
      {
        id: 'sud-ouest',
        name: 'Sud-Ouest',
        cities: [
          { id: 'buea', name: 'Buea' },
          { id: 'limbe', name: 'Limbé' },
        ],
      },
    ],
  },
  {
    code: 'DE',
    name: 'Deutschland',
    // Street, number and postal code are what a German invoice needs; the
    // district is not part of a normal address.
    addressRules: {
      district: 'optional',
      postalCode: 'required',
      street: 'required',
      houseNumber: 'required',
    },
    regions: [
      {
        id: 'nordrhein-westfalen',
        name: 'Nordrhein-Westfalen',
        cities: [
          { id: 'essen', name: 'Essen' },
          { id: 'dortmund', name: 'Dortmund' },
          { id: 'duesseldorf', name: 'Düsseldorf' },
          { id: 'koeln', name: 'Köln' },
        ],
      },
      {
        id: 'bayern',
        name: 'Bayern',
        cities: [
          { id: 'muenchen', name: 'München' },
          { id: 'nuernberg', name: 'Nürnberg' },
        ],
      },
      {
        id: 'berlin',
        name: 'Berlin',
        cities: [{ id: 'berlin', name: 'Berlin' }],
      },
      {
        id: 'hessen',
        name: 'Hessen',
        cities: [{ id: 'frankfurt-am-main', name: 'Frankfurt am Main' }],
      },
    ],
  },
];

/** The longest free-text city we accept. Long enough for any real place. */
export const MAX_CITY_OTHER_LENGTH = 100;
