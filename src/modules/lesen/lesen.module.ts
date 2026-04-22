import { Module } from '@nestjs/common';
import { LesenController } from './lesen.controller';
import { LesenService } from './lesen.service';
import { PrismaModule } from '../../shared/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LesenController],
  providers: [LesenService],
})
export class LesenModule {}
