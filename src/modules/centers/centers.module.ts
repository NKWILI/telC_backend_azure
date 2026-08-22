import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CenterAuthController } from './center-auth.controller';
import { CenterAuthService } from './center-auth.service';
import { CenterExceptionFilter } from './center-exception.filter';
import { CentersService } from './centers.service';

@Module({
  imports: [AuthModule],
  controllers: [CenterAuthController],
  providers: [CentersService, CenterAuthService, CenterExceptionFilter],
  exports: [CentersService],
})
export class CentersModule {}
