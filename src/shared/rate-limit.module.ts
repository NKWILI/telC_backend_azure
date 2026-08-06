import { Global, Module } from '@nestjs/common';
import { RateLimitService } from './services/rate-limit.service';
import { ValkeyService } from './services/valkey.service';

@Global()
@Module({
  providers: [ValkeyService, RateLimitService],
  exports: [RateLimitService, ValkeyService],
})
export class RateLimitModule {}
