import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { AuthController } from './auth.controller';
import { DatabaseService } from '../../shared/services/database.service';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RateLimitService } from '../../shared/services/rate-limit.service';

@Module({
  controllers: [AuthController],
  providers: [
    TokenService,
    AuthService,
    DatabaseService,
    JwtAuthGuard,
    RateLimitService,
  ],
  exports: [TokenService, AuthService],
})
export class AuthModule {}
