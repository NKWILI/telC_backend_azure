/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ArgumentsHost, ForbiddenException } from '@nestjs/common';
import { AuthExceptionFilter } from '../src/shared/filters/auth-exception.filter';

/**
 * The refusal a client actually receives, after the global filter has had it.
 *
 * `subscriptionStatus` is what lets an app say "your school stopped paying"
 * and offer a way to carry on, instead of showing an error it cannot explain.
 * The filter rewrites error bodies and, on one branch, drops fields it does
 * not recognise — so whether that field survives is a property of the filter,
 * not of the guard that threw.
 */
describe('the shape of a subscription refusal', () => {
  const refusal = () =>
    new ForbiddenException({
      message: 'SUBSCRIPTION_INACTIVE',
      subscriptionStatus: 'BLOCKED',
    });

  const sendThrough = (url: string, exception: unknown) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url }),
      }),
    } as unknown as ArgumentsHost;

    new AuthExceptionFilter().catch(exception, host);

    return { status, body: json.mock.calls[0]?.[0] as Record<string, unknown> };
  };

  it('keeps the status on a learning route, where every guarded route lives', () => {
    const { status, body } = sendThrough('/api/reading/exercise', refusal());

    expect(status).toHaveBeenCalledWith(403);
    expect(body).toMatchObject({
      message: 'SUBSCRIPTION_INACTIVE',
      subscriptionStatus: 'BLOCKED',
    });
  });

  it('keeps it on the speaking room route too', () => {
    const { body } = sendThrough('/api/speaking/rooms', refusal());

    expect(body).toMatchObject({ subscriptionStatus: 'BLOCKED' });
  });

  it('keeps it on the center routes the provisioning guard protects', () => {
    const { body } = sendThrough('/api/centers/me/students', refusal());

    expect(body).toMatchObject({ subscriptionStatus: 'BLOCKED' });
  });

  /**
   * The trap, pinned rather than described.
   *
   * On /api/auth/* the filter rebuilds the body from `message` alone and drops
   * everything else. No guarded route lives there today, and auth deliberately
   * stays reachable while blocked — but the day someone protects an auth route,
   * this test is what tells them the status will vanish silently rather than
   * letting a client quietly lose the field.
   */
  it('drops it on an auth route, which is why no guarded route may live there', () => {
    const { status, body } = sendThrough('/api/auth/profile', refusal());

    expect(status).toHaveBeenCalledWith(403);
    expect(body).toMatchObject({ error: 'SUBSCRIPTION_INACTIVE' });
    expect(body).not.toHaveProperty('subscriptionStatus');
  });
});
