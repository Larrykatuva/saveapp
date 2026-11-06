import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BillQueryPayload,
  BillQueryRes,
  MerchantBalanceRes,
  MerchantTransferPayload,
  PayBillPayload,
  PayoutRes,
  ProcessPaymentPayload,
  RequestPaymentPayload,
  RequestPaymentRes,
  SasapayChannelCode,
  SasapayListRes,
  SasapayNetworkCode,
  SasapayRes,
  SendMoneyPayload,
  StatementRes,
  TransactionStatusPayload,
  TransactionStatusRes,
  UtilityPaymentPayload,
  UtilityPaymentRes,
} from '../dtos/sasapay.dto';
import { SasapayCallback, SasapayService } from './sasapay.service';

/**
 * Money movement on SasaPay WaaS:
 * - Collections: pay-ins to a customer's wallet (Request Payment). A SasaPay
 *   payer (network 0) gets a 6-digit code that processPayment submits;
 *   M-PESA, Airtel Money and T-Kash payers pay from their phone. Results go
 *   to the collections callback.
 * - Payouts: a customer's wallet or our merchant account to mobile money or
 *   a bank. `channel` is a code from channelCodes() (banks, or 63902 M-PESA,
 *   63903 Airtel, 63907 T-Kash). Results go only to the request's callback,
 *   never to the IPN url. transactionReference must be unique per payout.
 * - Wallet payments: paybills and tills (Lipa) to the payouts callback, and
 *   utilities (airtime, bills) to the utilities callback.
 * - Checks: transaction status, statements and our merchant balances. Use
 *   transactionStatus() before marking a payment final (see sasapayOutcome).
 */
@Injectable()
export class SasapayPaymentsService {
  constructor(private readonly sasapay: SasapayService) {}

  /* --------------------------- Collections --------------------------- */

  /**
   * Asks the payer to fund a wallet. merchantReference must be unique per
   * request; SasaPay answers SP4090 for a duplicate.
   */
  requestPayment(input: {
    merchantReference: string;
    networkCode: SasapayNetworkCode;
    mobileNumber: string;
    receiverAccountNumber: string;
    amount: number;
    transactionFee?: number;
    commissionAccountNumber?: string;
    commissionAmount?: number;
    currencyCode?: string;
    transactionDesc: string;
    callbackUrl?: string;
  }): Promise<RequestPaymentRes> {
    return this.sasapay.post<RequestPaymentPayload, RequestPaymentRes>(
      '/payments/request-payment/',
      {
        merchantReference: input.merchantReference,
        merchantCode: this.sasapay.merchantCode,
        networkCode: input.networkCode,
        mobileNumber: input.mobileNumber,
        receiverAccountNumber: input.receiverAccountNumber,
        amount: SasapayService.amount(input.amount),
        transactionFee: SasapayService.amount(input.transactionFee ?? 0),
        commissionAccountNumber: input.commissionAccountNumber,
        commissionAmount:
          input.commissionAmount === undefined
            ? undefined
            : SasapayService.amount(input.commissionAmount),
        currencyCode: input.currencyCode ?? 'KES',
        transactionDesc: input.transactionDesc,
        callbackUrl:
          input.callbackUrl ??
          this.sasapay.callbackUrl(SasapayCallback.Collections),
      },
    );
  }

  /** Submits the 6-digit code a SasaPay payer received. */
  processPayment(
    input: Omit<ProcessPaymentPayload, 'merchantCode'>,
  ): Promise<SasapayRes> {
    return this.sasapay.post<ProcessPaymentPayload, SasapayRes>(
      '/payments/process-payment/',
      { ...input, merchantCode: this.sasapay.merchantCode },
    );
  }

  /* ----------------------------- Payouts ----------------------------- */

  /** Sends money out of a customer's wallet. */
  sendMoney(input: {
    transactionReference: string;
    senderNumber: string;
    receiverNumber: string;
    channel: string;
    amount: number;
    transactionFee?: number;
    // Account charged the fees: ours or the customer's
    chargeAccount: string;
    transactionDesc: string;
    reason?: string;
    currencyCode?: string;
    callbackUrl?: string;
  }): Promise<PayoutRes> {
    return this.sasapay.post<SendMoneyPayload, PayoutRes>(
      '/payments/send-money/',
      {
        merchantCode: this.sasapay.merchantCode,
        transactionReference: input.transactionReference,
        currencyCode: input.currencyCode ?? 'KES',
        TransactionDesc: input.transactionDesc,
        senderNumber: input.senderNumber,
        amount: SasapayService.amount(input.amount),
        reason: input.reason,
        chargeAccount: input.chargeAccount,
        transactionFee: SasapayService.amount(input.transactionFee ?? 0),
        channel: input.channel,
        receiverNumber: input.receiverNumber,
        callbackUrl:
          input.callbackUrl ??
          this.sasapay.callbackUrl(SasapayCallback.Payouts),
      },
    );
  }

