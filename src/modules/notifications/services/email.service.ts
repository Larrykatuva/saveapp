import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MailerService } from '@nestjs-modules/mailer';
import type { Notification } from './notify.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly mailerService: MailerService) {}

  /**
   * Emails rendered from the Handlebars templates in /templates. Failures are
   * logged rather than thrown so a mail outage never breaks sign up; people
   * can ask for the code or invitation again.
   */
  @OnEvent('auth.email', { async: true })
  async send(payload: Notification): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: payload.email,
        subject: payload.subject,
        template: payload.template,
        context: payload.context,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send "${payload.subject}" to ${payload.email}: ${(error as Error).message}`,
      );
    }
  }
}
