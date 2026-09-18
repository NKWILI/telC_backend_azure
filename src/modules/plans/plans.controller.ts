import { Controller, Get, Header, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildPlansView } from './plans.catalog';
import { PlansResponseDto } from './dto/plans-response.dto';

/** A day, like the location list. These numbers change with a deploy. */
const CACHE_SECONDS = 86_400;

@ApiTags('Plans')
@Controller('api/plans')
export class PlansController {
  @Get()
  @HttpCode(HttpStatus.OK)
  // Public: pricing is read on the marketing site, before anyone has an
  // account.
  @Header('Cache-Control', `public, max-age=${CACHE_SECONDS}`)
  @ApiOperation({
    summary: 'What each plan costs and allows',
    description:
      'Built from the constants the backend already enforces: the prices a quote is computed from, the allowance the AI quota refuses on, and the tier that guards the exam module. Clients must read every number from here and keep only names and descriptions, which are translations — a second copy of a price in a client is how a school gets shown one amount and charged another.',
  })
  @ApiOkResponse({ type: PlansResponseDto })
  list(): PlansResponseDto {
    return buildPlansView();
  }
}
