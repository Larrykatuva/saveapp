import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { AxiosRequestHeaders } from 'axios';
import {
  RequestContentType,
  RequestService,
} from '../../shared/services/request.service';

export interface SmsMessage {
  to: string;
  message: string;
}

interface AfricasTalkingRes {
  SMSMessageData?: {
    Message?: string;
    Recipients?: Array<{
      status?: string;
      statusCode?: number;
      number?: string;
    }>;
  };
}

/**
 * Text messages through Africa's Talking (the account ukonga-web uses).
 * Sending happens in the background; failures are logged, never thrown.
 * With no API key configured the message is only logged.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly requestService: RequestService,
  ) {}

  private env(key: string) {
    return this.configService.get<string>(key)?.trim() || undefined;
  }

  /** +2547XXXXXXXX, as Africa's Talking expects. */
  static international(phone: string) {
    const digits = phone.replace(/\D/g, '');
    if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
    if (/^[17]\d{8}$/.test(digits)) return `+254${digits}`;
    return `+${digits}`;
  }

  @OnEvent('notify.sms', { async: true })
  async send(sms: SmsMessage): Promise<void> {
    const username = this.env('AFRICASTALKING_USERNAME');
    const apiKey = this.env('AFRICASTALKING_API_KEY');
    const to = SmsService.international(sms.to);
    if (!username || !apiKey) {
      this.logger.warn(`SMS not configured; not sent to ${to}`);
      return;
    }
    const host =
      username === 'sandbox'
        ? 'https://api.sandbox.africastalking.com'
        : 'https://api.africastalking.com';
    const sender = this.env('AFRICASTALKING_SENDER_ID');
    try {
      const { data } = await this.requestService.postRequest<
        Record<string, string>,
        AfricasTalkingRes
      >(
        `${host}/version1/messaging`,
        {
          username,
          to,
          message: sms.message,
          ...(sender ? { from: sender } : {}),
        },
        RequestContentType.FORM_URLENCODED,
        undefined,
        {
          apiKey,
          Accept: 'application/json',
        } as unknown as AxiosRequestHeaders,
      );
      const recipient = data?.SMSMessageData?.Recipients?.[0];
      if (recipient?.status !== 'Success')
        this.logger.warn(
          `SMS to ${to} not accepted: ${recipient?.status ?? data?.SMSMessageData?.Message ?? 'no answer'}`,
        );
    } catch (error) {
      const response = (
        error as { getResponse?: () => unknown }
      ).getResponse?.();
      this.logger.error(
        `SMS to ${to} failed: ${typeof response === 'string' ? response : JSON.stringify(response ?? (error as Error).message)}`,
      );
    }
  }
}