  /** Pays out of our merchant account. */
  merchantTransfer(input: {
    transactionReference: string;
    receiverNumber: string;
    channel: string;
    amount: number;
    transactionDesc: string;
    reason?: string;
    currencyCode?: string;
    callbackUrl?: string;
  }): Promise<PayoutRes> {
    return this.sasapay.post<MerchantTransferPayload, PayoutRes>(
      '/payments/merchant-transfers/',
      {
        merchantCode: this.sasapay.merchantCode,
        transactionReference: input.transactionReference,
        currencyCode: input.currencyCode ?? 'KES',
        TransactionDesc: input.transactionDesc,
        amount: Number(SasapayService.amount(input.amount)),
        reason: input.reason,
        channel: input.channel,
        receiverNumber: input.receiverNumber,
        callbackUrl:
          input.callbackUrl ??
          this.sasapay.callbackUrl(SasapayCallback.Payouts),
      },
    );
  }

  /** Banks and mobile money networks with the codes payouts use. */
  channelCodes(): Promise<SasapayListRes<SasapayChannelCode>> {
    return this.sasapay.get('/channel-codes/');
  }

  /* ------------------------- Wallet payments ------------------------- */

  /**
   * Pays a paybill or till from a customer's wallet.
   * TODO: only PAYBILL is documented for billerType; confirm the till value.
   */
  payBill(input: {
    transactionReference: string;
    senderAccountNumber: string;
    receiverMerchantCode: string;
    accountReference: string;
    networkCode: SasapayNetworkCode;
    amount: number;
    transactionFee?: number;
    chargeAccount: string;
    billerType?: string;
    reason?: string;
    currencyCode?: string;
    callbackUrl?: string;
  }): Promise<PayoutRes> {
    return this.sasapay.post<PayBillPayload, PayoutRes>(
      '/payments/pay-bills/',
      {
        merchantCode: this.sasapay.merchantCode,
        transactionReference: input.transactionReference,
        currencyCode: input.currencyCode ?? 'KES',
        amount: SasapayService.amount(input.amount),
        senderAccountNumber: input.senderAccountNumber,
        receiverMerchantCode: input.receiverMerchantCode,
        accountReference: input.accountReference,
        chargeAccount: input.chargeAccount,
        transactionFee: SasapayService.amount(input.transactionFee ?? 0),
        billerType: input.billerType ?? 'PAYBILL',
        networkCode: input.networkCode,
        callbackUrl:
          input.callbackUrl ??
          this.sasapay.callbackUrl(SasapayCallback.Payouts),
        reason: input.reason,
      },
    );
  }

  /** Buys airtime or pays a bill; serviceCode e.g. SasapayAirtime.Safaricom. */
  payUtility(input: {
    transactionReference: string;
    serviceCode: string;
    payerAccountNumber: string;
    accountNumber: string;
    amount: number;
    transactionFee?: number;
    currencyCode?: string;
    callbackUrl?: string;
  }): Promise<UtilityPaymentRes> {
    return this.sasapay.post<UtilityPaymentPayload, UtilityPaymentRes>(
      '/utilities/',
      {
        transactionReference: input.transactionReference,
        merchantCode: this.sasapay.merchantCode,
        serviceCode: input.serviceCode,
        payerAccountNumber: input.payerAccountNumber,
        accountNumber: input.accountNumber,
        currencyCode: input.currencyCode ?? 'KES',
        amount: SasapayService.amount(input.amount),
        transactionFee: SasapayService.amount(input.transactionFee ?? 0),
        callbackUrl:
          input.callbackUrl ??
          this.sasapay.callbackUrl(SasapayCallback.Utilities),
      },
    );
  }

  /**
   * Looks up a bill before paying it.
   * TODO: documented under /api/v1, not the WaaS path; confirm it accepts
   * the WaaS token.
   */
  billQuery(
    input: Omit<BillQueryPayload, 'merchantCode'>,
  ): Promise<BillQueryRes> {
    return this.sasapay.post<BillQueryPayload, BillQueryRes>(
      '/api/v1/utilities/bill-query/',
      { ...input, merchantCode: this.sasapay.merchantCode },
    );
  }

  /* ------------------------------ Checks ----------------------------- */

  /** Looks a transaction up by any of its references (answered at once). */
  transactionStatus(
    input: Omit<TransactionStatusPayload, 'merchantCode'>,
  ): Promise<TransactionStatusRes> {
    if (
      !input.checkoutRequestId &&
      !input.merchantTransactionReference &&
      !input.transactionCode
    )
      throw new BadRequestException(
        'A checkout request id, our reference or a transaction code is required',
      );
    return this.sasapay.post<TransactionStatusPayload, TransactionStatusRes>(
      '/transactions/status/',
      { ...input, merchantCode: this.sasapay.merchantCode },
    );
  }

  /**
   * Transactions on one account; pass links.next for the next page.
   * SasaPay only serves statements in production.
   */
  statement(accountNumber: string, link?: string): Promise<StatementRes> {
    if (link) return this.sasapay.followLink<StatementRes>(link);
    return this.sasapay.get<StatementRes>('/transactions/', {
      merchantCode: this.sasapay.merchantCode,
      accountNumber,
    });
  }

  /**
   * Balances of our merchant account by label (Working Account, Wallet as
   * Service, …).
   * TODO: the page links /merchant-balances/?merchantCode= but its API
   * explorer uses /payments/check-balance/?MerchantCode=; confirm which.
   */
  merchantBalance(): Promise<MerchantBalanceRes> {
    return this.sasapay.get<MerchantBalanceRes>('/merchant-balances/', {
      merchantCode: this.sasapay.merchantCode,
    });
  }
}
