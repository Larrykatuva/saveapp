/**
 * Handlebars email templates under /templates, keyed by their path relative to
 * that directory. Pass the value as `template` to MailerService.sendMail.
 */
export enum EmailTemplate {
  Registration = 'auth/registration',
  EmailVerification = 'auth/email-verification',
  ResetPassword = 'auth/reset-password',
  LoginCode = 'auth/login-code',
  CardDetailsCode = 'cards/details-code',
  Invite = 'onboarding/invite',
  BusinessStatus = 'business/status-changed',
  BusinessKycReview = 'business/kyc-review',
}

/**
 * Templates are compiled in strict mode, so every field below must be present
 * in the context or rendering throws.
 */
export interface CodeEmailContext {
  name: string;
  code: string;
  expiryMinutes: number;
}

export interface InviteEmailContext {
  inviterName: string;
  entityName: string;
  roleName: string;
  url: string;
  expiryDays: number;
}

export interface BusinessStatusContext {
  name: string;
  businessName: string;
  status: string;
  message: string;
  url: string;
}

export interface BusinessKycReviewContext {
  name: string;
  businessName: string;
  items: Array<{ name: string; comment: string }>;
  url: string;
}

export type EmailTemplateContext = {
  [EmailTemplate.Registration]: CodeEmailContext;
  [EmailTemplate.EmailVerification]: CodeEmailContext;
  [EmailTemplate.ResetPassword]: CodeEmailContext;
  [EmailTemplate.LoginCode]: CodeEmailContext;
  [EmailTemplate.Invite]: InviteEmailContext;
  [EmailTemplate.BusinessStatus]: BusinessStatusContext;
  [EmailTemplate.BusinessKycReview]: BusinessKycReviewContext;
};
