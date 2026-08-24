import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { TokenCryptoService } from './token-crypto.service';
import { EmailService } from './email.service';
import { GoogleService } from './google.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { SubscriptionAccessModule } from '../../shared/subscription-access.module';

@Module({
  // SubscriptionAccessModule deliberately imports nothing, so this cannot
  // close a cycle back through CentersModule (which imports AuthModule).
  imports: [SubscriptionAccessModule],
  controllers: [AuthController],
  providers: [
    TokenService,
    TokenCryptoService,
    EmailService,
    GoogleService,
    AuthService,
    JwtAuthGuard,
  ],
  exports: [TokenService, TokenCryptoService, EmailService, AuthService],
})
export class AuthModule {}
