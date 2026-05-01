import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { TokenCryptoService } from './token-crypto.service';
import { EmailService } from './email.service';
import { GoogleService } from './google.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [
    TokenService,
    TokenCryptoService,
    EmailService,
    GoogleService,
    AuthService,
    JwtAuthGuard,
  ],
  exports: [TokenService, AuthService],
})
export class AuthModule {}
