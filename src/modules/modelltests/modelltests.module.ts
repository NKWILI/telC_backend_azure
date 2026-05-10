import { Module } from '@nestjs/common';
import { ModelltestsController } from './modelltests.controller';
import { ModelltestsService } from './modelltests.service';
import { PrismaModule } from '../../shared/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ModelltestsController],
  providers: [ModelltestsService],
})
export class ModelltestsModule {}
