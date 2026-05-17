import { Module } from '@nestjs/common';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';
import { PrismaModule } from '../../shared/prisma.module';
import { RateLimitService } from '../../shared/services/rate-limit.service';

@Module({
  imports: [PrismaModule],
  controllers: [NewsletterController],
  providers: [NewsletterService, RateLimitService],
})
export class NewsletterModule {}
