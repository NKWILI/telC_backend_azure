import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { ModelltestsService } from './modelltests.service';
import type {
  ModelltestDetailDto,
  ModelltestListItemDto,
} from './dto/modelltest.dto';

@UseGuards(JwtAuthGuard)
@Controller('api/modelltests')
export class ModelltestsController {
  constructor(private readonly service: ModelltestsService) {}

  @Get()
  getAll(): Promise<ModelltestListItemDto[]> {
    return this.service.getAll();
  }

  @Get(':number')
  getByNumber(@Param('number') number: string): Promise<ModelltestDetailDto> {
    return this.service.getByNumber(+number);
  }
}
