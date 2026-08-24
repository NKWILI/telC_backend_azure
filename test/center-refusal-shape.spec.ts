/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { CenterExceptionFilter } from '../src/modules/centers/center-exception.filter';

/**
 * What a center actually receives after the filter has rewritten the error.
 *
 * The same lesson as `subscription-refusal-shape.spec`, learned in a different
 * filter: a refusal is only useful if the detail that makes it actionable
 * survives the rewrite. `requiredSeats` is the number a center has to send
 * next; without it "too few seats" leaves them guessing, and the whole reason
 * the two pricing floors carry distinct codes is lost.
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

  it('keeps requiredSeats on a seat-minimum refusal', () => {
    const { status, body } = sendThrough(
      new BadRequestException({
        message: 'SEATS_BELOW_MINIMUM',
        requiredSeats: 10,
      }),
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(body).toMatchObject({
      error: 'SEATS_BELOW_MINIMUM',
      requiredSeats: 10,
    });
  });

  it('keeps requiredSeats on a student-count refusal', () => {
    const { body } = sendThrough(
      new BadRequestException({
        message: 'SEATS_BELOW_STUDENT_COUNT',
        requiredSeats: 12,
      }),
    );

    expect(body).toMatchObject({
      error: 'SEATS_BELOW_STUDENT_COUNT',
      requiredSeats: 12,
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
        requiredSeats: 10,
        statusCode: 400,
      }),
    );

    expect(body.statusCode).toBeUndefined();
    expect(body.error).toBe('SEATS_BELOW_MINIMUM');
  });
});
