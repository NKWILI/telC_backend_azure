import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentStudent } from '../../shared/decorators/current-student.decorator';
import type { AccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { ProgressService } from './progress.service';
import { MyProgressDto } from './progress.dto';

@ApiTags('Progress')
@ApiBearerAuth()
@Controller('api/progress')
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  /**
   * No subscription guard, on purpose: this is the student's own history.
   * A student whose access lapsed still sees what they achieved. A guest has
   * no recorded activity and simply gets the empty numbers.
   */
  @Get('me')
  @ApiOperation({
    summary: 'My skill scores, exam readiness and weekly change',
    description:
      'The same numbers the school sees on its dashboard (D38), computed by the backend from every completed attempt.',
  })
  @ApiOkResponse({ type: MyProgressDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  me(@CurrentStudent() student: AccessTokenPayload): Promise<MyProgressDto> {
    return this.progress.forStudent(student.studentId);
  }
}
