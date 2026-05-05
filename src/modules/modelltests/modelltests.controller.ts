import { Controller, Get, Param } from '@nestjs/common';
import { ModelltestsService } from './modelltests.service';
import type {
  ModelltestDetailDto,
  ModelltestListItemDto,
} from './dto/modelltest.dto';

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
