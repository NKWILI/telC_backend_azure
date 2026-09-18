import { ApiProperty } from '@nestjs/swagger';
import type { FieldRule } from '../locations.data';

export class CityDto {
  @ApiProperty({
    example: 'douala',
    description: 'Stored as-is. Display names may change; this may not.',
  })
  id: string;

  @ApiProperty({ example: 'Douala' })
  name: string;
}

export class RegionDto {
  @ApiProperty({ example: 'littoral' })
  id: string;

  @ApiProperty({ example: 'Littoral' })
  name: string;

  @ApiProperty({ type: [CityDto] })
  cities: CityDto[];
}

export class AddressRulesDto {
  @ApiProperty({
    enum: ['required', 'optional', 'absent'],
    example: 'required',
    description:
      'A quarter is how an address is given in Cameroon; in Germany it is not part of one.',
  })
  district: FieldRule;

  @ApiProperty({
    enum: ['required', 'optional', 'absent'],
    example: 'absent',
    description:
      '`absent` means the field is not collected at all, which is not the same as optional.',
  })
  postalCode: FieldRule;

  @ApiProperty({ enum: ['required', 'optional', 'absent'] })
  street: FieldRule;

  @ApiProperty({ enum: ['required', 'optional', 'absent'] })
  houseNumber: FieldRule;
}

export class CountryDto {
  @ApiProperty({ example: 'CM', enum: ['CM', 'DE'] })
  code: string;

  @ApiProperty({ example: 'Cameroun' })
  name: string;

  @ApiProperty({
    type: AddressRulesDto,
    description:
      'Which address fields this country expects. The client renders from this rather than holding its own copy of the rules.',
  })
  addressRules: AddressRulesDto;

  @ApiProperty({
    type: [RegionDto],
    description:
      'Regions group the city list on screen. The manager never picks one: a known city carries its region, filled in server-side.',
  })
  regions: RegionDto[];
}

export class LocationsResponseDto {
  @ApiProperty({ type: [CountryDto] })
  countries: CountryDto[];

  @ApiProperty({
    example: 100,
    description:
      'The longest free-text city accepted when a school is in a town we do not list.',
  })
  maxCityOtherLength: number;
}
