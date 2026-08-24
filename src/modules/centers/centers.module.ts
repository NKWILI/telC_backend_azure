import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionAccessModule } from '../../shared/subscription-access.module';
import { CenterAuthController } from './center-auth.controller';
import { CenterAuthService } from './center-auth.service';
import { CenterExceptionFilter } from './center-exception.filter';
import { CenterProfileController } from './center-profile.controller';
import { CenterProfileService } from './center-profile.service';
import { CenterSubscriptionController } from './center-subscription.controller';
import { CenterSubscriptionService } from './center-subscription.service';
import { CenterStudentsController } from './center-students.controller';
import { CenterStudentsService } from './center-students.service';
import { StudentActivationController } from './student-activation.controller';
import { StudentActivationService } from './student-activation.service';
import { StudentProvisioningService } from './student-provisioning.service';
import { SubscriptionPolicyService } from './subscription-policy.service';
import { PricingService } from './pricing.service';
import { PaymentsService } from './payments.service';
import { CenterAuthGuard } from './guards/center-auth.guard';
import { CenterSubscriptionGuard } from './guards/center-subscription.guard';
import { CentersService } from './centers.service';

@Module({
  // SubscriptionAccessModule imports nothing, so this cannot close a cycle
  // back through AuthModule.
  imports: [AuthModule, SubscriptionAccessModule],
  controllers: [
    CenterAuthController,
    CenterProfileController,
    CenterSubscriptionController,
    CenterStudentsController,
    StudentActivationController,
  ],
  providers: [
    CentersService,
    CenterAuthService,
    CenterProfileService,
    CenterSubscriptionService,
    SubscriptionPolicyService,
    PricingService,
    PaymentsService,
    StudentProvisioningService,
    StudentActivationService,
    CenterStudentsService,
    CenterAuthGuard,
    CenterSubscriptionGuard,
    CenterExceptionFilter,
  ],
  exports: [CentersService, SubscriptionPolicyService],
})
export class CentersModule {}
