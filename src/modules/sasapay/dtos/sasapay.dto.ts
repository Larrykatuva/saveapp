/* ------------------------------------------------------------------ */
/* SasaPay WaaS wire formats                                           */
/* https://docs.sasapay.app/docs/apis/waas/introduction                */
/* Field names and casing follow the docs' JSON samples, which are not */
/* always consistent with each other (TransactionDesc, checkoutRequestID) */
/* ------------------------------------------------------------------ */

export enum SasapayNetworkCode {
  SasaPay = '0',
  Mpesa = '63902',
  AirtelMoney = '63903',
  TKash = '63907',
}

export enum SasapayDocumentType {
  IdCard = '1',
  Passport = '2',
  AlienId = '3',
}

export enum SasapayDirectorDocumentType {
  IdNumber = 'ID_NUMBER',
  Passport = 'PASSPORT',
  AlienId = 'ALIEN_ID',
}

/** Status of a wallet right after onboarding or sub-wallet creation. */
export enum SasapayAccountStatus {
  // Verified; no KYC upload needed
  Active = 'ACTIVE',
  // KYC uploaded, review pending
  AwaitingApproval = 'AWAITING_APPROVAL',
  // KYC documents must be uploaded before the wallet is verified
  AwaitingKycUpload = 'AWAITING_KYC_UPLOAD',
}

/** Review outcome posted to the onboarding callback. */
export enum SasapayOnboardingOutcome {
  Approved = 'APPROVED',
  Rejected = 'REJECTED',
}

export enum SasapaySubWalletType {
  Personal = 'Personal',
  Business = 'Business',
}

export enum SasapayWalletPurpose {
  Collection = 'Collection',
  Disbursement = 'Disbursement',
  Remittance = 'Remittance',
}

/** Airtime service codes; bill service codes (e.g. SP-NRB-WATER) aren't listed. */
export enum SasapayAirtime {
  Safaricom = 'SP-SAFARICOM',
  Airtel = 'SP-AIRTEL',
  Telkom = 'SP-TELKOM',
}

/** A file on disk; RequestService streams it into the multipart body. */
export interface SasapayFile {
  path: string;
}

/** Wire payload minus what the client fills in (merchant code, callback). */
export type SasapayInput<T> = Omit<T, 'merchantCode' | 'callbackUrl'> & {
  callbackUrl?: string;
};

/* ------------------------------------------------------------------ */
/* Common response envelope                                            */
/* ------------------------------------------------------------------ */

/** "0" means success; see the Status Codes page (SP400, SP8000, …). */
export interface SasapayRes {
  status?: boolean;
  responseCode?: string;
  // Balance and a few other responses use statusCode instead
  statusCode?: string;
  message?: string;
  detail?: string;
}

/** Error body; DRF-style validation errors arrive as { field: [message] }. */
export interface SasapayErrorRes extends SasapayRes {
  [field: string]: unknown;
}

export interface SasapayLinks {
  next: string | null;
  previous: string | null;
}

export interface SasapayListRes<T> extends SasapayRes {
  data: T[];
}

