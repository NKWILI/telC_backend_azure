import { Controller, Get, Post, Body } from '@nestjs/common';
import { LesenService } from './lesen.service';
import type { LesenExerciseResponseDto, LesenSubmitResponseDto } from './dto';
import { LesenSubmitRequestDto } from './dto/lesen-submit-request.dto';

@Controller('api/lesen')
export class LesenController {
  constructor(private readonly lesenService: LesenService) {}

  @Get('exercise')
  getTeil2Exercise(): Promise<LesenExerciseResponseDto> {
    return this.lesenService.getTeil2Exercise();
  }

  @Post('submit')
  submitTeil2(@Body() dto: LesenSubmitRequestDto): Promise<LesenSubmitResponseDto> {
    return this.lesenService.submitTeil2(dto);
  }
}
