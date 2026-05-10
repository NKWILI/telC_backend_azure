import { Controller, Get, Post, Body, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SprachbausteineService } from './sprachbausteine.service';
import {
  SprachbausteineExerciseResponseDto,
  SubmitSprachbausteineResponseDto,
} from './dto';
import { SubmitSprachbausteineDto } from './dto/submit-sprachbausteine.dto';

@ApiTags('Sprachbausteine')
@Controller('api/sprachbausteine')
export class SprachbausteineController {
  constructor(
    private readonly sprachbausteineService: SprachbausteineService,
  ) {}

  @Get('exercise')
  @ApiQuery({ name: 'modelltest', required: false, schema: { type: 'integer', default: 1 }, example: 1 })
  @ApiOkResponse({ type: SprachbausteineExerciseResponseDto })
  getExercise(
    @Query('modelltest', new DefaultValuePipe(1), ParseIntPipe) modelltest: number,
  ): Promise<SprachbausteineExerciseResponseDto> {
    return this.sprachbausteineService.getExercise(modelltest);
  }

  @Post('submit')
  @ApiBody({ type: SubmitSprachbausteineDto })
  @ApiOkResponse({ type: SubmitSprachbausteineResponseDto })
  submit(
    @Body() dto: SubmitSprachbausteineDto,
  ): Promise<SubmitSprachbausteineResponseDto> {
    return this.sprachbausteineService.submit(dto);
  }
}
