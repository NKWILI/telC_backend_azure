import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AuthExceptionFilter } from './shared/filters/auth-exception.filter';
import { createGlobalValidationPipe } from './shared/pipes/global-validation.pipe';

/** Used when ALLOWED_ORIGINS is unset. Never a wildcard — see `configureSecurity`. */
const DEVELOPMENT_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

/**
 * Everything the running application installs that decides whether a request
 * is safe.
 *
 * Its own module rather than inline in `main.ts`, so it can be tested.
 * `main.ts` ends in `void bootstrap()`, which means importing it to check what
 * it configures would start a server — and that is why nothing checked. The
 * gap was not cosmetic: every controller spec installs the validation pipe
 * itself, so deleting the one line that installs it in production would have
 * left the whole suite green while `forbidNonWhitelisted` quietly disappeared.
 * That option is the boundary every center DTO relies on to refuse a
 * client-supplied price.
 */
export function configureSecurity(app: NestExpressApplication): void {
  // DigitalOcean App Platform (like most PaaS) puts this container behind a
  // single reverse proxy. Without this, Express req.ip — and every @Ip()
  // rate limiter — resolves to the proxy's address, identical for all clients,
  // collapsing per-IP limits into one shared global bucket. Trust exactly one
  // hop so req.ip reads the real client from X-Forwarded-For. Use 1 (not true)
  // so clients cannot spoof X-Forwarded-For to evade limits.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new AuthExceptionFilter());

  // Listed origins only. A wildcard default would be the dangerous
  // convenience: combined with `credentials: true` it would let any site on
  // the internet make authenticated requests on a signed-in user's behalf.
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : DEVELOPMENT_ORIGINS;

  app.enableCors({ origin: allowedOrigins, credentials: true });
}
