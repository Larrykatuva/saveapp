import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmailTemplate } from '../../shared/constants/email-templates';

export interface Notification {
  email: string;
  subject: string;
  template: EmailTemplate;
  context: Record<string, unknown>;
}

/**
 * Queues notification emails (rendered from /templates by EmailService).
 * Sending happens in the background and never fails the caller.
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {}

  /** Absolute link into the portals, e.g. url('/auth/login'). */
  url(path: string): string {
    const base =
      this.configService.get<string>('APP_URL') ??
      `http://localhost:${this.configService.get<string>('PORT') ?? 3000}`;
    return `${base.replace(/\/+$/, '')}${path}`;
  }

  /** Queues a text message (Africa's Talking, see SmsService). */
  sms(to: string, message: string): void {
    if (!to) return;
    this.logger.log(`SMS ${to.replace(/\d(?=\d{3})/g, '•')}`);
    this.eventEmitter.emit('notify.sms', { to, message });
  }

  email(notification: Notification): void {
    if (!notification.email) return;
    this.logger.log(`Notify ${notification.email}: ${notification.subject}`);
    this.eventEmitter.emit('auth.email', notification);
  }
}
