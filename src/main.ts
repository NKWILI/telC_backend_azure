import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { APP_CREATE_OPTIONS, configureSecurity } from './bootstrap-config';

async function bootstrap() {
  // APP_CREATE_OPTIONS keeps each request's raw bytes, which payment webhook
  // signatures are computed over. See bootstrap-config.
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    APP_CREATE_OPTIONS,
  );
  // Trust proxy, helmet, the validation pipe, the auth filter and CORS. In
  // `bootstrap-config` so they can be tested without starting a server —
  // `void bootstrap()` below is why importing this file to check them cannot
  // work.
  configureSecurity(app);
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/static' });

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
        'Use `POST /api/auth/logout` to revoke one device session immediately. ' +
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
