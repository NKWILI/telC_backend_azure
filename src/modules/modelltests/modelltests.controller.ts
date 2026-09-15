import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Tier } from '@prisma/client';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { StudentSubscriptionGuard } from '../../shared/guards/student-subscription.guard';
import { StudentTierGuard } from '../../shared/guards/student-tier.guard';
import { RequiresTier } from '../../shared/decorators/requires-tier.decorator';
import { ModelltestsService } from './modelltests.service';
import type {
  ModelltestDetailDto,
  ModelltestListItemDto,
} from './dto/modelltest.dto';

/**
 * The full timed exam simulation, and the line between Start and Pro.
 *
 * `RequiresTier` sits on the class rather than on each route because the whole
 * module is the paid feature — a route added here is gated by default, which
 * is the right way round for a gate that decides what a tier is worth.
 *
 * Per-skill practice (`/api/reading`, `/api/listening`, `/api/writing`,
 * `/api/sprachbausteine` and speaking practice) is deliberately NOT gated.
 * Those work independently of this module, which is what makes Start a usable
 * product rather than a stub, and `subscription-enforcement.spec` pins their
 * openness so this gate cannot spread by accident.
 */
@UseGuards(JwtAuthGuard, StudentSubscriptionGuard, StudentTierGuard)
@RequiresTier(Tier.PRO)
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
