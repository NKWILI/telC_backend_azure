/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires */
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
  // Guards are per-route here, and room creation is closed separately in
  // Task 2b so that guest join by link keeps working.
  RoomController: 'per-route guards; handled by Task 2b',
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
  guards: unknown[];
}

/**
 * Reads the guards Nest recorded from `@UseGuards` on the class itself.
 * Route-level guards live on the handler, so they deliberately do not appear.
 */
function discoverControllers(): DiscoveredController[] {
  const found: DiscoveredController[] = [];

  for (const file of findControllerFiles(MODULES_DIR)) {
    const exported = require(file) as Record<string, unknown>;

    for (const [name, value] of Object.entries(exported)) {
      if (typeof value !== 'function' || !name.endsWith('Controller')) continue;

      const guards = (Reflect.getMetadata('__guards__', value) ??
        []) as unknown[];
      found.push({ name, guards });
    }
  }

  return found;
}

describe('subscription enforcement across learning controllers', () => {
  const controllers = discoverControllers();

  const guarded = controllers.filter((c) => c.guards.includes(JwtAuthGuard));

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
      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(StudentSubscriptionGuard),
      );
    },
  );

  /**
   * The point of the whole file. A learning controller added next month with
   * only JwtAuthGuard fails here rather than shipping unenforced.
   */
  it('leaves no student-authenticated controller unenforced', () => {
    const unenforced = guarded
      .filter((c) => !c.guards.includes(StudentSubscriptionGuard))
      .map((c) => c.name)
      .filter((name) => !(name in EXEMPT));

    expect(unenforced).toEqual([]);
  });

  it('keeps every exemption deliberate', () => {
    for (const [name, reason] of Object.entries(EXEMPT)) {
      expect(controllers.some((c) => c.name === name)).toBe(true);
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});
