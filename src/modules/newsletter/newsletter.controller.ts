import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { NewsletterService } from './newsletter.service';
import { SubscribeRequestDto } from './dto/subscribe-request.dto';
import { SubscribeResponseDto } from './dto/subscribe-response.dto';

@Controller('api/newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Post('subscribe')
  async subscribe(
    @Body() dto: SubscribeRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SubscribeResponseDto> {
    const result = await this.newsletterService.subscribe(dto);
    res.status(result.status);
    return { alreadySubscribed: result.alreadySubscribed };
  }
}
