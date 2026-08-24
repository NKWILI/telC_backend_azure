/* eslint-disable @typescript-eslint/unbound-method */
import { CenterStudentsController } from '../src/modules/centers/center-students.controller';
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
  describe('refused: granting new access', () => {
    it('cannot provision a student', () => {
      expect(enforced(CenterStudentsController.prototype.provision)).toBe(true);
    });

    it('cannot mint a replacement activation key', () => {
      expect(
        enforced(CenterStudentsController.prototype.issueActivationKey),
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

    it('can still revoke an activation key', () => {
      expect(
        enforced(CenterStudentsController.prototype.revokeActivationKey),
      ).toBe(false);
    });
  });
});
