// require() is the point of this file: controllers are discovered on disk at
// runtime, so they cannot be named in static imports. A static list would
// defeat the test, which exists to catch a controller nobody remembered.
/* eslint-disable @typescript-eslint/no-require-imports */
import { UseGuards } from '@nestjs/common';
import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { StudentSubscriptionGuard } from '../src/shared/guards/student-subscription.guard';
import { StudentTierGuard } from '../src/shared/guards/student-tier.guard';
import { REQUIRES_TIER } from '../src/shared/decorators/requires-tier.decorator';

/**
 * Controllers that authenticate a student but must NOT require a live
 * subscription. Every entry needs a reason, because adding one is how a
 * learning route would quietly escape enforcement.
 */
const EXEMPT: Record<string, string> = {
  // A blocked student still has to log in, refresh and reset a password.
  // Refusing here would strand the account their center may yet pay for.
  AuthController: 'auth must stay reachable while blocked',
  // Guards are per-route here. Room creation carries both guards; the public
  // room lookup stays open so a guest can join by link. Proven in
  // room-subscription.spec.ts rather than by this sweep.
  RoomController: 'per-route guards; enforced on create, public on lookup',
};

/** The seven the plan inventoried. Named so the scan cannot pass vacuously. */
const EXPECTED_LEARNING_CONTROLLERS = [
  'LesenController',
  'ListeningController',
  'ModelltestsController',
  'SpeakingController',
  'SpeakingCatalogController',
  'SprachbausteineController',
  'WritingController',
];

const MODULES_DIR = resolve(__dirname, '..', 'src', 'modules');

function findControllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return findControllerFiles(full);
    return entry.endsWith('.controller.ts') ? [full] : [];
  });
}

interface DiscoveredController {
  name: string;
  /** The class itself, so metadata other than guards can be read from it. */
  target: object;
  /** Guards from `@UseGuards` on the class itself. */
  guards: unknown[];
  /** Guards on each handler, keyed by method name. */
  routeGuards: Map<string, unknown[]>;
}

const guardsOn = (target: object): unknown[] =>
  (Reflect.getMetadata('__guards__', target) ?? []) as unknown[];

/**
 * Reads the guards Nest recorded, both on the class and on every handler.
 *
 * Handlers are read deliberately rather than for completeness. Scanning only
 * the class would miss a controller that applies JwtAuthGuard per-route — the
 * shape AuthController and RoomController already use — so a new one written
 * that way would slip past the very sweep meant to catch it.
 */
function discoverControllers(): DiscoveredController[] {
  const found: DiscoveredController[] = [];

  for (const file of findControllerFiles(MODULES_DIR)) {
    const exported = require(file) as Record<string, unknown>;

    for (const [name, value] of Object.entries(exported)) {
      if (typeof value !== 'function' || !name.endsWith('Controller')) continue;

      const prototype = (value as { prototype: object }).prototype;
      const routeGuards = new Map<string, unknown[]>();

      for (const method of Object.getOwnPropertyNames(prototype)) {
        if (method === 'constructor') continue;

        const handler = (prototype as Record<string, unknown>)[method];
        if (typeof handler !== 'function') continue;

        const onHandler = guardsOn(handler);
        if (onHandler.length > 0) routeGuards.set(method, onHandler);
      }

      found.push({
        name,
        target: value as object,
        guards: guardsOn(value),
        routeGuards,
      });
    }
  }

  return found;
}

/** Every guard protecting a route, whether declared on the class or the handler. */
const effectiveGuards = (
  controller: DiscoveredController,
  method: string,
): unknown[] => [
  ...controller.guards,
  ...(controller.routeGuards.get(method) ?? []),
];

