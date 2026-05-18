import { Module } from '@nestjs/common';
import { LesenController } from './lesen.controller';
import { LesenService } from './lesen.service';
import { PrismaModule } from '../../shared/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [LesenController],
  providers: [LesenService],
})
export class LesenModule {}
