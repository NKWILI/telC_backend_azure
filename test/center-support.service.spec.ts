/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { HttpException, HttpStatus } from '@nestjs/common';
import { CenterSupportService } from '../src/modules/centers/center-support.service';

/**
 * The support form (D24) and the deletion request (D37): what a school sends
 * must reach the team, and nothing it sends may be lost or turned against
 * anyone else.
 */
describe('CenterSupportService', () => {
  const identity = { centerId: 'center-1', centerUserId: 'owner-1' };
  const form = {
    name: 'Awa Mbarga',
    email: 'reply-here@school.cm',
    message: 'Our codes do not appear in the list.',
  };

  let prisma: any;
  let email: any;
  let config: any;
  let service: CenterSupportService;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    prisma = {
      centerUser: {
        findFirst: jest.fn().mockResolvedValue({
          first_name: 'Awa',
          last_name: 'Mbarga',
          email: 'awa@school.cm',
          phone: '+237690000000',
          center: { name: 'Institut Goethe Douala' },
        }),
      },
      supportRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(() => {
          calls.push('store');
          return Promise.resolve({ id: 'request-1' });
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    email = {
      sendSupportRequestToTeam: jest.fn(() => {
        calls.push('email team');
        return Promise.resolve();
      }),
      sendSupportAcknowledgement: jest.fn().mockResolvedValue(undefined),
      sendDeletionRequestAcknowledgement: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    config = { get: jest.fn().mockReturnValue('team@lerniqo.test') };
    service = new CenterSupportService(prisma, email, config);
  });

  describe('contact (D24)', () => {
    it('stores the message before emailing it, then marks it emailed', async () => {
      await expect(service.contact(identity, form)).resolves.toEqual({
        id: 'request-1',
      });

      expect(calls).toEqual(['store', 'email team']);
      expect(prisma.supportRequest.create).toHaveBeenCalledWith({
        data: {
          kind: 'CONTACT',
          center_id: 'center-1',
          center_user_id: 'owner-1',
          ...form,
        },
      });
      expect(prisma.supportRequest.update).toHaveBeenCalledWith({
        where: { id: 'request-1' },
        data: { emailed_at: expect.any(Date) },
      });
    });

    it('lets the team reply to the typed address, and names the account too', async () => {
      await service.contact(identity, form);

      const [to, sent] = email.sendSupportRequestToTeam.mock.calls[0];
      expect(to).toBe('team@lerniqo.test');
      expect(sent.replyTo).toBe('reply-here@school.cm');
      expect(sent.fields).toContainEqual(['Account email', 'awa@school.cm']);
      expect(sent.message).toBe(form.message);
    });

    it('acknowledges to the account email, never to the typed one', async () => {
      await service.contact(identity, form);

      expect(email.sendSupportAcknowledgement).toHaveBeenCalledWith(
        'awa@school.cm',
        'Awa',
      );
    });

    it('keeps the message when the email fails, and still answers 201', async () => {
      email.sendSupportRequestToTeam.mockRejectedValue(
        new Error('Resend down'),
      );

      await expect(service.contact(identity, form)).resolves.toEqual({
        id: 'request-1',
      });
      expect(prisma.supportRequest.update).not.toHaveBeenCalled();
    });

    it('stores without emailing when SUPPORT_EMAIL is not set', async () => {
      config.get.mockReturnValue(undefined);

      await service.contact(identity, form);

      expect(prisma.supportRequest.create).toHaveBeenCalled();
      expect(email.sendSupportRequestToTeam).not.toHaveBeenCalled();
    });

    it('refuses the 6th message in an hour, counted from the stored rows', async () => {
      prisma.supportRequest.count.mockResolvedValue(5);

      const refusal = await service.contact(identity, form).catch((e) => e);

      expect(refusal).toBeInstanceOf(HttpException);
      expect(refusal.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(refusal.message).toBe('RATE_LIMIT_EXCEEDED');
      expect(prisma.supportRequest.create).not.toHaveBeenCalled();
      const where = prisma.supportRequest.count.mock.calls[0][0].where;
      expect(where).toMatchObject({ center_id: 'center-1', kind: 'CONTACT' });
      expect(Date.now() - where.created_at.gte.getTime()).toBeCloseTo(
        60 * 60 * 1000,
        -3,
      );
    });
  });

  describe('deletion request (D37)', () => {
    it('emails the team who is asking, with their phone, and deletes nothing', async () => {
      await service.requestDeletion(identity);

      const [, sent] = email.sendSupportRequestToTeam.mock.calls[0];
      expect(sent.subject).toBe(
        'Account deletion requested: Institut Goethe Douala',
      );
      expect(sent.fields).toEqual(
        expect.arrayContaining([
          ['Manager', 'Awa Mbarga'],
          ['Email', 'awa@school.cm'],
          ['Phone', '+237690000000'],
        ]),
      );
      // Only the request row is written: the prisma mock has nothing else.
      expect(prisma.supportRequest.create.mock.calls[0][0].data.kind).toBe(
        'ACCOUNT_DELETION',
      );
      expect(email.sendDeletionRequestAcknowledgement).toHaveBeenCalledWith(
        'awa@school.cm',
        'Awa',
      );
    });

    it('allows 3 requests a day, then refuses', async () => {
      prisma.supportRequest.count.mockResolvedValue(3);

      await expect(service.requestDeletion(identity)).rejects.toThrow(
        'RATE_LIMIT_EXCEEDED',
      );
      const where = prisma.supportRequest.count.mock.calls[0][0].where;
      expect(where.kind).toBe('ACCOUNT_DELETION');
    });
  });
});
