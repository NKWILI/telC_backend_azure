import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AuthExceptionFilter } from './shared/filters/auth-exception.filter';
import { createGlobalValidationPipe } from './shared/pipes/global-validation.pipe';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // DigitalOcean App Platform (like most PaaS) puts this container behind a
  // single reverse proxy. Without this, Express req.ip — and every @Ip()
  // rate limiter — resolves to the proxy's address, identical for all clients,
  // collapsing per-IP limits into one shared global bucket. Trust exactly one
  // hop so req.ip reads the real client from X-Forwarded-For. Use 1 (not true)
  // so clients cannot spoof X-Forwarded-For to evade limits.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/static' });
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new AuthExceptionFilter());

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:5173'];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Lerniqo API')
    .setDescription(
      'REST API for the Lerniqo telC B1+ Beruf exam preparation platform.\n\n' +
        'Modules: **Auth**, **Center Authentication**, **Center Profile**, ' +
        '**Center Subscription**, ' +
        '**Writing (Schreiben)**, **Reading (Lesen)**, ' +
        '**Sprachbausteine**, **Listening (Hören)**, **Speaking (Sprechen)**, **Modelltests**.\n\n' +
        'Protected endpoints require the access token as `Authorization: Bearer <accessToken>`. ' +
        'Refresh tokens are single-use: after `POST /api/auth/refresh`, atomically replace both stored tokens with the returned pair. ' +
        'Use `POST /api/auth/logout` to revoke one device session immediately. Google authentication is currently disabled. ' +
        'Language centers are a separate identity: their accounts live under `/api/center-auth/*`, ' +
        'their tokens are issued and verified independently of student tokens, and neither kind is accepted ' +
        'on the other side. Center endpoints carry `deviceId`, cap a center at three active devices, ' +
        'and rotate refresh tokens single-use. `GET/PATCH /api/centers/me` requires a center access token. ' +
        'A center subscription status is derived from stored timestamps on every read rather than kept in a status ' +
        'column, so it is correct whether or not a scheduled job has run. Seats are counted from the students that ' +
        'carry a center id, so seat usage cannot drift from reality.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, document);

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
