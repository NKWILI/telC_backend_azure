import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SprachbausteineService } from './sprachbausteine.service';
import { SprachbausteineExerciseResponseDto, SubmitSprachbausteineResponseDto } from './dto';
import { SubmitSprachbausteineDto } from './dto/submit-sprachbausteine.dto';

@ApiTags('Sprachbausteine')
@Controller('api/sprachbausteine')
export class SprachbausteineController {
  constructor(private readonly sprachbausteineService: SprachbausteineService) {}

  @Get('exercise')
  @ApiOkResponse({ type: SprachbausteineExerciseResponseDto })
  getExercise(): Promise<SprachbausteineExerciseResponseDto> {
    return this.sprachbausteineService.getExercise();
  }

  @Post('submit')
  @ApiBody({ type: SubmitSprachbausteineDto })
  @ApiOkResponse({ type: SubmitSprachbausteineResponseDto })
  submit(@Body() dto: SubmitSprachbausteineDto): Promise<SubmitSprachbausteineResponseDto> {
    return this.sprachbausteineService.submit(dto);
  }
}
