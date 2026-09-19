import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupportRequestKind } from '@prisma/client';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';
import { EmailService } from '../auth/email.service';

type Identity = Pick<CenterAccessTokenPayload, 'centerId' | 'centerUserId'>;

const HOUR_MS = 60 * 60 * 1000;

/**
 * How often a center may write, counted from the stored rows rather than a
 * cache: Valkey is not deployed, and an in-memory counter would reset on every
 * deploy and differ between instances. The rows are the truth anyway.
 */
export const SUPPORT_LIMITS: Record<
  SupportRequestKind,
  { max: number; windowMs: number }
> = {
  CONTACT: { max: 5, windowMs: HOUR_MS },
  ACCOUNT_DELETION: { max: 3, windowMs: 24 * HOUR_MS },
};

/**
 * The support form (D24) and the account-deletion request (D37).
 *
 * Both are stored first and emailed second: a mail failure must never lose a
 * school's message, and a stored row with `emailed_at` null is findable.
 * Neither deletes nor changes anything else.
 */
@Injectable()
export class CenterSupportService {
  private readonly logger = new Logger(CenterSupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async contact(
    identity: Identity,
    form: { name: string; email: string; message: string },
  ): Promise<{ id: string }> {
    const manager = await this.manager(identity);
    await this.assertUnderLimit(identity, SupportRequestKind.CONTACT);

    const request = await this.prisma.supportRequest.create({
      data: {
        kind: SupportRequestKind.CONTACT,
        center_id: identity.centerId,
        center_user_id: identity.centerUserId,
        name: form.name,
        email: form.email,
        message: form.message,
      },
    });

    await this.deliver(request.id, async (team) => {
      await this.email.sendSupportRequestToTeam(team, {
        subject: `Support: ${manager.center.name}`,
        // Replies go where the manager asked to be answered.
        replyTo: form.email,
        fields: [
          ['School', manager.center.name],
          ['Name (as typed)', form.name],
          ['Email (as typed)', form.email],
          ['Account email', manager.email],
          ['Center id', identity.centerId],
        ],
        message: form.message,
      });
    });
    // To the account's own address, never the typed one: the form must not
    // send mail to whatever address a caller enters.
    await this.acknowledge(() =>
      this.email.sendSupportAcknowledgement(manager.email, manager.first_name),
    );

    return { id: request.id };
  }

  async requestDeletion(identity: Identity): Promise<{ id: string }> {
    const manager = await this.manager(identity);
    await this.assertUnderLimit(identity, SupportRequestKind.ACCOUNT_DELETION);

    const name = `${manager.first_name} ${manager.last_name}`.trim();
    const request = await this.prisma.supportRequest.create({
      data: {
        kind: SupportRequestKind.ACCOUNT_DELETION,
        center_id: identity.centerId,
        center_user_id: identity.centerUserId,
        name,
        email: manager.email,
      },
    });

    await this.deliver(request.id, async (team) => {
      await this.email.sendSupportRequestToTeam(team, {
        subject: `Account deletion requested: ${manager.center.name}`,
        replyTo: manager.email,
        fields: [
          ['School', manager.center.name],
          ['Manager', name],
          ['Email', manager.email],
          ['Phone', manager.phone ?? '—'],
          ['Center id', identity.centerId],
          [
            'Asks for',
            'the account and all its information to be deleted. Nothing has been deleted: contact the manager first.',
          ],
        ],
      });
    });
    await this.acknowledge(() =>
      this.email.sendDeletionRequestAcknowledgement(
        manager.email,
        manager.first_name,
      ),
    );

    return { id: request.id };
  }

  private async manager(identity: Identity) {
    const manager = await this.prisma.centerUser.findFirst({
      where: { id: identity.centerUserId, center_id: identity.centerId },
      select: {
        first_name: true,
        last_name: true,
        email: true,
        phone: true,
        center: { select: { name: true } },
      },
    });
    if (!manager) throw new NotFoundException('CENTER_USER_NOT_FOUND');
    return manager;
  }

  private async assertUnderLimit(
    identity: Identity,
    kind: SupportRequestKind,
  ): Promise<void> {
    const limit = SUPPORT_LIMITS[kind];
    const recent = await this.prisma.supportRequest.count({
      where: {
        center_id: identity.centerId,
        kind,
        created_at: { gte: new Date(Date.now() - limit.windowMs) },
      },
    });
    if (recent >= limit.max) {
      throw new HttpException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Emails the team, and marks the row only when that worked. */
  private async deliver(
    requestId: string,
    send: (team: string) => Promise<void>,
  ): Promise<void> {
    const team = this.config.get<string>('SUPPORT_EMAIL')?.trim();
    if (!team) {
      this.logger.error(
        `SUPPORT_EMAIL is not set: support request ${requestId} is stored but was not emailed`,
      );
      return;
    }
    try {
      await send(team);
      await this.prisma.supportRequest.update({
        where: { id: requestId },
        data: { emailed_at: new Date() },
      });
    } catch (err) {
      this.logger.error(
        `Support request ${requestId} is stored but the email failed: ${(err as Error).message}`,
      );
    }
  }

  /** A lost acknowledgement costs the manager a courtesy, not their message. */
  private async acknowledge(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (err) {
      this.logger.warn(`Acknowledgement not sent: ${(err as Error).message}`);
    }
  }
}
