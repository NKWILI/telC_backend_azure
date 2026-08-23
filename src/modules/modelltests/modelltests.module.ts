import { Module } from '@nestjs/common';
import { ModelltestsController } from './modelltests.controller';
import { ModelltestsService } from './modelltests.service';
import { PrismaModule } from '../../shared/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionAccessModule } from '../../shared/subscription-access.module';

@Module({
  imports: [PrismaModule, AuthModule, SubscriptionAccessModule],
  controllers: [ModelltestsController],
  providers: [ModelltestsService],
})
export class ModelltestsModule {}
