import { Body, Controller, Ip, Post, UseFilters } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { RateLimitService } from '../../shared/services/rate-limit.service';
import { CenterExceptionFilter } from './center-exception.filter';
import { CentersService } from './centers.service';
import { RegisterCenterDto } from './dto/register-center.dto';

@ApiTags('Centers')
@Controller('api/centers')
@UseFilters(CenterExceptionFilter)
export class CentersController {
  constructor(
    private readonly centersService: CentersService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a language center and its owner',
    description:
      'Creates an unverified center account and sends a verification email. The response is identical when the email already exists.',
  })
  @ApiCreatedResponse({
    schema: {
      example: { message: 'verification email sent' },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid or unexpected input.' })
  @ApiTooManyRequestsResponse({ description: 'Registration limit exceeded.' })
  @ApiBadGatewayResponse({ description: 'Verification email delivery failed.' })
  async register(
    @Ip() ip: string,
    @Body() dto: RegisterCenterDto,
  ): Promise<{ message: 'verification email sent' }> {
    await this.rateLimitService.checkRegisterLimit(ip || 'unknown', dto.email);
    return this.centersService.register(dto);
  }
}
