import { join } from 'path';
import { Injectable } from '@nestjs/common';
import {
  MailerModule,
  MailerOptions,
  MailerOptionsFactory,
} from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';

const TEMPLATES_DIR = join(process.cwd(), 'templates');

@Injectable()
class MailConfig implements MailerOptionsFactory {
  constructor(private configService: ConfigService) {}

  createMailerOptions(): Promise<MailerOptions> | MailerOptions {
    return {
      transport: {
        host: this.configService.get<string>('EMAIL_HOST'),
        port: Number(this.configService.get<string>('EMAIL_PORT') ?? 587),
        // Implicit TLS on 465; other ports upgrade with STARTTLS when offered
        secure: this.configService.get<string>('EMAIL_PORT') === '465',
        auth: {
          user: this.configService.get<string>('EMAIL_HOST_USER'),
          pass: this.configService.get<string>('EMAIL_HOST_PASSWORD'),
        },
      },
      defaults: {
        from: `"SaveApp" <${this.configService.get<string>(
          'DEFAULT_FROM_EMAIL',
        )}>`,
      },
      template: {
        dir: TEMPLATES_DIR,
        adapter: new HandlebarsAdapter(),
        options: {
          strict: true,
        },
      },
      options: {
        // Shared views (layout, code, button) usable as {{> name}} in any template
        partials: {
          dir: join(TEMPLATES_DIR, 'partials'),
          options: {
            strict: true,
          },
        },
        // Globals available in every template as {{@appName}}
        data: {
          appName: this.configService.get<string>('APP_NAME') ?? 'SaveApp',
        },
      },
    };
  }
}

export default MailerModule.forRootAsync({
  useClass: MailConfig,
});
