import { Module } from '@nestjs/common';
import { ModelltestsController } from './modelltests.controller';
import { ModelltestsService } from './modelltests.service';
import { PrismaModule } from '../../shared/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ModelltestsController],
  providers: [ModelltestsService],
})
export class ModelltestsModule {}
