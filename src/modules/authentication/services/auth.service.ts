import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Not } from 'typeorm';
import { NotifyService } from '../../notifications/services/notify.service';
import { EmailTemplate } from '../../shared/constants/email-templates';
import { FormError } from '../../shared/utils/form.util';
import {
  ChangePasswordForm,
  InviteRegisterForm,
  ProfileForm,
  RegisterForm,
} from '../dtos/auth-form.dtos';
import { Purpose } from '../entities/code.entity';
import { OtpChannel, SignInMethod, User } from '../entities/user.entity';
import { AttemptService } from './attempt.service';
import { CodeService } from './code.service';
import { UserService } from './user.service';
import { StorageService } from '../../shared/services/storage.service';
import { isDev } from '../../../configs/environment';

const VERIFY_CODE_MINUTES = 10;
const RESET_CODE_MINUTES = 15;
const LOGIN_CODE_MINUTES = 10;
const PHONE_CODE_MINUTES = 10;

/** "+254712345678" -> "•••• 5678" */
export const maskPhone = (phone?: string | null) =>
  phone ? `•••• ${phone.replace(/\D/g, '').slice(-4)}` : '';

/** "jane@example.com" -> "ja••••@example.com" */
export const maskAddress = (email: string) => {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(name.length - 2, 1))}@${domain}`;
};
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
// Compared against when the email is unknown so timing does not reveal it
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

/**
 * Registration, email verification, sign in, password reset and profile
 * changes. Session handling stays in the controllers; this service decides.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly codeService: CodeService,
    private readonly attemptService: AttemptService,
    private readonly configService: ConfigService,
    private readonly notifyService: NotifyService,
    private readonly storageService: StorageService,
  ) {}

  async register(form: RegisterForm): Promise<User> {
    const errors: Record<string, string> = {};
    if (form.password !== form.confirmPassword)
      errors.confirmPassword = 'Passwords do not match';
    if (await this.userService.findByEmail(form.email))
      errors.email = 'An account with this email already exists';
    if (await this.userService.filter({ phoneNumber: form.phoneNumber }))
      errors.phoneNumber = 'This phone number is already in use';
    if (Object.keys(errors).length)
      throw new FormError('Please fix the highlighted fields', errors);

    const user = await this.userService.save({
      fullName: form.fullName,
      email: form.email,
      phoneNumber: form.phoneNumber,
      password: await bcrypt.hash(form.password, 10),
      signInMethod: SignInMethod.SignUp,
    });
    await this.sendVerificationCode(user, true);
    return user;
  }

  /**
   * Creates the user behind an accepted invitation. The link reached their
   * inbox, so the email counts as verified.
   */
  async registerInvited(
    email: string,
    form: InviteRegisterForm,
  ): Promise<User> {
    const errors: Record<string, string> = {};
    if (form.password !== form.confirmPassword)
      errors.confirmPassword = 'Passwords do not match';
    if (await this.userService.filter({ phoneNumber: form.phoneNumber }))
      errors.phoneNumber = 'This phone number is already in use';
    if (await this.userService.findByEmail(email))
      throw new FormError(
        'An account with this email already exists. Sign in to accept the invitation.',
      );
    if (Object.keys(errors).length)
      throw new FormError('Please fix the highlighted fields', errors);

    return this.userService.save({
      fullName: form.fullName,
      email: email.trim().toLowerCase(),
      phoneNumber: form.phoneNumber,
      password: await bcrypt.hash(form.password, 10),
      emailVerified: true,
      signInMethod: SignInMethod.SignUp,
    });
  }

  async sendVerificationCode(user: User, welcome = false): Promise<void> {
    const code = await this.codeService.issue(
      user,
      Purpose.EmailVerification,
      VERIFY_CODE_MINUTES,
    );
    await this.attemptService.startCooldown(
      `resend:verify:${user.id}`,
      RESEND_COOLDOWN_MS,
    );
    this.notifyService.email({
      email: user.email,
      subject: welcome ? 'Complete your registration' : 'Verify your email',
      template: welcome
        ? EmailTemplate.Registration
        : EmailTemplate.EmailVerification,
      context: {
        name: user.fullName,
        code,
        expiryMinutes: VERIFY_CODE_MINUTES,
      },
    });
    this.logDevCode('verification', user.email, code);
  }

  async resendVerificationCode(userId: number): Promise<void> {
    if (await this.attemptService.onCooldown(`resend:verify:${userId}`))
      throw new FormError(
        'Please wait a minute before requesting another code',
      );
    const user = await this.userService.filter({ id: userId });
    if (!user)
      throw new FormError('Your session expired. Please sign in again');
    await this.sendVerificationCode(user);
  }

  async verifyEmail(userId: number, code: string): Promise<User> {
    const key = `verify:${userId}`;
    if (await this.attemptService.isBlocked(key, MAX_ATTEMPTS))
      throw new FormError(
        'Too many incorrect codes. Request a new code in a few minutes',
      );

    const user = await this.userService.filter({ id: userId });
    if (!user)
      throw new FormError('Your session expired. Please sign in again');

    if (
      !(await this.codeService.consume(user, Purpose.EmailVerification, code))
    ) {
      const left =
        MAX_ATTEMPTS - (await this.attemptService.fail(key, LOCKOUT_MS));
      throw new FormError('That code is incorrect or has expired', {
        code:
          left > 0
            ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left`
            : 'Too many attempts',
      });
    }
    await this.attemptService.clear(key);
    await this.userService.update(
      { id: user.id },
      { emailVerified: true, verified: true },
    );
    return { ...user, emailVerified: true, verified: true };
  }

  /** Checks credentials. Returns the user; callers decide what happens next. */
  async authenticate(email: string, password: string): Promise<User> {
    const key = `login:${email.trim().toLowerCase()}`;
    if (await this.attemptService.isBlocked(key, MAX_ATTEMPTS))
      throw new FormError('Too many failed attempts. Try again in 15 minutes');

    const user = await this.userService.findWithPassword({ email });
    const valid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    if (!user || !user.password || !valid) {
      await this.attemptService.fail(key, LOCKOUT_MS);
      throw new FormError('Incorrect email or password');
    }
    if (!user.active)
      throw new FormError('This account has been deactivated. Contact support');

    await this.attemptService.clear(key);
    return user;
  }

  /**
   * Where a user's one-time codes go: SMS when they chose it and their
   * phone is verified, otherwise email.
   */
  channelFor(user: User): OtpChannel {
    return user.otpChannel === OtpChannel.Sms &&
      user.phoneVerified &&
      user.phoneNumber
      ? OtpChannel.Sms
      : OtpChannel.Email;
  }

  /** Masked destination for "we sent a code to …". */
  destinationFor(user: User): string {
    return this.channelFor(user) === OtpChannel.Sms
      ? `your phone ${maskPhone(user.phoneNumber)}`
      : maskAddress(user.email);
  }

  /**
   * Issues a one-time code and sends it by the user's channel. Reusable by
   * any feature that asks for a code (purpose keeps codes apart).
   */
  async sendOtp(
    user: User,
    purpose: Purpose,
    minutes: number,
    email: { subject: string; template: EmailTemplate },
    smsText: (code: string) => string,
  ): Promise<OtpChannel> {
    const code = await this.codeService.issue(user, purpose, minutes);
    const channel = this.channelFor(user);
    if (channel === OtpChannel.Sms)
      this.notifyService.sms(user.phoneNumber, smsText(code));
    else
      this.notifyService.email({
        email: user.email,
        subject: email.subject.replace('{code}', code),
        template: email.template,
        context: { name: user.fullName, code, expiryMinutes: minutes },
      });
    this.logDevCode(`${purpose} (${channel})`, user.email, code);
    return channel;
  }

  /**
   * Sends a sign-in code: the second step for accounts without an
   * authenticator app. A fresh sign in always gets a new code (the old one
   * stops working); asking to resend is limited to once a minute.
   */
  async sendLoginCode(user: User, resend = false): Promise<void> {
    const cooldown = `resend:login:${user.id}`;
    if (resend && (await this.attemptService.onCooldown(cooldown)))
      throw new FormError(
        'Please wait a minute before requesting another code',
      );
    await this.attemptService.startCooldown(cooldown, RESEND_COOLDOWN_MS);
    await this.sendOtp(
      user,
      Purpose.AccountLogin,
      LOGIN_CODE_MINUTES,
      {
        subject: '{code} is your SaveApp sign-in code',
        template: EmailTemplate.LoginCode,
      },
      (code) =>
        `${code} is your SaveApp sign-in code. It expires in ${LOGIN_CODE_MINUTES} minutes. Never share it.`,
    );
  }

  /* -------------------------- Phone number -------------------------- */

  /** Texts a code to the user's phone to prove they own it. */
  async sendPhoneCode(user: User): Promise<void> {
    if (!user.phoneNumber)
      throw new FormError('Add a phone number to your profile first');
    const cooldown = `resend:phone:${user.id}`;
    if (await this.attemptService.onCooldown(cooldown))
      throw new FormError(
        'Please wait a minute before requesting another code',
      );
    await this.attemptService.startCooldown(cooldown, RESEND_COOLDOWN_MS);
    const code = await this.codeService.issue(
      user,
      Purpose.PhoneVerification,
      PHONE_CODE_MINUTES,
    );
    this.notifyService.sms(
      user.phoneNumber,
      `${code} is your SaveApp code to verify this phone number. It expires in ${PHONE_CODE_MINUTES} minutes.`,
    );
    this.logDevCode('phone verification', user.phoneNumber, code);
  }

  async verifyPhone(user: User, code: string): Promise<void> {
    const key = `phone:${user.id}`;
    if (await this.attemptService.isBlocked(key, MAX_ATTEMPTS))
      throw new FormError(
        'Too many wrong codes. Request a new code in a few minutes',
      );
    if (
      !(await this.codeService.consume(
        user,
        Purpose.PhoneVerification,
        code.replace(/\s+/g, ''),
      ))
    ) {
      const left =
        MAX_ATTEMPTS - (await this.attemptService.fail(key, LOCKOUT_MS));
      throw new FormError('That code is incorrect or has expired', {
        code:
          left > 0
            ? `Wrong code. ${left} attempt${left === 1 ? '' : 's'} left`
            : 'Too many attempts',
      });
    }
    await this.attemptService.clear(key);
    await this.userService.update({ id: user.id }, { phoneVerified: true });
  }

  /** SMS needs a verified phone; email is always available. */
  async setOtpChannel(user: User, channel: OtpChannel): Promise<void> {
    if (channel === OtpChannel.Sms && !user.phoneVerified)
      throw new FormError('Verify your phone number before choosing SMS');
    await this.userService.update({ id: user.id }, { otpChannel: channel });
  }

  async verifyLoginCode(userId: number, code: string): Promise<void> {
    const key = `login-code:${userId}`;
    if (await this.attemptService.isBlocked(key, MAX_ATTEMPTS))
      throw new FormError('Too many wrong codes. Sign in again in 15 minutes');
    const user = await this.userService.filter({ id: userId });
    if (
      !user ||
      !(await this.codeService.consume(user, Purpose.AccountLogin, code))
    ) {
      const left =
        MAX_ATTEMPTS - (await this.attemptService.fail(key, LOCKOUT_MS));
      throw new FormError('That code is incorrect or has expired', {
        code:
          left > 0
            ? `Wrong code. ${left} attempt${left === 1 ? '' : 's'} left`
            : 'Too many attempts',
      });
    }
    await this.attemptService.clear(key);
  }

  /** Always succeeds from the caller's view so emails cannot be enumerated. */
  async requestPasswordReset(email: string): Promise<void> {
    if (await this.attemptService.onCooldown(`resend:reset:${email}`)) return;
    await this.attemptService.startCooldown(
      `resend:reset:${email}`,
      RESEND_COOLDOWN_MS,
    );

    const user = await this.userService.findByEmail(email);
    if (!user || !user.active) return;

    const code = await this.codeService.issue(
      user,
      Purpose.ResetPassword,
      RESET_CODE_MINUTES,
    );
    this.notifyService.email({
      email: user.email,
      subject: 'Reset your password',
      template: EmailTemplate.ResetPassword,
      context: { name: user.fullName, code, expiryMinutes: RESET_CODE_MINUTES },
    });
    this.logDevCode('password reset', user.email, code);
  }

  async resetPassword(
    email: string,
    code: string,
    password: string,
    confirm: string,
  ): Promise<void> {
    if (password !== confirm)
      throw new FormError('Please fix the highlighted fields', {
        confirmPassword: 'Passwords do not match',
      });

    const key = `reset:${email}`;
    if (await this.attemptService.isBlocked(key, MAX_ATTEMPTS))
      throw new FormError(
        'Too many incorrect codes. Request a new code in a few minutes',
      );

    const user = await this.userService.findByEmail(email);
    if (
      !user ||
      !(await this.codeService.consume(user, Purpose.ResetPassword, code))
    ) {
      await this.attemptService.fail(key, LOCKOUT_MS);
      throw new FormError('That code is incorrect or has expired', {
        code: 'Incorrect or expired code',
      });
    }
    await this.attemptService.clear(key);
    await this.attemptService.clear(`login:${email}`);
    // Receiving the code proves the inbox belongs to them
    await this.userService.update(
      { id: user.id },
      { password: await bcrypt.hash(password, 10), emailVerified: true },
    );
  }

  async updateProfile(
    user: User,
    form: ProfileForm,
    photo?: Express.Multer.File,
  ): Promise<void> {
    const clash = await this.userService.filter({
      phoneNumber: form.phoneNumber,
      id: Not(user.id),
    });
    if (clash)
      throw new FormError('Please fix the highlighted fields', {
        phoneNumber: 'This phone number is already in use',
      });
    const phoneChanged = form.phoneNumber !== user.phoneNumber;

    // Profile photo: a new upload replaces the old one; the box removes it
    let profile = user.profile;
    if (photo) {
      try {
        profile = await this.storageService.uploadImage(photo);
      } catch (error) {
        if (error instanceof BadRequestException)
          throw new FormError('Please fix the highlighted fields', {
            photo: error.message,
          });
        throw error;
      }
      await this.storageService.deleteFile(user.profile);
    } else if (form.removePhoto === 'on' && user.profile) {
      await this.storageService.deleteFile(user.profile);
      profile = null;
    }

    await this.userService.update(
      { id: user.id },
      {
        fullName: form.fullName,
        phoneNumber: form.phoneNumber,
        profile,
        // A new number has to be verified again before codes go to it
        ...(phoneChanged
          ? { phoneVerified: false, otpChannel: OtpChannel.Email }
          : {}),
      },
    );
  }

  /** True when the password is the user's current one (throttled like sign in). */
  async checkPassword(user: User, password: string): Promise<boolean> {
    const key = `password:${user.id}`;
    if (await this.attemptService.isBlocked(key, MAX_ATTEMPTS))
      throw new FormError('Too many failed attempts. Try again in 15 minutes');
    const stored = await this.userService.findWithPassword({ id: user.id });
    const valid = await bcrypt.compare(
      password,
      stored?.password ?? DUMMY_HASH,
    );
    if (valid) await this.attemptService.clear(key);
    else await this.attemptService.fail(key, LOCKOUT_MS);
    return valid;
  }

  async changePassword(user: User, form: ChangePasswordForm): Promise<void> {
    const key = `password:${user.id}`;
    if (await this.attemptService.isBlocked(key, MAX_ATTEMPTS))
      throw new FormError('Too many failed attempts. Try again in 15 minutes');
    const stored = await this.userService.findWithPassword({ id: user.id });
    const valid = await bcrypt.compare(
      form.currentPassword,
      stored?.password ?? DUMMY_HASH,
    );
    const errors: Record<string, string> = {};
    if (!valid) errors.currentPassword = 'Your current password is incorrect';
    if (form.password !== form.confirmPassword)
      errors.confirmPassword = 'Passwords do not match';
    if (valid && form.password === form.currentPassword)
      errors.password = 'Choose a password you are not already using';
    if (!valid) await this.attemptService.fail(key, LOCKOUT_MS);
    if (Object.keys(errors).length)
      throw new FormError('Please fix the highlighted fields', errors);
    await this.attemptService.clear(key);
    await this.userService.update(
      { id: user.id },
      { password: await bcrypt.hash(form.password, 10) },
    );
  }

  private logDevCode(kind: string, email: string, code: string): void {
    if (isDev(this.configService.get<string>('ENV')))
      this.logger.debug(`[DEV] ${kind} code for ${email}: ${code}`);
  }
}
