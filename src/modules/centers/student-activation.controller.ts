import { Body, Controller, Ip, Post, UseFilters } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { RateLimitService } from '../../shared/services/rate-limit.service';
import { CenterExceptionFilter } from './center-exception.filter';
import {
  ActivateStudentDto,
  StudentTokenPairDto,
} from './dto/student-activation.dto';
import { CenterErrorResponseDto } from './dto/center-error-response.dto';
import { StudentActivationService } from './student-activation.service';

@ApiTags('Student Activation')
@Controller('api/student-activations')
@UseFilters(CenterExceptionFilter)
export class StudentActivationController {
  constructor(
    private readonly activation: StudentActivationService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  /**
   * Public by design: a student arrives with a key and no account they can yet
   * sign into. The key is the credential, which is why this is rate limited by
   * address — it is the only endpoint where guessing gets you an account.
   */
  @Post()
  @ApiOperation({
    summary: 'Redeem an activation key and set a password',
    description:
      'The student chooses their own password here; their center never learns it. The key is single-use, and the first activation in a center starts its 30-day trial.',
  })
  @ApiCreatedResponse({ type: StudentTokenPairDto })
  @ApiBadRequestResponse({ type: CenterErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: CenterErrorResponseDto })
  async activate(
    @Ip() ip: string,
    @Body() dto: ActivateStudentDto,
  ): Promise<StudentTokenPairDto> {
    await this.rateLimitService.checkStudentActivationLimit(ip || 'unknown');

    return this.activation.activate({ ...dto, ip: ip || 'unknown' });
  }
}
