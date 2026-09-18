import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { CenterSeatsService } from './center-seats.service';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentWebhooksController } from './payment-webhooks.controller';
import { PaymentWebhookService } from './payment-webhook.service';
import { PaymentActivationService } from './payment-activation.service';
import { PaymentCheckoutService } from './payment-checkout.service';
import {
  PAYMENT_PROVIDER,
  selectPaymentProvider,
} from './payment-providers/payment-provider';
import { CenterAuthGuard } from './guards/center-auth.guard';
import { CenterSubscriptionGuard } from './guards/center-subscription.guard';
import { CentersService } from './centers.service';
import { CenterTrialService } from './center-trial.service';
import { CenterActivationCodesController } from './center-activation-codes.controller';
import { CenterActivationCodesService } from './center-activation-codes.service';
import { CodeRedemptionController } from './code-redemption.controller';
import { CodeRedemptionService } from './code-redemption.service';

@Module({
  // SubscriptionAccessModule imports nothing, so this cannot close a cycle
  // back through AuthModule.
  imports: [AuthModule, SubscriptionAccessModule],
  controllers: [
    CenterAuthController,
    CenterActivationCodesController,
    CodeRedemptionController,
    CenterProfileController,
    CenterSubscriptionController,
    CenterStudentsController,
    StudentActivationController,
    PaymentsController,
    PaymentWebhooksController,
  ],
  providers: [
    CentersService,
    CenterAuthService,
    CenterProfileService,
    CenterSubscriptionService,
    CenterTrialService,
    CenterActivationCodesService,
    CodeRedemptionService,
    SubscriptionPolicyService,
    PricingService,
    CenterSeatsService,
    PaymentsService,
    PaymentActivationService,
    PaymentCheckoutService,
    PaymentWebhookService,
    // Chosen once at boot, failing closed: anything short of an explicit,
    // non-production, properly secreted configuration is the disabled
    // provider. See selectPaymentProvider.
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        selectPaymentProvider({
          PAYMENT_PROVIDER: config.get<string>('PAYMENT_PROVIDER'),
          NODE_ENV: config.get<string>('NODE_ENV'),
          FAKE_PAYMENT_WEBHOOK_SECRET: config.get<string>(
            'FAKE_PAYMENT_WEBHOOK_SECRET',
          ),
        }),
    },
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
