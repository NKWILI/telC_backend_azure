import { Body, Controller, Ip, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { NewsletterService } from './newsletter.service';
import { RateLimitService } from '../../shared/services/rate-limit.service';
import { SubscribeRequestDto } from './dto/subscribe-request.dto';
import { SubscribeResponseDto } from './dto/subscribe-response.dto';

@Controller('api/newsletter')
export class NewsletterController {
  constructor(
    private readonly newsletterService: NewsletterService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  @Post('subscribe')
  async subscribe(
    @Body() dto: SubscribeRequestDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SubscribeResponseDto> {
    this.rateLimitService.checkNewsletterSubscribeLimit(
      ip || 'unknown',
      dto.email,
    );
    const result = await this.newsletterService.subscribe(dto);
    res.status(result.status);
    return { alreadySubscribed: result.alreadySubscribed };
  }
}
