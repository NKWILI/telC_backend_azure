/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { CenterExceptionFilter } from '../src/modules/centers/center-exception.filter';
import { PricingService } from '../src/modules/centers/pricing.service';

/**
 * What a center actually receives after the filter has rewritten the error.
 *
 * The same lesson as `subscription-refusal-shape.spec`, learned in a different
 * filter: a refusal is only useful if the detail that makes it actionable
 * survives the rewrite. The required-seat numbers are what a center has to
 * send next; without them "too few seats" leaves them guessing, and the whole
 * reason the two pricing floors carry distinct codes is lost.
 *
 * The last case sends a refusal built by the real `PricingService`, because
 * every case above it invents its payload — and a filter that carries invented
 * extras proves nothing about the ones the service actually raises.
 */
describe('the shape of a center refusal', () => {
  const sendThrough = (exception: unknown) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/centers/me/subscription/quote' }),
      }),
    } as unknown as ArgumentsHost;

    new CenterExceptionFilter().catch(exception, host);

    const body = json.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    return { status, body: body ?? {} };
  };

  it('keeps the required total on a seat-minimum refusal', () => {
    const { status, body } = sendThrough(
      new BadRequestException({
        message: 'SEATS_BELOW_MINIMUM',
        requiredSeatsTotal: 10,
      }),
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(body).toMatchObject({
      error: 'SEATS_BELOW_MINIMUM',
      requiredSeatsTotal: 10,
    });
  });

  it('keeps both numbers on a student-count refusal', () => {
    // Per-tier and total together. A center short in one tier is often also
    // short overall, and carrying one number sends it round twice.
    const { body } = sendThrough(
      new BadRequestException({
        message: 'SEATS_BELOW_STUDENT_COUNT',
        requiredSeatsPerTier: { START: 12 },
        requiredSeatsTotal: 14,
      }),
    );

    expect(body).toMatchObject({
      error: 'SEATS_BELOW_STUDENT_COUNT',
      requiredSeatsPerTier: { START: 12 },
      requiredSeatsTotal: 14,
    });
  });

  it('keeps the subscription status on a blocked-center refusal', () => {
    // CenterSubscriptionGuard attaches this for the same reason: a dashboard
    // that only knows "forbidden" cannot say what to fix.
    const { body } = sendThrough(
      new BadRequestException({
        message: 'SUBSCRIPTION_INACTIVE',
        subscriptionStatus: 'BLOCKED',
      }),
    );

    expect(body).toMatchObject({ subscriptionStatus: 'BLOCKED' });
  });

  it('still maps a plain string code to a human message', () => {
    const { body } = sendThrough(
      new BadRequestException('VERIFICATION_TOKEN_EXPIRED'),
    );

    expect(body.error).toBe('VERIFICATION_TOKEN_EXPIRED');
    expect(String(body.message)).toContain('expired');
  });

  it('still reports validation errors as an array', () => {
    const { body } = sendThrough(
      new BadRequestException({ message: ['seats must be an integer'] }),
    );

    expect(body).toMatchObject({
      error: 'VALIDATION_ERROR',
      message: ['seats must be an integer'],
    });
  });

  it('does not leak Nest internals into the body', () => {
    // Nest adds statusCode and error to some payloads. Echoing them back
    // would put two different "error" values in one response.
    const { body } = sendThrough(
      new BadRequestException({
        message: 'SEATS_BELOW_MINIMUM',
        requiredSeatsTotal: 10,
        statusCode: 400,
      }),
    );

    expect(body.statusCode).toBeUndefined();
    expect(body.error).toBe('SEATS_BELOW_MINIMUM');
  });
  it('carries a real PricingService refusal through intact', () => {
    // Not an invented payload. Whatever the service chooses to attach has to
    // reach the client, including fields added to the refusal later.
    const refusal = new PricingService().explain(
      { PRO: 1 },
      { PRO: { stampedPriceXaf: null, studentCount: 3 } },
    );

    const { body } = sendThrough(new PricingService().asException(refusal!));

    expect(body).toMatchObject({
      error: 'SEATS_BELOW_STUDENT_COUNT',
      requiredSeatsPerTier: { PRO: 3 },
      requiredSeatsTotal: 10,
    });
  });
});
