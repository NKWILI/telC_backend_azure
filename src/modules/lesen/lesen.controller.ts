import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { LesenService } from './lesen.service';
import { LesenExerciseResponseDto, LesenSubmitResponseDto } from './dto';
import { LesenSubmitRequestDto } from './dto/lesen-submit-request.dto';

@ApiTags('Reading')
@UseGuards(JwtAuthGuard)
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
    @Query('modelltest', new DefaultValuePipe(1), ParseIntPipe)
    modelltest: number,
  ): Promise<LesenExerciseResponseDto> {
    return this.lesenService.getExercise(modelltest);
  }

  @Post('submit')
  @ApiBody({ type: LesenSubmitRequestDto })
  @ApiOkResponse({ type: LesenSubmitResponseDto })
  submitTeil2(
    @Body() dto: LesenSubmitRequestDto,
  ): Promise<LesenSubmitResponseDto> {
    return this.lesenService.submitTeil2(dto);
  }
}
