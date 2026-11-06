import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosRequestHeaders } from 'axios';
import {
  RequestContentType,
  RequestService,
} from '../../shared/services/request.service';
import {
  CardBalanceRes,
  CardCvvRes,
  CardDetailsRes,
  CardReplaceRes,
  CardStatus,
  CardTransactionsQuery,
  CardTransactionsRes,
  TerrakaRes,
  TerrakaTokenRes,
} from '../dtos/unionpay.dto';

// Terraka's code for an invalid or expired token
const TOKEN_REJECTED_CODE = '65';

// How long a Terraka token is reused before a new one is fetched
const TOKEN_TTL_MS = 60_000;

// What RequestService throws when the request got no answer at all
const NO_ANSWER = 'An error occurred while making the request';

type Query = Record<string, string | number>;
type Send = (headers: AxiosRequestHeaders) => Promise<{ data: unknown }>;

/**
 * Client for Terraka, the UnionPay card issuer (ported from ukonga-web's
 * TerrakaService):
 * - Cardholders: add one by mobile number, look one up
 * - Cards: create, block/enable, replace, details, status, balance, CVV
 * - Funds: load (confirmed with the OTP Terraka texts) and unload
 * - Card transactions and a server echo
 *
 * Answers are returned as Terraka sends them; callers check
 * replyDetails.isSuccess and show replyDetails.errorComment. Requests go
 * through the shared RequestService.
 */
