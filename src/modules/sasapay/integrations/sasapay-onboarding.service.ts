import { Injectable } from '@nestjs/common';
import {
  AccountRes,
  BusinessKycPayload,
  BusinessOnboardingPayload,
  CustomerDetailsPayload,
  CustomerDetailsRes,
  CustomersRes,
  CustomerUpdatePayload,
  OnboardingConfirmPayload,
  OnboardingRes,
  PersonalKycPayload,
  PersonalOnboardingPayload,
  SasapayCountry,
  SasapayIndustry,
  SasapayInput,
  SasapayListRes,
  SasapayNamedItem,
  SasapayProductType,
  SasapayRes,
  SasapaySubIndustry,
  SubWalletPayload,
} from '../dtos/sasapay.dto';
import { SasapayCallback, SasapayService } from './sasapay.service';

/**
 * Customers and their wallets on SasaPay WaaS:
 * - Personal and business onboarding. The first POST texts an OTP and
 *   returns a requestId; confirming with that OTP opens the wallet, then KYC
 *   documents follow. The review outcome (APPROVED / REJECTED) is posted to
 *   the onboarding callback.
 * - Customer wallets and details, amending a rejected customer, and the one
 *   sub-wallet each customer may hold besides the main wallet.
 * - Reference lists business onboarding needs (countries, sub-regions,
 *   industries, business types, product types).
 */
@Injectable()
export class SasapayOnboardingService {
  constructor(private readonly sasapay: SasapayService) {}

  /* ----------------------- Personal onboarding ----------------------- */

  /** Starts personal onboarding; SasaPay texts an OTP to the mobile number. */
  startPersonal(
    input: Omit<SasapayInput<PersonalOnboardingPayload>, 'middleName'> & {
      middleName?: string;
    },
  ): Promise<OnboardingRes> {
    return this.sasapay.post<PersonalOnboardingPayload, OnboardingRes>(
      '/personal-onboarding/',
      {
        ...input,
        middleName: input.middleName ?? '',
        merchantCode: this.sasapay.merchantCode,
        callbackUrl:
          input.callbackUrl ??
          this.sasapay.callbackUrl(SasapayCallback.Onboarding),
      },
    );
  }

  /** Opens the personal wallet with the OTP the customer received. */
  confirmPersonal(input: {
    requestId: string;
    otp: string;
  }): Promise<AccountRes> {
    return this.sasapay.post<OnboardingConfirmPayload, AccountRes>(
      '/personal-onboarding/confirmation/',
      { ...input, merchantCode: this.sasapay.merchantCode },
    );
  }

  /** Uploads selfie and ID photos when the wallet is AWAITING_KYC_UPLOAD. */
  uploadPersonalKyc(
    input: Omit<PersonalKycPayload, 'merchantCode'>,
  ): Promise<SasapayRes> {
    return this.sasapay.postForm<PersonalKycPayload, SasapayRes>(
      '/personal-onboarding/kyc/',
      { ...input, merchantCode: this.sasapay.merchantCode },
    );
  }

  /* ----------------------- Business onboarding ----------------------- */

  /** Starts business onboarding; SasaPay texts an OTP to the business mobile. */
  startBusiness(
    input: SasapayInput<BusinessOnboardingPayload>,
  ): Promise<OnboardingRes> {
    return this.sasapay.post<BusinessOnboardingPayload, OnboardingRes>(
      '/business-onboarding/',
      {
        ...input,
        merchantCode: this.sasapay.merchantCode,
        callbackUrl:
          input.callbackUrl ??
          this.sasapay.callbackUrl(SasapayCallback.Onboarding),
      },
    );
  }

  /** Submits the business with the OTP; it then awaits KYC and approval. */
  confirmBusiness(input: {
    requestId: string;
    otp: string;
  }): Promise<AccountRes> {
    return this.sasapay.post<OnboardingConfirmPayload, AccountRes>(
      '/business-onboarding/confirmation/',
      { ...input, merchantCode: this.sasapay.merchantCode },
    );
  }

  /**
   * Uploads business and director documents for the onboarding requestId.
   * TODO: confirm with SasaPay how directorsKyc (one entry per director) is
   * sent as multipart; only the single top-level director files go for now.
   */
  uploadBusinessKyc(
    input: Omit<BusinessKycPayload, 'merchantCode'>,
  ): Promise<SasapayRes> {
    return this.sasapay.postForm<BusinessKycPayload, SasapayRes>(
      '/business-onboarding/kyc/',
      { ...input, merchantCode: this.sasapay.merchantCode },
    );
  }

  /* ---------------------------- Customers ---------------------------- */

  /** Customer wallets with balances; pass links.next for the next page. */
  customers(link?: string): Promise<CustomersRes> {
    if (link) return this.sasapay.followLink<CustomersRes>(link);
    return this.sasapay.get<CustomersRes>('/customers/', {
      merchant_code: this.sasapay.merchantCode,
    });
  }

  /** Profile and wallets of one customer. */
  customerDetails(
    input: Omit<CustomerDetailsPayload, 'merchantCode'>,
  ): Promise<CustomerDetailsRes> {
    return this.sasapay.post<CustomerDetailsPayload, CustomerDetailsRes>(
      '/customer-details/',
      { ...input, merchantCode: this.sasapay.merchantCode },
    );
  }

  /** Amends a rejected customer's details; KYC is uploaded again after. */
  updateCustomer(
    input: SasapayInput<CustomerUpdatePayload>,
  ): Promise<SasapayRes> {
    return this.sasapay.post<CustomerUpdatePayload, SasapayRes>(
      '/customer-details/update/',
      {
        ...input,
        merchantCode: this.sasapay.merchantCode,
        callbackUrl:
          input.callbackUrl ??
          this.sasapay.callbackUrl(SasapayCallback.Onboarding),
      },
    );
  }

  /** Opens the customer's sub-wallet (at most one per customer). */
  createSubWallet(
    input: Omit<SubWalletPayload, 'merchantCode'>,
  ): Promise<AccountRes> {
    return this.sasapay.post<SubWalletPayload, AccountRes>('/sub-wallets/', {
      ...input,
      merchantCode: this.sasapay.merchantCode,
    });
  }

  /* ----------------------------- Lookups ----------------------------- */

  countries(): Promise<SasapayListRes<SasapayCountry>> {
    return this.sasapay.get('/countries/');
  }

  /** Sub-regions of a country by calling code, e.g. 254. */
  subRegions(callingCode: string): Promise<SasapayListRes<SasapayNamedItem>> {
    return this.sasapay.get('/countries/sub-regions/', { callingCode });
  }

  industries(): Promise<SasapayListRes<SasapayIndustry>> {
    return this.sasapay.get('/industries/');
  }

  subIndustries(
    industryId: number,
  ): Promise<SasapayListRes<SasapaySubIndustry>> {
    return this.sasapay.get('/sub-industries/', { industryId });
  }

  businessTypes(): Promise<SasapayListRes<SasapayNamedItem>> {
    return this.sasapay.get('/business-types/');
  }

  /** Account product types (business onboarding productType). */
  productTypes(): Promise<SasapayListRes<SasapayProductType>> {
    return this.sasapay.get('/products/');
  }
}
