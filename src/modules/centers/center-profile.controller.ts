import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { CenterExceptionFilter } from './center-exception.filter';
import { CenterProfileService } from './center-profile.service';
import { CurrentCenterUser } from './decorators/current-center-user.decorator';
import {
  CenterProfileResponseDto,
  UpdateCenterDto,
  UpdateCenterManagerDto,
} from './dto/center-profile.dto';
import { CenterErrorResponseDto } from './dto/center-error-response.dto';
import { CenterAuthGuard } from './guards/center-auth.guard';

@ApiTags('Center Profile')
@ApiBearerAuth()
@Controller('api/centers')
@UseFilters(CenterExceptionFilter)
@UseGuards(CenterAuthGuard)
export class CenterProfileController {
  constructor(private readonly profileService: CenterProfileService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Read the signed-in center profile',
    description:
      'Returns the center and owner behind the presented access token. There is no route that names another center.',
  })
  @ApiOkResponse({ type: CenterProfileResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: CenterErrorResponseDto })
  async me(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
  ): Promise<CenterProfileResponseDto> {
    return this.profileService.getProfile(centerUser);
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update the school',
    description:
      "The school's name, where it is, and the rest of its address. Only the allowlisted fields supplied are written; anything else in the body is a 400. `regionId` is not accepted — it is looked up from the city, so a city cannot be filed under a region it does not belong to. Which address fields are required depends on the country being set (`GET /api/locations`), and a request that sets a country without them answers ADDRESS_INCOMPLETE naming the missing ones. The manager's own details are a separate route.",
  })
  @ApiOkResponse({ type: CenterProfileResponseDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: CenterErrorResponseDto })
  async updateMe(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Body() dto: UpdateCenterDto,
  ): Promise<CenterProfileResponseDto> {
    return this.profileService.updateCenter(centerUser, dto);
  }

  @Patch('me/manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update the manager',
    description:
      'Who the manager is, how to reach them, and where they are — which is not necessarily where the school is. No address fields: nothing is posted to a manager. Email is not editable here; changing the address a verification link was sent to is its own flow. Role, verification state and center are never editable.',
  })
  @ApiOkResponse({ type: CenterProfileResponseDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: CenterErrorResponseDto })
  async updateManager(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Body() dto: UpdateCenterManagerDto,
  ): Promise<CenterProfileResponseDto> {
    return this.profileService.updateManager(centerUser, dto);
  }
}
