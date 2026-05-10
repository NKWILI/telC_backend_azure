import { Module } from '@nestjs/common';
import { SprachbausteineController } from './sprachbausteine.controller';
import { SprachbausteineService } from './sprachbausteine.service';
import { PrismaModule } from '../../shared/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SprachbausteineController],
  providers: [SprachbausteineService],
})
export class SprachbausteineModule {}
