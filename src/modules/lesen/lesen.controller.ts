import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

/** Served when the caller omits ?modelltest= — keeps existing clients working. */
const DEFAULT_MODELLTEST = 1;
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { StudentSubscriptionGuard } from '../../shared/guards/student-subscription.guard';
import { LesenService } from './lesen.service';
import { LesenExerciseResponseDto, LesenSubmitResponseDto } from './dto';
import { LesenSubmitRequestDto } from './dto/lesen-submit-request.dto';

@ApiTags('Reading')
@UseGuards(JwtAuthGuard, StudentSubscriptionGuard)
@Controller('api/reading')
export class LesenController {
  constructor(private readonly lesenService: LesenService) {}

  @Get('exercise')
  @ApiQuery({
    name: 'modelltest',
    required: false,
    schema: { type: 'integer', default: 1 },
    example: 1,
    description:
      'Which Modelltest to serve. Defaults to 1 when omitted. All three Teils come from the same Modelltest.',
  })
  @ApiOkResponse({ type: LesenExerciseResponseDto })
  getExercise(
    // Declared as string on purpose. The global ValidationPipe in main.ts runs
    // with transform: true, so a `number` param would have 'abc' coerced to NaN
    // before any param pipe sees it — DefaultValuePipe then silently substitutes
    // 1 and the caller gets Modelltest 1 instead of an error. Parsing the raw
    // string here keeps malformed input a 400. Same approach as
    // writing.controller.ts:69.
    @Query('modelltest') modelltest?: string,
  ): Promise<LesenExerciseResponseDto> {
    if (modelltest === undefined || modelltest === '') {
      return this.lesenService.getExercise(DEFAULT_MODELLTEST);
    }

    if (!/^\d+$/.test(modelltest)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'modelltest query param must be a positive integer',
        messageKey: 'readingInvalidModelltest',
      });
    }

    return this.lesenService.getExercise(Number(modelltest));
  }

  @Post('submit')
  @ApiBody({ type: LesenSubmitRequestDto })
  @ApiOkResponse({ type: LesenSubmitResponseDto })
  submit(@Body() dto: LesenSubmitRequestDto): Promise<LesenSubmitResponseDto> {
    return this.lesenService.submit(dto);
  }
}
