import { Controller, Get, Post, Body } from '@nestjs/common';
import { SprachbausteineService } from './sprachbausteine.service';
import type { SprachbausteineExerciseResponseDto, SubmitSprachbausteineResponseDto } from './dto';
import { SubmitSprachbausteineDto } from './dto/submit-sprachbausteine.dto';

@Controller('api/sprachbausteine')
export class SprachbausteineController {
  constructor(private readonly sprachbausteineService: SprachbausteineService) {}

  @Get('exercise')
  getExercise(): Promise<SprachbausteineExerciseResponseDto> {
    return this.sprachbausteineService.getExercise();
  }

  @Post('submit')
  submit(@Body() dto: SubmitSprachbausteineDto): Promise<SubmitSprachbausteineResponseDto> {
    return this.sprachbausteineService.submit(dto);
  }
}
