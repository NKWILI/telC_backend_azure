import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AuthExceptionFilter } from './shared/filters/auth-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Azure App Service (and most PaaS) puts this container behind a single
  // reverse proxy. Without this, Express req.ip — and therefore every @Ip()
  // rate limiter — resolves to the proxy's address, identical for all clients,
  // collapsing per-IP limits into one shared global bucket. Trust exactly one
  // hop so req.ip reads the real client from X-Forwarded-For. Use 1 (not true)
  // so clients cannot spoof X-Forwarded-For to evade limits.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/static' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AuthExceptionFilter());

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:5173'];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('telC Backend API')
    .setDescription(
      'REST API for the telC B1+ Beruf exam preparation platform.\n\n' +
      'Modules: **Auth**, **Writing (Schreiben)**, **Reading (Lesen)**, ' +
      '**Sprachbausteine**, **Listening (Hören)**, **Speaking (Sprechen)**, **Modelltests**.\n\n' +
      'All protected endpoints require a Bearer JWT obtained from POST /api/auth/login.',
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
