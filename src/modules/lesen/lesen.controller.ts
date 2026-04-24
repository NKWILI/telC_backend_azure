import { Controller, Get, Post, Body } from '@nestjs/common';
import { LesenService } from './lesen.service';
import type { LesenExerciseResponseDto, LesenSubmitResponseDto } from './dto';
import { LesenSubmitRequestDto } from './dto/lesen-submit-request.dto';

@Controller('api/reading')
export class LesenController {
  constructor(private readonly lesenService: LesenService) {}

  @Get('exercise')
  async getExercise(): Promise<LesenExerciseResponseDto> {
    const [teil1, teil2Result, teil3] = await Promise.all([
      this.lesenService.getTeil1Exercise(),
      this.lesenService.getTeil2Exercise(),
      this.lesenService.getTeil3Exercise(),
    ]);
    return {
      contentRevision: teil2Result.contentRevision,
      issuedAt: teil2Result.issuedAt,
      teil1,
      teil2: teil2Result.teil2,
      teil3,
    };
  }

  @Post('submit')
  submitTeil2(@Body() dto: LesenSubmitRequestDto): Promise<LesenSubmitResponseDto> {
    return this.lesenService.submitTeil2(dto);
  }
}
