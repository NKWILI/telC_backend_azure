import { Module } from '@nestjs/common';
import { SubscriptionPolicyService } from '../modules/centers/subscription-policy.service';
import { StudentEntitlementService } from './services/student-entitlement.service';
import { StudentSubscriptionGuard } from './guards/student-subscription.guard';

/**
 * Carries subscription enforcement to the modules that need it: the learning
 * controllers get the guard, and `AuthModule` gets the entitlement service so
 * login and refresh can report a status.
 *
 * It provides `SubscriptionPolicyService` directly rather than importing
 * `CentersModule`, which would be the obvious wiring and is the wrong one:
 * `CentersModule` imports `AuthModule`, so `AuthModule` importing this would
 * close a cycle. Providing the class here keeps the graph acyclic. The policy
 * is a pure, stateless class, so a second instance behaves identically — and
 * "one authority" was always about one implementation of the rule, not one
 * object. `PrismaModule` is global, so it needs no import.
 */
@Module({
  providers: [
    SubscriptionPolicyService,
    StudentEntitlementService,
    StudentSubscriptionGuard,
  ],
  exports: [StudentSubscriptionGuard, StudentEntitlementService],
})
export class SubscriptionAccessModule {}