describe('subscription enforcement across learning controllers', () => {
  const controllers = discoverControllers();

  it('discovers the controllers at all, so the sweep cannot pass vacuously', () => {
    expect(controllers.length).toBeGreaterThanOrEqual(
      EXPECTED_LEARNING_CONTROLLERS.length,
    );
  });

  it.each(EXPECTED_LEARNING_CONTROLLERS)(
    '%s is still present and still authenticates',
    (name) => {
      const controller = controllers.find((c) => c.name === name);

      expect(controller).toBeDefined();
      expect(controller!.guards).toContain(JwtAuthGuard);
    },
  );

  it.each(EXPECTED_LEARNING_CONTROLLERS)(
    '%s refuses a student whose center is not entitled',
    (name) => {
      const controller = controllers.find((c) => c.name === name);

      expect(controller!.guards).toContain(StudentSubscriptionGuard);
    },
  );

  it.each(EXPECTED_LEARNING_CONTROLLERS)(
    '%s checks identity before entitlement',
    (name) => {
      const { guards } = controllers.find((c) => c.name === name)!;

      // StudentSubscriptionGuard reads request.student, which JwtAuthGuard
      // puts there. Reversed, it would see no student and wave everyone
      // through — a silent hole rather than a loud failure.
      //
      // Presence is asserted before order, because indexOf returns -1 for an
      // absent guard and -1 is less than every real index: the comparison
      // alone would pass for a controller that had no JwtAuthGuard at all,
      // which is the exact case it is supposed to rule out.
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(StudentSubscriptionGuard);
      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(StudentSubscriptionGuard),
      );
    },
  );

  /**
   * The point of the whole file. A learning controller added next month with
   * only JwtAuthGuard fails here rather than shipping unenforced — whether it
   * declares that guard on the class or on each route.
   */
  it('leaves no student-authenticated route unenforced', () => {
    const unenforced: string[] = [];

    for (const controller of controllers) {
      if (controller.name in EXEMPT) continue;

      // Every route the controller actually exposes, plus a sentinel for a
      // class-level declaration with no decorated handlers of its own.
      const methods = new Set([
        ...controller.routeGuards.keys(),
        ...(controller.guards.length > 0 ? ['<class>'] : []),
      ]);

      for (const method of methods) {
        const guards = effectiveGuards(controller, method);

        if (
          guards.includes(JwtAuthGuard) &&
          !guards.includes(StudentSubscriptionGuard)
        ) {
          unenforced.push(`${controller.name}.${method}`);
        }
      }
    }

    expect(unenforced).toEqual([]);
  });

  /**
   * The inverse mistake, which is the worse one: a route carrying
   * StudentSubscriptionGuard but NOT JwtAuthGuard.
   *
   * That route looks protected and protects nothing. The guard reads
   * `request.student`, which only JwtAuthGuard sets, and returns true when
   * there is no student to check — so every caller, authenticated or not,
   * passes straight through. A missing guard is at least visible; this one
   * reads as defence in depth while being an open door.
   */
  it('never enforces entitlement on a route that does not establish identity', () => {
    const identityless: string[] = [];

    for (const controller of controllers) {
      const methods = new Set([
        ...controller.routeGuards.keys(),
        ...(controller.guards.length > 0 ? ['<class>'] : []),
      ]);

      for (const method of methods) {
        const guards = effectiveGuards(controller, method);

        if (
          guards.includes(StudentSubscriptionGuard) &&
          !guards.includes(JwtAuthGuard)
        ) {
          identityless.push(`${controller.name}.${method}`);
        }
      }
    }

    expect(identityless).toEqual([]);
  });

  /**
   * Guards against the sweep quietly going blind. If handler metadata ever
   * stops being readable, routeGuards empties and the check above passes
   * while testing nothing — so assert we can still see a known per-route case.
   */
  it('can see per-route guards, not only class-level ones', () => {
    const room = controllers.find((c) => c.name === 'RoomController');

    expect(room!.guards).toEqual([]);
    expect(room!.routeGuards.get('createRoom')).toContain(
      StudentSubscriptionGuard,
    );
  });

  /**
   * Proves the sweep above can fail, not merely that it passes today.
   *
   * Both real per-route controllers are exempt, so nothing else exercises that
   * branch — without this, the per-route detection could be broken and every
   * assertion here would stay green.
   */
  describe('the sweep would actually catch an offender', () => {
    class UnenforcedController {
      @UseGuards(JwtAuthGuard)
      findAll() {}
    }

    class EnforcedController {
      @UseGuards(JwtAuthGuard, StudentSubscriptionGuard)
      findAll() {}
    }

    const inspect = (cls: { prototype: { findAll: object } }) => {
      const routeGuards = guardsOn(cls.prototype.findAll);
      return {
        authenticates: routeGuards.includes(JwtAuthGuard),
        enforces: routeGuards.includes(StudentSubscriptionGuard),
      };
    };

    it('flags a route that authenticates but does not enforce', () => {
      expect(inspect(UnenforcedController)).toEqual({
        authenticates: true,
        enforces: false,
      });
    });

    it('clears a route that does both', () => {
      expect(inspect(EnforcedController)).toEqual({
        authenticates: true,
        enforces: true,
      });
    });
  });

  it('keeps every exemption deliberate', () => {
    for (const [name, reason] of Object.entries(EXEMPT)) {
      expect(controllers.some((c) => c.name === name)).toBe(true);
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});
/**
 * Which learning controllers gate on tier, and — the half that quietly rots —
 * which must not.
 *
 * The exam module is the line between Start and Pro. Per-skill practice is
 * what makes Start a usable product rather than a stub, so a tier requirement
 * spreading to any of it would be sold as a hardening and land as a refund
 * request.
 */
describe('tier enforcement is exactly where it was decided', () => {
  const controllers = discoverControllers();
  const tierOn = (target: object): unknown =>
    Reflect.getMetadata(REQUIRES_TIER, target);

  /** Only the full exam simulation. Every other learning route is open to Start. */
  const TIER_GATED = ['ModelltestsController'];

  const OPEN_TO_START = EXPECTED_LEARNING_CONTROLLERS.filter(
    (name) => !TIER_GATED.includes(name),
  );

  it.each(TIER_GATED)('%s requires Pro or better', (name) => {
    const controller = controllers.find((c) => c.name === name);

    expect(controller).toBeDefined();
    // Both halves matter: the guard is what refuses, and the decorator is what
    // tells it to. Either one missing is an open route, and the guard without
    // a decorator is the quieter of the two failures.
    expect(controller!.guards).toContain(StudentTierGuard);
    expect(tierOn(controller!.target)).toBe('PRO');
  });

  it.each(TIER_GATED)('%s checks entitlement before tier', (name) => {
    const { guards } = controllers.find((c) => c.name === name)!;

    // The tier guard reuses the entitlement the subscription guard leaves on
    // the request. It fetches its own if there is none, so the order is not
    // load-bearing for correctness — but a blocked center should hear
    // SUBSCRIPTION_INACTIVE rather than TIER_TOO_LOW, because only one of
    // those is the thing they need to fix.
    expect(guards.indexOf(StudentSubscriptionGuard)).toBeLessThan(
      guards.indexOf(StudentTierGuard),
    );
  });

  it.each(OPEN_TO_START)('%s stays open to a Start student', (name) => {
    const controller = controllers.find((c) => c.name === name);

    expect(controller).toBeDefined();
    expect(controller!.guards).not.toContain(StudentTierGuard);
    // Per-route as well as per-class: a gate added to one handler is exactly
    // how this would spread without anyone noticing.
    expect([...controller!.routeGuards.values()].flat()).not.toContain(
      StudentTierGuard,
    );
    expect(tierOn(controller!.target)).toBeUndefined();
  });

  it('gates the exam module and nothing else', () => {
    // A guard can only refuse where it is mounted, so counting the mounts is
    // what stops this spreading one controller at a time.
    const gated = controllers.filter(
      (c) =>
        c.guards.includes(StudentTierGuard) ||
        [...c.routeGuards.values()].flat().includes(StudentTierGuard),
    );

    expect(gated.map((c) => c.name).sort()).toEqual(TIER_GATED);
  });
});
