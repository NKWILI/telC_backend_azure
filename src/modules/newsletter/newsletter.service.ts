import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { SubscribeRequestDto } from './dto/subscribe-request.dto';

const DEFAULT_CONSENT_VERSION = 'v1';

export interface SubscribeResult {
  alreadySubscribed: boolean;
  status: 200 | 201;
}

@Injectable()
export class NewsletterService {
  constructor(private readonly prisma: PrismaService) {}

  async subscribe(dto: SubscribeRequestDto): Promise<SubscribeResult> {
    if (dto.consent !== true) {
      throw new BadRequestException('CONSENT_REQUIRED');
    }

    const consentVersion = dto.consentVersion ?? DEFAULT_CONSENT_VERSION;

    const existing = await this.prisma.newsletterSubscriber.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      await this.prisma.newsletterSubscriber.update({
        where: { email: dto.email },
        data: {
          full_name: dto.fullName,
          consent_version: consentVersion,
          consented_at: new Date(),
        },
      });
      return { alreadySubscribed: true, status: 200 };
    }

    await this.prisma.newsletterSubscriber.create({
      data: {
        email: dto.email,
        full_name: dto.fullName,
        consent_version: consentVersion,
      },
    });
    return { alreadySubscribed: false, status: 201 };
  }
}
