import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CenterAuthController } from './center-auth.controller';
import { CenterAuthService } from './center-auth.service';
import { CenterExceptionFilter } from './center-exception.filter';
import { CenterProfileController } from './center-profile.controller';
import { CenterProfileService } from './center-profile.service';
import { CenterAuthGuard } from './guards/center-auth.guard';
import { CentersService } from './centers.service';

@Module({
  imports: [AuthModule],
  controllers: [CenterAuthController, CenterProfileController],
  providers: [
    CentersService,
    CenterAuthService,
    CenterProfileService,
    CenterAuthGuard,
    CenterExceptionFilter,
  ],
  exports: [CentersService],
})
export class CentersModule {}
