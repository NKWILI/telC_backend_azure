import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';

/**
 * Reference data, like locations: no service and no database.
 *
 * It reads constants from the centers and quota modules but imports neither —
 * a plan list has no reason to pull center machinery into the graph, and the
 * marketing site reads this route with no center in sight.
 */
@Module({
  controllers: [PlansController],
})
export class PlansModule {}
