import { Controller, Get, Header, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { COUNTRIES, MAX_CITY_OTHER_LENGTH } from './locations.data';
import { LocationsResponseDto } from './dto/locations-response.dto';

/** A day. The list changes with a deploy, never within one. */
const CACHE_SECONDS = 86_400;

@ApiTags('Locations')
@Controller('api/locations')
export class LocationsController {
  @Get()
  @HttpCode(HttpStatus.OK)
  // Public on purpose: the onboarding form is filled before a center has done
  // anything, the data is the same for everyone, and it holds nothing
  // personal. Requiring a token would only mean loading it twice.
  @Header('Cache-Control', `public, max-age=${CACHE_SECONDS}`)
  @ApiOperation({
    summary: 'Countries, their regions and cities, and their address rules',
    description:
      'Everything the onboarding wizard and the settings page need for their location fields, in one response. No authentication and no database query: the list is constants in code. A city that is not listed is sent as free text instead (see `maxCityOtherLength`), so a school is never blocked by a missing city. Express adds an ETag, so a client that already holds this version gets a 304.',
  })
  @ApiOkResponse({ type: LocationsResponseDto })
  list(): LocationsResponseDto {
    return {
      countries: COUNTRIES.map((country) => ({ ...country })),
      maxCityOtherLength: MAX_CITY_OTHER_LENGTH,
    };
  }
}
