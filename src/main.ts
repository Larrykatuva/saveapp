import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import configureViews from './configs/views.config';
import configureSession from './configs/session.config';
import SwaggerConfig from './configs/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Handlebars views and static assets (static files are served before the
  // session middleware, so they never create sessions)
  configureViews(app);

  // Session auth, CSRF protection and flash messages for the portals
  await configureSession(app);

  // Merchant API documentation (the portals are excluded)
  const document = SwaggerModule.createDocument(app, SwaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/json',
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
