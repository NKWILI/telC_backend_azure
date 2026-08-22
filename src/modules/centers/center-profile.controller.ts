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
  UpdateCenterProfileDto,
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
    summary: 'Update the signed-in center profile',
    description:
      'Updates only the allowlisted fields supplied. Identity, role, email and verification state are not editable here.',
  })
  @ApiOkResponse({ type: CenterProfileResponseDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiUnauthorizedResponse({ type: CenterErrorResponseDto })
  @ApiNotFoundResponse({ type: CenterErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: CenterErrorResponseDto })
  async updateMe(
    @CurrentCenterUser() centerUser: CenterAccessTokenPayload,
    @Body() dto: UpdateCenterProfileDto,
  ): Promise<CenterProfileResponseDto> {
    return this.profileService.updateProfile(centerUser, dto);
  }
}
