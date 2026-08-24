import { Module } from '@nestjs/common';
import { SprachbausteineController } from './sprachbausteine.controller';
import { SprachbausteineService } from './sprachbausteine.service';
import { PrismaModule } from '../../shared/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionAccessModule } from '../../shared/subscription-access.module';

@Module({
  imports: [PrismaModule, AuthModule, SubscriptionAccessModule],
  controllers: [SprachbausteineController],
  providers: [SprachbausteineService],
})
export class SprachbausteineModule {}