@Injectable()
export class UnionpayService {
  private readonly logger = new Logger(UnionpayService.name);
  private token?: { value: Promise<string>; expiresAt: number };

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
        `Terraka is not configured: set ${key}`,
      );
    return value;
  }

  get configured(): boolean {
    return Boolean(
      this.env('TERRAKA_CLIENT_KEY') && this.env('TERRAKA_CLIENT_SECRET'),
    );
  }

  /** Test or live host; the keys in .env decide which. */
  private get baseUrl(): string {
    return this.configService.get('TERRAKA_BASE_URL') as string;
  }

  private get credentials(): { clientKey: string; secretKey: string } {
    return {
      clientKey: this.required('TERRAKA_CLIENT_KEY'),
      secretKey: this.required('TERRAKA_CLIENT_SECRET'),
    };
  }

  /* ------------------------- Authentication ------------------------ */

  /**
   * Token shared by every call for a minute. Calls that arrive together share
   * one /token request, so they don't supersede each other's token.
   */
  private accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt)
      return this.token.value;

    const value = this.issueToken();
    this.token = { value, expiresAt: Date.now() + TOKEN_TTL_MS };
    // A failed /token call must not stay cached
    value.catch(() => this.dropToken(value));
    return value;
  }

  /** Forgets the cached token, unless a newer one has already replaced it. */
  private dropToken(value: Promise<string>): void {
    if (this.token?.value === value) this.token = undefined;
  }

  private async issueToken(): Promise<string> {
    const data = await this.post<TerrakaTokenRes>(
      '/token',
      this.credentials,
      false,
    );
    if (!data.token)
      throw new BadGatewayException(
        'Terraka authentication failed: no token in response',
      );
    return data.token;
  }

  /**
   * Terraka signals an invalid or expired token as error code 65 in the body
   * (often with HTTP 200).
   */
  private static tokenRejected(data: unknown): boolean {
    const answer = data as TerrakaRes | undefined;
    const code = answer?.replyDetails?.errorCode ?? answer?.errorCode;
    return String(code) === TOKEN_REJECTED_CODE;
  }

  /* ---------------------------- Requests --------------------------- */

  /**
   * Runs a RequestService call against Terraka and returns its JSON answer,
   * also when it comes with an error status. On a rejected token (error 65)
   * the call runs once more with a new token.
   */
  private async request<R extends TerrakaRes>(
    send: Send,
    authenticated = true,
    retry = true,
  ): Promise<R> {
    const token = authenticated ? this.accessToken() : undefined;
    const headers = (
      token ? { 'X-Terraka-Bearer': await token } : {}
    ) as AxiosRequestHeaders;

    let data: unknown;
    try {
      ({ data } = await send(headers));
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      if (error.getResponse() === NO_ANSWER) {
        this.logger.warn('Terraka could not be reached (network or timeout)');
        throw new BadGatewayException(
          'Terraka could not be reached (network or timeout)',
        );
      }
      // Error status: Terraka's verdict is still in the body
      data = error.getResponse();
    }

    // Token rejected: drop it and retry once with a freshly issued token
    if (token && retry && UnionpayService.tokenRejected(data)) {
      this.dropToken(token);
      return this.request<R>(send, authenticated, false);
    }

    if (typeof data !== 'object' || data === null)
      throw new BadGatewayException(
        `Terraka returned non-JSON: ${String(data)}`,
      );
    return data as R;
  }

  private url(path: string, query?: Query): string {
    const search = query
      ? `?${new URLSearchParams(
          Object.entries(query).map(([key, value]) => [key, String(value)]),
        ).toString()}`
      : '';
    return `${this.baseUrl}${path}${search}`;
  }

  private get<R extends TerrakaRes>(path: string, query: Query): Promise<R> {
    return this.request<R>((headers) =>
      this.requestService.getRequest(this.url(path, query), undefined, headers),
    );
  }

  private post<R extends TerrakaRes>(
    path: string,
    body: object,
    authenticated = true,
  ): Promise<R> {
    return this.request<R>(
      (headers) =>
        this.requestService.postRequest(
          this.url(path),
          body,
          RequestContentType.JSON,
          undefined,
          headers,
        ),
      authenticated,
    );
  }

  private put<R extends TerrakaRes>(path: string, body: object): Promise<R> {
    return this.request<R>((headers) =>
      this.requestService.putRequest(
        this.url(path),
        body,
        RequestContentType.JSON,
        undefined,
        headers,
      ),
    );
  }

  /* --------------------------- Cardholders -------------------------- */

  addCardHolder(mobile: string): Promise<TerrakaRes> {
    return this.post('/cardholder', { mobile });
  }

  getCardHolder(cardholderAlias: string): Promise<TerrakaRes> {
    return this.get('/cardholder', { cardholderAlias });
  }

  /* ---------------------- Cards: create & manage --------------------- */

  createCard(cardholderAlias: string): Promise<TerrakaRes> {
    return this.post('/card', { cardholderAlias });
  }

  setCardStatus(
    cardAlias: string,
    status: CardStatus,
    reason: string,
  ): Promise<TerrakaRes> {
    return this.put('/cardstatus', { cardAlias, cardStatusID: status, reason });
  }

  /** Issues a new card; the answer's cardAliasNew replaces the old alias. */
  replaceCard(cardAlias: string, reason: string): Promise<CardReplaceRes> {
    return this.put('/cardreplace', { cardAlias, reason });
  }

  /* -------------------------- Cards: details ------------------------- */

  getCardDetails(cardAlias: string): Promise<CardDetailsRes> {
    return this.get('/card', { cardAlias });
  }

  getCardStatus(cardAlias: string): Promise<CardDetailsRes> {
    return this.get('/cardstatus', { cardAlias });
  }

  getCardBalance(cardAlias: string): Promise<CardBalanceRes> {
    return this.get('/cardbalance', { cardAlias });
  }

  getCardCvv(cardAlias: string): Promise<CardCvvRes> {
    return this.get('/cardcvv', { cardAlias });
  }

  /* ------------------------------ Funds ------------------------------ */

  /** Step 1 of loading a card; Terraka texts the cardholder an OTP. */
  creditCard(cardAlias: string, amount: number): Promise<TerrakaRes> {
    return this.post('/cardload', { cardAlias, amount });
  }

  /**
   * Step 2 of loading a card: confirm with the OTP Terraka sent.
   * TODO: verify the exact endpoint name once Starter Pack credentials arrive.
   */
  confirmCreditCard(
    cardAlias: string,
    amount: number,
    otp: string,
  ): Promise<TerrakaRes> {
    return this.post('/cardloaddotp', { cardAlias, amount, otp });
  }

  debitCard(cardAlias: string, amount: number): Promise<TerrakaRes> {
    return this.post('/cardunload', { cardAlias, amount });
  }

  /* --------------------------- Transactions -------------------------- */

  getCardTransactions(
    cardAlias: string,
    filters: CardTransactionsQuery = {},
  ): Promise<CardTransactionsRes> {
    const query: Query = { cardAlias };
    if (filters.fromDate) query.fromDate = filters.fromDate;
    if (filters.toDate) query.toDate = filters.toDate;
    if (filters.count) query.transactionCount = filters.count;
    if (filters.page) query.pageNumber = filters.page;
    return this.get('/cardtx', query);
  }

  /* ----------------------------- Utilities --------------------------- */

  checkServerStatus(): Promise<TerrakaRes> {
    return this.get('/echo', { echoText: 'Server_Status', ppid: 1 });
  }
}
