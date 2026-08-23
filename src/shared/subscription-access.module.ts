import { Module } from '@nestjs/common';
import { CentersModule } from '../modules/centers/centers.module';
import { StudentSubscriptionGuard } from './guards/student-subscription.guard';

/**
 * Carries `StudentSubscriptionGuard` to the learning modules.
 *
 * It exists so `lesen`, `listening` and the rest import one small thing rather
 * than the whole of `CentersModule` — they need a guard, not the center
 * dashboard. `PrismaModule` is global, so the guard's other dependency needs
 * no import here.
 */
@Module({
  imports: [CentersModule],
  providers: [StudentSubscriptionGuard],
  exports: [StudentSubscriptionGuard],
})
export class SubscriptionAccessModule {}
