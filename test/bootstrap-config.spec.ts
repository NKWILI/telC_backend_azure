/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ValidationPipe } from '@nestjs/common';
import { configureSecurity } from '../src/bootstrap-config';
import { AuthExceptionFilter } from '../src/shared/filters/auth-exception.filter';

/**
 * What the running application installs, as opposed to what each test builds
 * for itself.
 *
 * Nothing covered this before, and that was a real hole rather than a tidiness
 * point: every controller spec calls `createGlobalValidationPipe()` itself, so
 * deleting the one line in `main.ts` that installs it would leave the whole
 * suite green while `forbidNonWhitelisted` — the boundary that stops a client
 * setting its own price — silently vanished from production.
 *
 * The configuration lives in its own module for exactly this reason: `main.ts`
 * ends in `void bootstrap()`, so importing it to test it would start a server.
 */
describe('the application security configuration', () => {
  const buildApp = () => ({
    set: jest.fn(),
    use: jest.fn(),
    useGlobalPipes: jest.fn(),
    useGlobalFilters: jest.fn(),
    enableCors: jest.fn(),
    useStaticAssets: jest.fn(),
  });

  let app: ReturnType<typeof buildApp>;
  const originalOrigins = process.env.ALLOWED_ORIGINS;

  beforeEach(() => {
    app = buildApp();
    delete process.env.ALLOWED_ORIGINS;
  });

  afterAll(() => {
    if (originalOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = originalOrigins;
  });

  describe('the validation pipe', () => {
    it('is installed globally', () => {
      configureSecurity(app as never);

      expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
      expect(app.useGlobalPipes.mock.calls[0][0]).toBeInstanceOf(
        ValidationPipe,
      );
    });

    /**
     * The property the whole phase rests on. Every DTO in the center module is
     * an allowlist, and it is only a boundary because an unknown property is
     * REFUSED rather than stripped: a client that sent `amountXaf` and got a
     * 201 would reasonably believe it had set the price.
     */
    it('refuses unknown properties rather than stripping them', () => {
      configureSecurity(app as never);

      const pipe = app.useGlobalPipes.mock.calls[0][0] as {
        validatorOptions?: Record<string, unknown>;
      };
      // Read off the pipe itself rather than re-reading the factory, so this
      // cannot pass by agreeing with a copy of the options.
      expect(pipe.validatorOptions).toMatchObject({
        whitelist: true,
        forbidNonWhitelisted: true,
      });
    });
  });

  it('installs the auth exception filter', () => {
    configureSecurity(app as never);

    expect(app.useGlobalFilters.mock.calls[0][0]).toBeInstanceOf(
      AuthExceptionFilter,
    );
  });

  describe('trust proxy', () => {
    it('trusts exactly one hop', () => {
      // Not `true`. Trusting every hop lets a client send its own
      // X-Forwarded-For and appear as any address it likes, which turns every
      // per-IP rate limit into a suggestion.
      configureSecurity(app as never);

      expect(app.set).toHaveBeenCalledWith('trust proxy', 1);
    });

    it('never trusts the whole chain', () => {
      configureSecurity(app as never);

      expect(app.set).not.toHaveBeenCalledWith('trust proxy', true);
    });
  });

  it('installs helmet', () => {
    configureSecurity(app as never);

    expect(app.use).toHaveBeenCalled();
  });

  describe('CORS', () => {
    it('reads the allowed origins from the environment', () => {
      process.env.ALLOWED_ORIGINS =
        'https://lerniqo.com, https://app.lerniqo.com';

      configureSecurity(app as never);

      expect(app.enableCors).toHaveBeenCalledWith({
        origin: ['https://lerniqo.com', 'https://app.lerniqo.com'],
        credentials: true,
      });
    });

    it('falls back to localhost rather than to everything', () => {
      // A wildcard default would be the dangerous convenience: with
      // `credentials: true` it would let any site on the internet make
      // authenticated requests on a user's behalf.
      configureSecurity(app as never);

      const { origin } = app.enableCors.mock.calls[0][0] as {
        origin: string[];
      };
      expect(origin).not.toContain('*');
      expect(origin.every((o) => o.startsWith('http://localhost'))).toBe(true);
    });
  });
});