export interface SasapayAuthRes extends SasapayRes {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

/* ------------------------------------------------------------------ */
/* Onboarding                                                          */
/* ------------------------------------------------------------------ */

export interface PersonalOnboardingPayload {
  merchantCode: string;
  firstName: string;
  middleName: string;
  lastName: string;
  countryCode: string;
  mobileNumber: string;
  documentType: SasapayDocumentType;
  documentNumber: string;
  email: string;
  callbackUrl: string;
}

export interface BusinessDirector {
  directorName: string;
  directorIdnumber: string;
  directorMobileNumber: string;
  directorKraPin: string;
  directorDocumentType: SasapayDirectorDocumentType;
  directorCountryCode: string;
}

/**
 * The docs table spells some fields differently (bankCode, Email, KraPin,
 * CallbackUrl); these follow the JSON sample.
 */
export interface BusinessOnboardingPayload {
  merchantCode: string;
  businessName: string;
  billNumber?: string;
  description: string;
  productType: number;
  countryId: number;
  subregionId: number;
  industryId: number;
  subIndustryId: number;
  bankId?: number;
  bankAccountNumber?: string;
  mobileNumber: string;
  businessTypeId: number;
  email: string;
  registrationNumber: string;
  kraPin: string;
  referralCode?: string;
  dealerNumber?: string;
  purpose: SasapayWalletPurpose;
  natureOfBusiness: string;
  physicalAddress: string;
  estimatedMonthlyTransactionAmount: number;
  estimatedMonthlyTransactionCount: number;
  callbackUrl: string;
  directors: BusinessDirector[];
}

/** First onboarding step: an OTP was texted to the mobile number. */
export interface OnboardingRes extends SasapayRes {
  requestId: string;
}

export interface OnboardingConfirmPayload {
  merchantCode: string;
  otp: string;
  requestId: string;
}

export interface SasapayAccount {
  requestId?: string;
  merchantCode: string;
  accountNumber: string;
  displayName: string;
  accountStatus: SasapayAccountStatus;
  accountBalance: number;
}

/** Onboarding confirmation and sub-wallet creation. */
export interface AccountRes extends SasapayRes {
  data: SasapayAccount;
}

export interface PersonalKycPayload {
  merchantCode: string;
  customerMobileNumber: string;
  passportSizePhoto: SasapayFile;
  documentImageFront: SasapayFile;
  documentImageBack: SasapayFile;
}

/**
 * Which documents each business type must send isn't documented. The
 * per-director array (directorsKyc) has no documented multipart encoding,
 * so only the top-level director files (marked deprecated) are sent.
 */
export interface BusinessKycPayload {
  merchantCode: string;
  requestId: string;
  businessKraPin?: SasapayFile;
  businessRegistrationCertificate?: SasapayFile;
  boardResolution?: SasapayFile;
  cr12Document?: SasapayFile;
  proofOfAddressDocument?: SasapayFile;
  proofOfBankDocument?: SasapayFile;
  directorKraPin?: SasapayFile;
  directorIdCardFront?: SasapayFile;
  directorIdCardBack?: SasapayFile;
}

/* ------------------------------------------------------------------ */
/* Customers and sub-wallets                                           */
/* ------------------------------------------------------------------ */

export interface CustomerWallet {
  client: { display_name: string };
  account_number: string;
  currency_code: string;
  description: string;
  account_balance_derived: string;
  account_type?: string;
}

export interface CustomersRes extends SasapayRes {
  links: SasapayLinks;
  count: number;
  pages: number;
  results: { customers: CustomerWallet[] };
  total_accounts_balance: string;
}

export interface CustomerDetailsPayload {
  merchantCode: string;
  accountNumber: string;
  countryCode: string;
}

export interface CustomerDetailsRes extends SasapayRes {
  data: {
    profile: {
      display_name: string;
      mobile_number: string;
      account_status: string;
    };
    CustomerWallets: CustomerWallet[];
    merchantCode: string;
  };
}

export interface CustomerUpdatePayload {
  merchantCode: string;
  accountNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  email?: string;
  documentType: SasapayDocumentType;
  documentNumber: string;
  callbackUrl: string;
}

export interface SubWalletPayload {
  merchantCode: string;
  // The customer's main wallet
  accountNumber: string;
  mobileNumber: string;
  subwalletType: SasapaySubWalletType;
  walletName: string;
  purpose: SasapayWalletPurpose;
  physicalAddress: string;
  natureOfBusiness: string;
  estimatedMonthlyTransactionAmount: string;
  estimatedMonthlyTransactionCount: string;
}

/* ------------------------------------------------------------------ */
/* Collections (request payment)                                       */
/* ------------------------------------------------------------------ */

export interface RequestPaymentPayload {
  merchantReference: string;
  merchantCode: string;
  networkCode: SasapayNetworkCode;
  mobileNumber: string;
  receiverAccountNumber: string;
  amount: string;
  transactionFee: string;
  commissionAccountNumber?: string;
  commissionAmount?: string;
  currencyCode: string;
  transactionDesc: string;
  callbackUrl: string;
}

export interface RequestPaymentRes extends SasapayRes {
  paymentGateway: string;
  checkoutRequestID: string;
  merchantReference: string;
  // Manual steps to pay from the phone
  customerMessage: string;
}

export interface ProcessPaymentPayload {
  merchantCode: string;
  receiverAccountNumber: string;
  checkoutRequestId: string;
  verificationCode: string;
}

/* ------------------------------------------------------------------ */
/* Payouts: send money, merchant transfers, pay bills                  */
/* ------------------------------------------------------------------ */

/** Customer wallet to mobile money or bank. */
export interface SendMoneyPayload {
  merchantCode: string;
  transactionReference: string;
  currencyCode: string;
  TransactionDesc: string;
  senderNumber: string;
  amount: string;
  reason?: string;
  chargeAccount: string;
  transactionFee: string;
  channel: string;
  receiverNumber: string;
  callbackUrl: string;
}

/** Merchant account to a customer wallet, mobile money or bank. */
export interface MerchantTransferPayload {
  merchantCode: string;
  transactionReference: string;
  currencyCode: string;
  TransactionDesc: string;
  // Numeric here, unlike the other payment payloads
  amount: number;
  reason?: string;
  channel: string;
  receiverNumber: string;
  callbackUrl: string;
}

/** Customer wallet to a paybill or till (Lipa). */
export interface PayBillPayload {
  merchantCode: string;
  transactionReference: string;
  currencyCode: string;
  amount: string;
  senderAccountNumber: string;
  receiverMerchantCode: string;
  accountReference: string;
  chargeAccount: string;
  transactionFee: string;
  billerType: string;
  networkCode: SasapayNetworkCode;
  callbackUrl: string;
  reason?: string;
}

/** Acknowledgement of send money, merchant transfers and pay bills. */
export interface PayoutRes extends SasapayRes {
  checkoutRequestId: string;
  merchantReference: string;
  transactionCharges: string;
  merchantFees?: string;
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

export interface UtilityPaymentPayload {
  transactionReference: string;
  merchantCode: string;
  serviceCode: string;
  payerAccountNumber: string;
  // Phone number for airtime
  accountNumber: string;
  currencyCode: string;
  amount: string;
  transactionFee: string;
  callbackUrl: string;
}

export interface UtilityPaymentRes extends SasapayRes {
  merchantReference: string;
  checkoutRequestId: string;
}

export interface BillQueryPayload {
  merchantCode: string;
  serviceCode: string;
  customerMobile: string;
  accountNumber: string;
}

export interface BillQueryRes extends SasapayRes {
  data: {
    accountNumber: string;
    serviceCode: string;
    dueDate: string;
    dueAmount: string;
    currency: string;
    customerName: string;
  };
}

/* ------------------------------------------------------------------ */
/* Transactions and balances                                           */
/* ------------------------------------------------------------------ */

/** merchantCode plus at least one of the references. */
export interface TransactionStatusPayload {
  merchantCode: string;
  checkoutRequestId?: string;
  merchantTransactionReference?: string;
  transactionCode?: string;
}

export interface TransactionStatusRes extends SasapayRes {
  data: {
    ResultCode: string;
    ResultDescription: string;
    TransactionType: string;
    TransactionDate: string;
    CheckoutRequestId: string;
    MerchantCode: string;
    MerchantReference: string;
    TransactionAmount: string;
    SourceChannel: string;
    DestinationChannel: string;
    TransactionCode: string;
    ThirdPartyTransactionCode: string;
    DestinationAccountNumber: string;
    DestinationAccountName: string;
    // Listed in the docs table (C2B) but missing from the B2C sample
    Paid?: boolean;
    AmountPaid?: string;
    PaidDate?: string;
  };
}

export interface StatementTransaction {
  id: number;
  merchant_code: string;
  transaction_amount: number;
  transaction_charges: number;
  // TRANSACTION IN / TRANSACTION OUT
  transaction_type: string;
  transaction_code: string;
  transaction_description: string;
  transaction_reference: string;
  transaction_date: string;
  payment_details: {
    party_B_account_number: string | null;
    party_B_account_name: string | null;
    channel_name: string | null;
    channel_transaction_reference: string | null;
  };
  result_code: string;
  result_description: string;
  reversal_status: string;
  created_date: string;
}

export interface StatementRes extends SasapayRes {
  links: SasapayLinks;
  count: number;
  current_page: number;
  pages: number;
  data: { transactions: StatementTransaction[] };
}

export interface MerchantBalanceRes extends SasapayRes {
  data: {
    CurrencyCode: string;
    OrgAccountBalance: number;
    // Working Account, Bulk Payment, Utility Account, Wallet as Service…
    Accounts: { account_label: string; account_balance: number }[];
  };
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export interface SasapayChannelCode {
  bank_name: string;
  bank_code: string;
}

export interface SasapayCountry {
  id: number;
  name: string;
  calling_code: string;
  country_code: string;
}

/** Sub-regions and business types. */
export interface SasapayNamedItem {
  id: number;
  name: string;
}

export interface SasapayIndustry {
  id: number;
  code_value: string;
}

export interface SasapaySubIndustry {
  id: number;
  sub_industry: string;
}

export interface SasapayProductType {
  id: number;
  name: string;
  description: string;
  currency_code: string;
}

/* ------------------------------------------------------------------ */
/* Callbacks posted by SasaPay (inbound)                               */
/* ------------------------------------------------------------------ */

/** Review outcome for personal/business onboarding and customer updates. */
export interface OnboardingCallback {
  merchantCode: string;
  displayName: string;
  accountNumber: string;
  accountStatus: SasapayOnboardingOutcome;
  description: string;
}

/** Result of a request payment. */
export interface RequestPaymentCallback {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  PaymentRequestID: string;
  ResultCode: string;
  ResultDesc: string;
  SourceChannel: string;
  TransAmount: string;
  BillRefNumber: string;
  TransactionDate: string;
  CustomerMobile: string;
  TransactionCode: string;
  ThirdPartyTransID: string;
}

/** Result of send money, merchant transfers and pay bills. */
export interface PayoutCallback {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  // A number in the merchant transfers sample, a string elsewhere
  ResultCode: string | number;
  ResultDesc: string;
  MerchantCode: string;
  TransactionAmount: string;
  TransactionCharge?: string;
  MerchantFees?: string;
  MerchantAccountBalance: string;
  MerchantTransactionReference: string;
  TransactionDate: string;
  RecipientAccountNumber: string;
  DestinationChannel: string;
  SourceChannel: string;
  SasaPayTransactionID: string;
  RecipientName: string;
  SenderAccountNumber: string;
}

/** Result of an airtime or bill payment. */
export interface UtilityCallback {
  ResultCode: string;
  ResultDesc: string;
  MerchantReference: string;
  CheckoutRequestId: string;
  MerchantCode: string;
  ServiceCode: string;
  NetworkCode: string;
  ContactNumber: string;
  SenderAccountNumber: string;
  AccountNumber: string;
  Amount: string;
  // KPLC tokens and printable airtime only
  Units?: string;
  Pin?: string;
  TransTime: string;
}
