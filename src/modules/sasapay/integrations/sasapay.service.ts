import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosRequestHeaders } from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  RequestContentType,
  RequestService,
} from '../../shared/services/request.service';
import {
  SasapayAuthRes,
  SasapayErrorRes,
  SasapayRes,
} from '../dtos/sasapay.dto';

export const SASAPAY_SANDBOX_URL = 'https://sandbox.sasapay.app';
// Every WaaS endpoint sits under this path, on sandbox and on api.sasapay.app
const WAAS_PATH = '/api/v2/waas';

/** Code on SasapayError when SasaPay gave no answer at all. */
export const SASAPAY_NETWORK_ERROR = 'NETWORK';

/** SasaPay rejected the request; carries its responseCode and message. */
export class SasapayError extends BadRequestException {
  constructor(
    public readonly responseCode: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

/**
 * No answer from SasaPay (network or timeout). A payment may still have
 * gone through, so check its status before sending it again.
 */
export const isSasapayUnreachable = (error: unknown) =>
  error instanceof SasapayError && error.responseCode === SASAPAY_NETWORK_ERROR;

/** Paths appended to SASAPAY_CALLBACK_URL, one per callback shape. */
export enum SasapayCallback {
  Onboarding = 'onboarding',
  Collections = 'collections',
  Payouts = 'payouts',
  Utilities = 'utilities',
}

// Result codes from https://docs.sasapay.app/docs/apis/results-codes
const SUCCESS_CODES = ['0', 'SP00000'];
// Still processing, ambiguous (Airtel), timed out or not found yet: re-check
const PENDING_CODES = [
  'PENDING',
  'SP01001',
  'SP01004',
  'DP00900001000',
  'SP.504.000',
  '404',
];

export type SasapayOutcome = 'success' | 'pending' | 'failed';

/** Maps a callback or status ResultCode to success, pending or failed. */
export const sasapayOutcome = (
  code: string | number | undefined,
): SasapayOutcome => {
  const value = String(code ?? '').trim();
  if (SUCCESS_CODES.includes(value)) return 'success';
  if (!value || PENDING_CODES.includes(value)) return 'pending';
  return 'failed';
};

type Query = Record<string, string | number | undefined>;

/**
 * Base client for SasaPay Wallet as a Service
 * (https://docs.sasapay.app/docs/apis/waas/introduction): config, the OAuth
 * token, transport and error mapping, and callback checks. The area
 * services in this folder call SasaPay through it. This class only speaks
 * SasaPay; persistence lives elsewhere.
 */
@Injectable()
export class SasapayService {
  private readonly logger = new Logger(SasapayService.name);
  private token?: { value: string; expiresAt: number };
  private tokenRequest?: Promise<string>;

  constructor(
    private readonly configService: ConfigService,
    private readonly requestService: RequestService,
  ) {}

  /* ---------------------------- Config ---------------------------- */

  private env(key: string): string | undefined {
    const value = this.configService.get<string>(key);
    return value?.trim() ? value.trim() : undefined;
  }

  private required(key: string): string {
    const value = this.env(key);
    if (!value)
      throw new ServiceUnavailableException(
        `SasaPay is not configured: set ${key}`,
      );
    return value;
  }

  get configured(): boolean {
    return Boolean(
      this.env('SASAPAY_CLIENT_ID') &&
      this.env('SASAPAY_CLIENT_SECRET') &&
      this.env('SASAPAY_MERCHANT_CODE'),
    );
  }

  /** Sandbox unless SASAPAY_BASE_URL is set (https://api.sasapay.app live). */
  private get host(): string {
    return (this.env('SASAPAY_BASE_URL') ?? SASAPAY_SANDBOX_URL).replace(
      /\/$/,
      '',
    );
  }

  /** Our WaaS merchant code, sent on every request. */
  get merchantCode(): string {
    return this.required('SASAPAY_MERCHANT_CODE');
  }

  /** Where SasaPay posts one kind of result: SASAPAY_CALLBACK_URL/<path>. */
  callbackUrl(path: SasapayCallback): string {
    return `${this.required('SASAPAY_CALLBACK_URL').replace(/\/$/, '')}/${path}`;
  }

  /** Amounts go over the wire as strings with two decimals ("100.00"). */
  static amount(value: number): string {
    if (!Number.isFinite(value) || value < 0)
      throw new BadRequestException('Enter a valid amount');
    return value.toFixed(2);
  }

  /* ------------------------- Credentials --------------------------- */

  /** OAuth token, cached until a minute before expiry; one fetch at a time. */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt)
      return this.token.value;
    this.tokenRequest ??= this.fetchToken().finally(() => {
      this.tokenRequest = undefined;
    });
    return this.tokenRequest;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(
      `${this.required('SASAPAY_CLIENT_ID')}:${this.required('SASAPAY_CLIENT_SECRET')}`,
    ).toString('base64');
    const data = await this.call(
      () =>
        this.requestService.getRequest<SasapayAuthRes>(
          this.url('/auth/token/', { grant_type: 'client_credentials' }),
          undefined,
          { Authorization: `Basic ${basic}` } as AxiosRequestHeaders,
        ),
      2,
    );
    const ttl = Math.max(60, Number(data.expires_in) || 3600);
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + (ttl - 60) * 1000,
    };
    return data.access_token;
  }

  /* -------------------------- Transport ---------------------------- */

  /**
   * WaaS paths are relative to /api/v2/waas; a path starting with /api/ is
   * used as-is (bill query lives under /api/v1).
   */
  private url(path: string, query?: Query): string {
    const base = path.startsWith('/api/')
      ? this.host
      : `${this.host}${WAAS_PATH}`;
    const params = new URLSearchParams();
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value));
    });
    const search = params.toString();
    return `${base}${path}${search ? `?${search}` : ''}`;
  }

  /**
   * Runs a request and turns SasaPay's failures into SasapayError: error
   * bodies, and 200s that carry status false or a non-zero code. Only
   * idempotent calls pass retries.
   */
  private async call<R>(
    request: () => Promise<{ data: R }>,
    retries = 0,
  ): Promise<R> {
    let data: R;
    try {
      ({ data } = await request());
    } catch (error) {
      const unreachable =
        error instanceof HttpException &&
        error.getResponse() === 'An error occurred while making the request';
      if (unreachable && retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return this.call(request, retries - 1);
      }
      if (unreachable) {
        this.logger.warn('SasaPay could not be reached (network or timeout)');
        throw new SasapayError(
          SASAPAY_NETWORK_ERROR,
          'No answer from SasaPay (network or timeout). If this moved money, check its status before trying again.',
        );
      }
      if (error instanceof HttpException)
        throw this.rejected(error.getResponse());
      throw error;
    }
    if (this.failed(data)) throw this.rejected(data);
    return data;
  }

  private failed(body: unknown): boolean {
    if (!body || typeof body !== 'object') return false;
    const { status, responseCode, statusCode } = body as SasapayRes;
    const code = responseCode ?? statusCode;
    return (
      String(status) === 'false' ||
      (code !== undefined && code !== null && String(code) !== '0')
    );
  }

  private rejected(body: unknown): SasapayError {
    const details: SasapayErrorRes =
      body && typeof body === 'object'
        ? (body as SasapayErrorRes)
        : { message: typeof body === 'string' ? body.slice(0, 200) : '' };
    const code = details.responseCode ?? details.statusCode;
    const message =
      details.message ||
      details.detail ||
      this.fieldError(details) ||
      'SasaPay rejected the request';
    // A rejected token: fetch a fresh one on the next call
    if (code === 'SP4010' || code === 'SP.401.000') this.token = undefined;
    this.logger.warn(`SasaPay error ${code ?? ''}: ${message}`);
    return new SasapayError(code, message);
  }

  /** DRF-style validation body { field: ['message'] } → "field: message". */
  private fieldError(body: SasapayErrorRes): string | undefined {
    const entry = Object.entries(body).find(
      ([, value]) => Array.isArray(value) && value.length > 0,
    );
    return entry
      ? `${entry[0]}: ${String((entry[1] as unknown[])[0])}`
      : undefined;
  }

  /** GET; safe to repeat, so it retries once on a network failure. */
  async get<R>(path: string, query?: Query): Promise<R> {
    const token = await this.accessToken();
    return this.call(
      () => this.requestService.getRequest<R>(this.url(path, query), token),
      1,
    );
  }

  /** JSON POST. Never retried here: it may move money. */
  async post<P, R>(path: string, payload: P): Promise<R> {
    const token = await this.accessToken();
    return this.call(() =>
      this.requestService.postRequest<P, R>(
        this.url(path),
        payload,
        RequestContentType.JSON,
        token,
      ),
    );
  }

  /** Multipart POST for KYC uploads; unset fields are left out. */
  async postForm<P extends object, R>(path: string, payload: P): Promise<R> {
    const token = await this.accessToken();
    const fields = Object.fromEntries(
      Object.entries(payload).filter(
        ([, value]) => value !== undefined && value !== null,
      ),
    );
    return this.call(() =>
      this.requestService.postRequest<Record<string, unknown>, R>(
        this.url(path),
        fields,
        RequestContentType.FORM_DATA,
        token,
      ),
    );
  }

  /** Fetches a pagination link (links.next / links.previous) of a list. */
  async followLink<R>(link: string): Promise<R> {
    // Our token only ever goes back to SasaPay's own host
    if (new URL(link).origin !== new URL(this.host).origin)
      throw new BadRequestException('Not a SasaPay link');
    const token = await this.accessToken();
    return this.call(() => this.requestService.getRequest<R>(link, token), 1);
  }

  /* --------------------------- Callbacks --------------------------- */

  /** True when a callback came from one of SasaPay's published addresses. */
  isCallbackIp(ip: string | undefined): boolean {
    return this.callbackIps.includes((ip ?? '').replace(/^::ffff:/, ''));
  }

  /**
   * Addresses SasaPay posts callbacks from (Callback Security page), kept in
   * SASAPAY_CALLBACK_IPS as a comma-separated list.
   */
  private get callbackIps(): string[] {
    return this.required('SASAPAY_CALLBACK_IPS')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);
  }

  /**
   * Checks the X-SasaPay-Signature header: hex HMAC-SHA512, keyed with our
   * client id, of `transactionCode-merchantCode-accountNumber-paymentReference-amount`.
   * TODO: the docs name these fields in snake_case (sasapay_transaction_code,
   * payment_reference, …) but WaaS callbacks are PascalCase, so the caller
   * maps them; confirm the WaaS mapping with SasaPay.
   */
  isSignatureValid(
    signature: string | undefined,
    parts: {
      transactionCode: string;
      merchantCode: string;
      accountNumber: string;
      paymentReference: string;
      amount: string;
    },
  ): boolean {
    if (!signature || !/^[0-9a-f]+$/i.test(signature)) return false;
    const message = [
      parts.transactionCode,
      parts.merchantCode,
      parts.accountNumber,
      parts.paymentReference,
      parts.amount,
    ].join('-');
    const expected = createHmac('sha512', this.required('SASAPAY_CLIENT_ID'))
      .update(message, 'utf8')
      .digest();
    const given = Buffer.from(signature, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
