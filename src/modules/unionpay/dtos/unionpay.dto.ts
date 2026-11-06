/* ------------------------------------------------------------------ */
/* Terraka (UnionPay card issuer) request and response shapes          */
/* ------------------------------------------------------------------ */

/** Card states /cardstatus takes and returns (cardStatusID). */
export enum CardStatus {
  TemporarilyBlocked = 1,
  Enabled = 2,
  PermanentlyBlocked = 3,
}

/** Outcome block on every Terraka answer. */
export interface TerrakaReplyDetails {
  isSuccess: boolean;
  errorCode?: string | number;
  errorComment?: string;
}

/** Every Terraka answer: replyDetails plus the call's own fields. */
export interface TerrakaRes {
  replyDetails?: TerrakaReplyDetails;
  // Some errors carry the code at the top level instead
  errorCode?: string | number;
  [key: string]: unknown;
}

export interface TerrakaTokenRes extends TerrakaRes {
  token?: string;
}

export interface TerrakaCardDetails {
  cardNumber?: string;
  dateExpiry?: string;
  cardStatusID?: CardStatus;
  cvv?: string;
  CVV?: string;
  [key: string]: unknown;
}

export interface CardDetailsRes extends TerrakaRes {
  cardDetails?: TerrakaCardDetails;
}

export interface CardBalanceRes extends TerrakaRes {
  balance?: number | string;
}

/** The CVV has been seen under each of these keys. */
export interface CardCvvRes extends CardDetailsRes {
  cvv?: string;
  CVV?: string;
  cardCvv?: string;
}

export interface CardReplaceRes extends TerrakaRes {
  // Alias of the replacement card; the old alias stops working
  cardAliasNew?: string;
}

export interface CardTransactionsRes extends TerrakaRes {
  transactions?: Record<string, unknown>[];
  count?: number;
}

export interface CardTransactionsQuery {
  fromDate?: string;
  toDate?: string;
  count?: number;
  page?: number;
}

/* ------------------------------------------------------------------ */
/* Webhooks Terraka posts to us (no auth)                              */
/* ------------------------------------------------------------------ */

/** Merchant block as Terraka sends it; mcc arrives as a number or a string. */
export interface TerrakaMerchant {
  name?: string;
  mcc?: number | string | null;
  localDateTime?: string;
  // ISO 3166-1 alpha-2 of the acquirer (OTP webhook only)
  country?: string;
}

/**
 * "Notification Feed Webhook": Terraka posts it when a cardholder transacts
 * (ISO 8583 processing code in type.code, response code in status.code).
 * Their schema and sample disagree on a few names, so both are accepted.
 */
export interface CardTransactionWebhook {
  cardAlias: string;
  callReference?: string;
  merchant?: TerrakaMerchant;
  // Name used before Terraka's published docs; still accepted
  merchantDetails?: TerrakaMerchant;
  transactionDetails?: {
    transactionAmount?: number;
    transactionCurrency?: string;
    transactionCurrencyCode?: string;
    settlementAmount?: number | null;
    settlementCurrencyCode?: string | null;
    settlementConversionRate?: number | null;
    maskedPan?: string | null;
    maskedPAN?: string | null;
    // e.g. { code: "00", description: "Authorisation" }; reversals start with "[Reversal]"
    type?: { code?: string; description?: string };
    // e.g. { code: "51", isSuccessful: false, reason: "Not sufficient funds" }
    status?: { code?: string; isSuccessful?: boolean; reason?: string };
  };
}

/**
 * "One-time pin webhook": the OTP that authorises a card payment, for the
 * cardholder. Only otp, cardholderAlias and cardAlias are always present.
 */
export interface CardOtpWebhook {
  otp: string;
  cardholderAlias: string;
  cardAlias: string;
  callReference?: string;
  comment?: string;
  merchant?: TerrakaMerchant;
  transactionDetails?: { txnAmount?: number; txnCurrency?: string };
}
