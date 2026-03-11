import * as Sentry from '@sentry/nestjs';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './modules/app.module';
import { getHelmetOptions } from './config/security-headers.config';

// Sentry must be initialized before NestFactory.create() to hook into Node.js error handlers
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || process.env.npm_package_version,
    // Source maps are uploaded via sentry-cli in CI (see SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT env vars)
    // This tells the SDK to look for them when symbolizing stack traces
    ...(process.env.NODE_ENV === 'production' && {
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
    }),
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers — must be first middleware applied (before CORS, prefix, pipes)
  app.use(helmet(getHelmetOptions(process.env.NODE_ENV)));

  // Global API prefix
  app.setGlobalPrefix('api/codeweaves/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger/OpenAPI documentation (disabled in production)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Codeweaves API')
      .setDescription('Codeweaves platform REST API documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Enable CORS for frontend
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  const logger = new Logger('Bootstrap');
  logger.log(`API running on http://localhost:${port}/api/codeweaves/v1`);
  logger.log(`Swagger docs at http://localhost:${port}/api/docs`);
}

bootstrap();
