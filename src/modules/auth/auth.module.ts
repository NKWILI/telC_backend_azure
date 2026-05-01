import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [TokenService, AuthService, JwtAuthGuard],
  exports: [TokenService, AuthService],
})
export class AuthModule {}
