import { ValidationPipe } from '@nestjs/common';

/**
 * The global request-validation pipe, defined once so `main.ts` and every
 * end-to-end test configure the app identically.
 *
 * This exists because they did not. Tests build their app with
 * `createNestApplication()`, which never runs `main.ts`, so for a long time no
 * e2e suite had these pipes installed. That is not a cosmetic difference:
 * `transform: true` coerces query and route params *before* any
 * parameter-level pipe runs, which changes what handlers actually receive.
 *
 * It produced a real false pass. `lesen.e2e-spec.ts` asserted that
 * `?modelltest=abc` returned 400 and went green, while production returned 200
 * and served Modelltest 1 — because in production the value was coerced to NaN
 * and a `DefaultValuePipe` quietly substituted 1. The same bug was then found
 * in Sprachbausteine.
 *
 * Import this in every e2e suite:
 *
 *   app.useGlobalPipes(createGlobalValidationPipe());
 *
 * A test app without it is not testing this application.
 */
export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}
