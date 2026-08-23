import { Module } from '@nestjs/common';
import { ListeningController } from './listening.controller';
import { ListeningService } from './listening.service';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionAccessModule } from '../../shared/subscription-access.module';

@Module({
  imports: [AuthModule, SubscriptionAccessModule],
  controllers: [ListeningController],
  providers: [ListeningService],
})
export class ListeningModule {}
