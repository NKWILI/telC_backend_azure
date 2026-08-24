// require() is the point of this file: controllers are discovered on disk at
// runtime, so they cannot be named in static imports. A static list would
// defeat the test, which exists to catch a controller nobody remembered.
/* eslint-disable @typescript-eslint/no-require-imports */
import { UseGuards } from '@nestjs/common';
import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { StudentSubscriptionGuard } from '../src/shared/guards/student-subscription.guard';

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

      found.push({ name, guards: guardsOn(value), routeGuards });
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
