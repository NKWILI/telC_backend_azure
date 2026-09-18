/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { CenterStudentsController } from '../src/modules/centers/center-students.controller';
import { CenterActivationCodesController } from '../src/modules/centers/center-activation-codes.controller';
import { CenterSubscriptionService } from '../src/modules/centers/center-subscription.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';
import { PricingService } from '../src/modules/centers/pricing.service';
import { CenterSeatsService } from '../src/modules/centers/center-seats.service';
import { PaymentsService } from '../src/modules/centers/payments.service';
import { CenterProfileController } from '../src/modules/centers/center-profile.controller';
import { CenterSubscriptionController } from '../src/modules/centers/center-subscription.controller';
import { CenterSubscriptionGuard } from '../src/modules/centers/guards/center-subscription.guard';
import { PaymentsController } from '../src/modules/centers/payments.controller';

const guardsOn = (target: object): unknown[] =>
  (Reflect.getMetadata('__guards__', target) ?? []) as unknown[];

const enforced = (handler: unknown) =>
  guardsOn(handler as object).includes(CenterSubscriptionGuard);

/**
 * Pins which half of the center dashboard a blocked center keeps.
 *
 * The refusals are the obvious half and would be noticed if they broke. The
 * permissions are the half that quietly rots: someone hardens the controller
 * later, puts the guard at class level, and a center that wants to pay can no
 * longer reach the page that would let it. This file makes that a failing
 * test rather than a support ticket.
 */
describe('what a blocked center can and cannot do', () => {
  // Access is granted through activation codes, and handing a seat to a new
  // student is what resetting a code does (D39). The old routes that created
  // students and minted per-student keys are gone (D20).
  describe('refused: granting new access', () => {
    it('cannot reset a code, which would give a seat to someone new', () => {
      expect(enforced(CenterActivationCodesController.prototype.reset)).toBe(
        true,
      );
    });

    it('cannot act on codes at all while blocked', () => {
      expect(
        enforced(CenterActivationCodesController.prototype.deactivate),
      ).toBe(true);
    });
  });

  /**
   * The road out. Every route a lapsed center walks to pay is here, and every
   * one of them must stay open — a center that cannot pay never comes back,
   * so a guard added to any of these is a revenue bug wearing the clothes of
   * a security fix.
   */
  describe('kept: the whole path to paying', () => {
    it('can still ask what seats would cost', () => {
      expect(enforced(CenterSubscriptionController.prototype.quote)).toBe(
        false,
      );
    });

    it('can still record an intent to pay', () => {
      expect(enforced(PaymentsController.prototype.create)).toBe(false);
    });

    it('can still read one of its payments', () => {
      expect(enforced(PaymentsController.prototype.get)).toBe(false);
    });

    it('can still read its payment history', () => {
      expect(enforced(PaymentsController.prototype.list)).toBe(false);
    });

    it('can still start a checkout', () => {
      // Creating a payment a center cannot then go and pay would leave a
      // lapsed center exactly as locked out as before.
      expect(enforced(PaymentsController.prototype.startCheckout)).toBe(false);
    });

    it('has no subscription guard at the class level either', () => {
      // A guard on the class would cover all three at once, which is exactly
      // how this would be broken in a single careless commit.
      expect(guardsOn(PaymentsController)).not.toContain(
        CenterSubscriptionGuard,
      );
    });
  });

  describe('kept: seeing where it stands, and paying', () => {
    it('can still read its subscription', () => {
      // The page that explains the block, and leads to the fix.
      expect(
        enforced(CenterSubscriptionController.prototype.subscription),
      ).toBe(false);
    });

    it('can still read its usage', () => {
      expect(enforced(CenterSubscriptionController.prototype.usage)).toBe(
        false,
      );
    });

    it('can still read its profile', () => {
      expect(enforced(CenterProfileController.prototype.me)).toBe(false);
    });

    it('can still update its profile', () => {
      // Billing contact details live here. Freezing them would block the very
      // correction that ends the block.
      expect(enforced(CenterProfileController.prototype.updateMe)).toBe(false);
    });
  });

  describe('kept: tidying up, which only ever reduces what is owed', () => {
    it('can still list its students', () => {
      expect(enforced(CenterStudentsController.prototype.list)).toBe(false);
    });

    it('can still read one student', () => {
      expect(enforced(CenterStudentsController.prototype.get)).toBe(false);
    });

    it('can still edit a student', () => {
      expect(enforced(CenterStudentsController.prototype.update)).toBe(false);
    });

    it('can still remove a student, freeing the seat', () => {
      // Refusing this would trap a center above the seat count it is trying
      // to get back down to.
      expect(enforced(CenterStudentsController.prototype.remove)).toBe(false);
    });

    it('can still see its codes and seats', () => {
      // Seeing what it holds is how a lapsed center decides to pay.
      expect(enforced(CenterActivationCodesController.prototype.list)).toBe(
        false,
      );
      expect(enforced(CenterActivationCodesController.prototype.seats)).toBe(
        false,
      );
    });
  });
  /**
   * The second gate, and the one that is not a guard.
   *
   * Profile completeness is checked inside payment creation rather than by a
   * guard, so reflection cannot pin it — but the property is the same shape as
   * everything above: the refusal must be narrow. A center that has not
   * finished its profile still needs to see what seats cost, because that is
   * the page that explains why finishing is worth it.
   */
  describe('a center that has not finished its profile', () => {
    const identity = { centerId: 'center-1', centerUserId: 'owner-1' } as never;

    const draftPrisma = () => ({
      // No country, no city, no manager phone: a center that registered and
      // stopped.
      centerUser: {
        findFirst: jest.fn().mockResolvedValue({
          phone: null,
          center: { country: null, city: null },
        }),
      },
      center: {
        findUnique: jest.fn().mockResolvedValue({ _count: { students: 0 } }),
      },
      centerSeat: { findMany: jest.fn().mockResolvedValue([]) },
      student: { groupBy: jest.fn().mockResolvedValue([]) },
      payment: { findUnique: jest.fn() },
      $transaction: jest.fn((run: (tx: unknown) => unknown) =>
        Promise.resolve(run({})),
      ),
    });

    it('can still be quoted', async () => {
      const prisma = draftPrisma();
      const subscriptions = new CenterSubscriptionService(
        prisma as never,
        new SubscriptionPolicyService(),
        new PricingService(),
        new CenterSeatsService(prisma as never),
      );

      await expect(
        subscriptions.quote(identity, { START: 10 }),
      ).resolves.toMatchObject({ totalXaf: 45000 });
    });

    it('cannot pay, and is told exactly what it still owes', async () => {
      const prisma = draftPrisma();
      const payments = new PaymentsService(
        prisma as never,
        new PricingService(),
        new CenterSeatsService(prisma as never),
      );

      await expect(
        payments.create(identity, { START: 10 }, 'key-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          message: 'CENTER_PROFILE_INCOMPLETE',
          missing: ['country', 'city', 'phone'],
        }),
      });
    });

    it('is refused before anything is written', async () => {
      const prisma = draftPrisma();
      const payments = new PaymentsService(
        prisma as never,
        new PricingService(),
        new CenterSeatsService(prisma as never),
      );

      await expect(
        payments.create(identity, { START: 10 }, 'key-1'),
      ).rejects.toThrow('CENTER_PROFILE_INCOMPLETE');

      // Never opened a transaction, so no row and no seat read.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
