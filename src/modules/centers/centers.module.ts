import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
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
import { CenterAuthGuard } from './guards/center-auth.guard';
import { CentersService } from './centers.service';

@Module({
  imports: [AuthModule],
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
    StudentProvisioningService,
    StudentActivationService,
    CenterStudentsService,
    CenterAuthGuard,
    CenterExceptionFilter,
  ],
  exports: [CentersService, SubscriptionPolicyService],
})
export class CentersModule {}
