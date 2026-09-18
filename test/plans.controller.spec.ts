import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PlansController } from '../src/modules/plans/plans.controller';
import { TIER_PRICES_XAF } from '../src/modules/centers/pricing.service';
import { TIER_AI_ALLOWANCE } from '../src/shared/services/ai-quota.service';

/**
 * What a plan costs and allows, served from the constants the backend
 * enforces.
 *
 * The point of the route is that there is ONE source. The same numbers lived
 * in the frontend too, so raising Start to 4,800 here would have left the site
 * advertising 4,500 while a school was charged 4,800 — a price it never agreed
 * to.
 */
interface PlanBody {
  id: string;
  monthlyPricePerSeatXaf: number;
  aiSpeaking: { limit: number; window: string };
  examModule: boolean;
}

interface PlansBody {
  minSeats: number;
  plans: PlanBody[];
}

describe('PlansController contract', () => {
  let app: INestApplication<App>;

  const fetchPlans = async (): Promise<PlansBody> => {
    const response = await request(app.getHttpServer())
      .get('/api/plans')
      .expect(200);

    return response.body as PlansBody;
  };

  const planById = (body: PlansBody, id: string) =>
    body.plans.find((plan) => plan.id === id) as PlanBody &
      Record<string, unknown>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [PlansController],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('is public, because pricing is read before anyone has an account', async () => {
    const body = await fetchPlans();

    expect(body.plans.map((plan) => plan.id)).toEqual([
      'start',
      'pro',
      'premium',
    ]);
  });

  it('prices every plan from the constants the quote is built from', async () => {
    const body = await fetchPlans();

    expect(planById(body, 'start').monthlyPricePerSeatXaf).toBe(
      TIER_PRICES_XAF.START,
    );
    expect(planById(body, 'pro').monthlyPricePerSeatXaf).toBe(
      TIER_PRICES_XAF.PRO,
    );
    expect(planById(body, 'premium').monthlyPricePerSeatXaf).toBe(
      TIER_PRICES_XAF.PREMIUM,
    );
  });

  it('reports the AI allowance the quota service enforces, per 24 hours', async () => {
    const body = await fetchPlans();

    expect(planById(body, 'start').aiSpeaking).toEqual({
      limit: TIER_AI_ALLOWANCE.START,
      window: 'per_24h',
    });
    expect(planById(body, 'pro').aiSpeaking.limit).toBe(TIER_AI_ALLOWANCE.PRO);
    expect(planById(body, 'premium').aiSpeaking.limit).toBe(
      TIER_AI_ALLOWANCE.PREMIUM,
    );
  });

  it('marks the exam module from Pro up, matching the tier that guards it', async () => {
    const body = await fetchPlans();

    expect(planById(body, 'start').examModule).toBe(false);
    expect(planById(body, 'pro').examModule).toBe(true);
    expect(planById(body, 'premium').examModule).toBe(true);
  });

  it('states the seat minimum, so the frontend stops holding its own copy', async () => {
    const body = await fetchPlans();

    expect(body.minSeats).toBe(10);
  });

  it('carries no name or description: those are translations, not data', async () => {
    const body = await fetchPlans();

    expect(planById(body, 'start')).not.toHaveProperty('name');
    expect(planById(body, 'start')).not.toHaveProperty('description');
  });

  it('promises nothing that is not enforced yet: no annual discount, no full-AI flag', async () => {
    const body = await fetchPlans();

    // Annual billing waits on the subscription model (D4) and "AI in every
    // module" has no allowance behind it — AiOperation still has one value.
    // Advertising either would be a promise the backend cannot keep.
    expect(body).not.toHaveProperty('annualDiscountFactor');
    expect(planById(body, 'premium')).not.toHaveProperty('fullAiAllModules');
  });

  it('keeps it for a day, like the location list', async () => {
    const response = await request(app.getHttpServer()).get('/api/plans');

    expect(response.headers['cache-control']).toContain('public');
    expect(response.headers['cache-control']).toContain('max-age=86400');
  });
});
