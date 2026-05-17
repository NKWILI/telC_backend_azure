import { BadRequestException } from '@nestjs/common';
import { NewsletterService } from './newsletter.service';

describe('NewsletterService', () => {
  let service: NewsletterService;

  const mockPrisma = {
    newsletterSubscriber: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NewsletterService(mockPrisma as any);
  });

  describe('subscribe', () => {
    const validDto = {
      email: 'anna.mueller@example.com',
      fullName: 'Anna Müller',
      consent: true,
      consentVersion: 'v1',
    };

    it('creates a new row and returns alreadySubscribed:false, status:201 when email is new', async () => {
      mockPrisma.newsletterSubscriber.findUnique.mockResolvedValueOnce(null);
      mockPrisma.newsletterSubscriber.create.mockResolvedValueOnce({});

      const result = await service.subscribe(validDto);

      expect(result).toEqual({ alreadySubscribed: false, status: 201 });
      expect(mockPrisma.newsletterSubscriber.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'anna.mueller@example.com',
          full_name: 'Anna Müller',
          consent_version: 'v1',
        }),
      });
      expect(mockPrisma.newsletterSubscriber.update).not.toHaveBeenCalled();
    });

    it('updates the existing row and returns alreadySubscribed:true, status:200 when email is known', async () => {
      mockPrisma.newsletterSubscriber.findUnique.mockResolvedValueOnce({
        id: 'sub-1',
        email: 'anna.mueller@example.com',
      });
      mockPrisma.newsletterSubscriber.update.mockResolvedValueOnce({});

      const result = await service.subscribe(validDto);

      expect(result).toEqual({ alreadySubscribed: true, status: 200 });
      expect(mockPrisma.newsletterSubscriber.update).toHaveBeenCalledWith({
        where: { email: 'anna.mueller@example.com' },
        data: expect.objectContaining({
          full_name: 'Anna Müller',
          consent_version: 'v1',
          consented_at: expect.any(Date),
        }),
      });
      expect(mockPrisma.newsletterSubscriber.create).not.toHaveBeenCalled();
    });

    it('throws CONSENT_REQUIRED when consent is false', async () => {
      await expect(
        service.subscribe({ ...validDto, consent: false }),
      ).rejects.toMatchObject({
        response: { message: 'CONSENT_REQUIRED' },
      });
      await expect(
        service.subscribe({ ...validDto, consent: false }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockPrisma.newsletterSubscriber.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.newsletterSubscriber.create).not.toHaveBeenCalled();
      expect(mockPrisma.newsletterSubscriber.update).not.toHaveBeenCalled();
    });

    it('defaults consent_version to "v1" when omitted', async () => {
      mockPrisma.newsletterSubscriber.findUnique.mockResolvedValueOnce(null);
      mockPrisma.newsletterSubscriber.create.mockResolvedValueOnce({});

      const { consentVersion: _omit, ...dtoNoVersion } = validDto;

      await service.subscribe(dtoNoVersion as any);

      expect(mockPrisma.newsletterSubscriber.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ consent_version: 'v1' }),
      });
    });

    it('passes the email through to Prisma unchanged (DTO transformer handles lowercasing)', async () => {
      // The DTO's @Transform lowercases before this service is reached, so the
      // service does not need to lowercase again. This test pins that contract.
      mockPrisma.newsletterSubscriber.findUnique.mockResolvedValueOnce(null);
      mockPrisma.newsletterSubscriber.create.mockResolvedValueOnce({});

      await service.subscribe({ ...validDto, email: 'already.lower@x.com' });

      expect(mockPrisma.newsletterSubscriber.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ email: 'already.lower@x.com' }),
      });
    });
  });
});
