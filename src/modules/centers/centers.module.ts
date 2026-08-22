import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CenterAuthService } from './center-auth.service';
import { CenterExceptionFilter } from './center-exception.filter';
import { CentersController } from './centers.controller';
import { CentersService } from './centers.service';

@Module({
  imports: [AuthModule],
  controllers: [CentersController],
  providers: [CentersService, CenterAuthService, CenterExceptionFilter],
  exports: [CentersService],
})
export class CentersModule {}
