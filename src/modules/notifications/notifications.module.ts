import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { EmailService } from './services/email.service';
import { NotifyService } from './services/notify.service';
import { SmsService } from './services/sms.service';

/** Outgoing email and SMS, sent in the background. */
@Module({
  imports: [SharedModule],
  providers: [EmailService, SmsService, NotifyService],
  exports: [NotifyService],
})
export class NotificationsModule {}
