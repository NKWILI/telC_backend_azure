import { Module } from '@nestjs/common';
import { SprachbausteineController } from './sprachbausteine.controller';
import { SprachbausteineService } from './sprachbausteine.service';
import { PrismaModule } from '../../shared/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SprachbausteineController],
  providers: [SprachbausteineService],
})
export class SprachbausteineModule {}
