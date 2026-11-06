import type {
  CardOtpWebhook,
  CardTransactionWebhook,
  TerrakaMerchant,
} from '../../unionpay/dtos/unionpay.dto';

// ISO 8583 response codes Terraka marks as successful
const SUCCESS_CODES = new Set(['00', '08', '10', '11', '16', '32']);
const REVERSAL_PREFIX = '[Reversal]';

export interface MerchantEvent {
  name: string | null;
  mcc: number | null;
  localDateTime?: string | null;
  country?: string | null;
}

/** card.transaction data, the same whatever spelling Terraka used. */
export interface CardTransactionEvent {
  cardReference: string;
  cardAlias: string;
  callReference: string | null;
  merchant: MerchantEvent;
  transactionDetails: {
    transactionAmount: number | null;
    transactionCurrencyCode: string | null;
    settlementAmount: number | null;
    settlementCurrencyCode: string | null;
    settlementConversionRate: number | null;
    maskedPan: string | null;
    type: {
      code: string | null;
      description: string | null;
      isReversal: boolean;
    };
    status: {
      code: string | null;
      isSuccessful: boolean;
      reason: string | null;
    };
  };
}

/** card.otp data: the code plus what it authorises, when Terraka says. */
export interface CardOtpEvent {
  cardReference: string;
  cardholderAlias: string;
  mobile: string | null;
  otp: string;
  callReference: string | null;
  merchant: MerchantEvent | null;
  transactionDetails: {
    transactionAmount: number | null;
    transactionCurrencyCode: string | null;
  } | null;
}

const str = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const num = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const merchantOf = (merchant?: TerrakaMerchant): MerchantEvent => ({
  name: str(merchant?.name),
  mcc: num(merchant?.mcc),
});

export function transactionEvent(
  body: CardTransactionWebhook,
  cardReference: string,
): CardTransactionEvent {
  const merchant = body.merchant ?? body.merchantDetails;
  const details = body.transactionDetails ?? {};
  const statusCode = str(details.status?.code);
  const description = str(details.type?.description);
  return {
    cardReference,
    cardAlias: body.cardAlias,
    callReference: str(body.callReference),
    merchant: {
      ...merchantOf(merchant),
      localDateTime: str(merchant?.localDateTime),
    },
    transactionDetails: {
      transactionAmount: num(details.transactionAmount),
      transactionCurrencyCode: str(
        details.transactionCurrencyCode ?? details.transactionCurrency,
      ),
      settlementAmount: num(details.settlementAmount),
      settlementCurrencyCode: str(details.settlementCurrencyCode),
      settlementConversionRate: num(details.settlementConversionRate),
      maskedPan: str(details.maskedPan ?? details.maskedPAN),
      type: {
        code: str(details.type?.code),
        description,
        isReversal: Boolean(description?.startsWith(REVERSAL_PREFIX)),
      },
      status: {
        code: statusCode,
        isSuccessful:
          typeof details.status?.isSuccessful === 'boolean'
            ? details.status.isSuccessful
            : SUCCESS_CODES.has(statusCode ?? ''),
        reason: str(details.status?.reason),
      },
    },
  };
}

export function otpEvent(
  body: CardOtpWebhook,
  card: { reference: string; holder: { mobile: string | null } },
): CardOtpEvent {
  const amount = num(body.transactionDetails?.txnAmount);
  const currency = str(body.transactionDetails?.txnCurrency);
  return {
    cardReference: card.reference,
    cardholderAlias: body.cardholderAlias,
    mobile: card.holder.mobile,
    otp: String(body.otp),
    callReference: str(body.callReference),
    merchant: body.merchant
      ? { ...merchantOf(body.merchant), country: str(body.merchant.country) }
      : null,
    transactionDetails:
      amount !== null || currency
        ? { transactionAmount: amount, transactionCurrencyCode: currency }
        : null,
  };
}

const money = (amount: number | null, currency: string | null) =>
  amount === null ? '' : `${currency ?? ''} ${amount}`.trim();

/** One line for the card's activity, e.g. "Authorisation KES 250 at Naivas: Approved". */
export function describeTransaction(event: CardTransactionEvent): string {
  const details = event.transactionDetails;
  const amount = money(
    details.transactionAmount,
    details.transactionCurrencyCode,
  );
  const where = event.merchant.name ? ` at ${event.merchant.name}` : '';
  const outcome =
    details.status.reason ??
    (details.status.isSuccessful ? 'Approved' : 'Declined');
  return `${details.type.description ?? 'Transaction'}${amount ? ` ${amount}` : ''}${where}: ${outcome}`;
}

/** Activity line for an OTP, without the code. */
export function describeOtp(event: CardOtpEvent): string {
  const amount = money(
    event.transactionDetails?.transactionAmount ?? null,
    event.transactionDetails?.transactionCurrencyCode ?? null,
  );
  const where = event.merchant?.name ? ` at ${event.merchant.name}` : '';
  return amount || where
    ? `One-time code sent to authorise${amount ? ` ${amount}` : ' a payment'}${where}`
    : 'One-time code sent';
}
