import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  IDLE_SIGN_OUT,
  SESSION_COOKIE,
} from '../../../../configs/session.config';
import { AccountService } from '../../../onboarding/services/account.service';
import { portalForLevel } from '../../../shared/constants/portals';
import { validateForm } from '../../../shared/utils/form.util';
import {
  ForgotPasswordForm,
  LoginForm,
  PASSWORD_HINT,
  RegisterForm,
  ResetPasswordForm,
  VerifyCodeForm,
} from '../../dtos/auth-form.dtos';
import { OtpChannel } from '../../entities/user.entity';
import { AuthService } from '../../services/auth.service';
import { AuthenticatorService } from '../../services/authenticator.service';
import { UserService } from '../../services/user.service';
import {
  back,
  fail,
  formState,
  maskEmail,
  routeAfterSignIn,
  signIn,
  destination,
  startTwoFactor,
} from '../../utils/session.util';

/**
 * Server-rendered authentication for both portals: one sign in for SaveApp
 * staff and merchants, then routing by the user's active account(s).
 */
@ApiExcludeController()
@Controller()
export class AuthViewController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly accountService: AccountService,
    private readonly authenticatorService: AuthenticatorService,
  ) {}

  /* ---------------------------- Sign in ---------------------------- */

  @Get('auth/login')
  login(
    @Req() req: Request,
    @Res() res: Response,
    @Query('signedOut') signedOut?: string,
    @Query('idle') idle?: string,
  ) {
    if (req.session.userId) return res.redirect('/');
    // The session is destroyed on sign out, so this notice comes from the URL
    if (idle && !res.locals.flash)
      res.locals.flash = {
        type: 'info',
        message: `For your security you were signed out after ${IDLE_SIGN_OUT.minutes} minutes without activity. Sign in again to continue.`,
      };
    else if (signedOut && !res.locals.flash)
      res.locals.flash = { type: 'info', message: 'You have been signed out.' };
    return this.render(res, 'login', {
      title: 'Sign in',
      panelTitle: 'Your SaveApp business, in one place.',
      panelText:
        'Sign in to manage your verification, your team and your business settings.',
    });
  }

  @Post('auth/login')
  async submitLogin(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ) {
    const { values, errors } = await validateForm(LoginForm, body);
    if (Object.keys(errors).length)
      return back(req, res, '/auth/login', body, errors);

    try {
      const user = await this.authService.authenticate(
        values.email,
        values.password,
      );
      if (!user.emailVerified) {
        req.session.pendingUserId = user.id;
        await this.authService.resendVerificationCode(user.id).catch(() => {
          // A code was sent less than a minute ago; the user can use that one
        });
        req.session.flash = {
          type: 'info',
          message: 'Verify your email to finish signing in.',
        };
        return res.redirect(303, '/auth/verify');
      }
      const remember = values.remember === 'on';
      // Second step: the authenticator app, or a code we email
      if (await this.authenticatorService.isEnabled(user.id))
        return startTwoFactor(req, res, user, 'app', remember);
      await this.authService.sendLoginCode(user);
      return startTwoFactor(req, res, user, 'email', remember);
    } catch (error) {
      return fail(req, res, '/auth/login', body, error);
    }
  }

  /* ---------------------- Two-step verification -------------------- */

  /** Optional prompt after a password-only sign in. */
  @Get('auth/two-factor/suggest')
  async suggestTwoFactor(@Req() req: Request, @Res() res: Response) {
    const user = await this.signedInUser(req);
    if (!user) return res.redirect('/auth/login');
    if (await this.authenticatorService.isEnabled(user.id))
      return routeAfterSignIn(req, res, this.accountService);
    return this.render(res, 'two-factor-suggest', {
      title: 'Protect your account',
      firstName: user.fullName.split(' ')[0],
      panelTitle: 'A second lock on your account.',
      panelText:
        "With an authenticator app, someone who learns your password still can't sign in without your phone.",
    });
  }

  /** Setup on the sign-in screens: QR code, key and the first code. */
  @Get('auth/two-factor/setup')
  async setupTwoFactor(@Req() req: Request, @Res() res: Response) {
    const user = await this.signedInUser(req);
    if (!user) return res.redirect('/auth/login');
    if (await this.authenticatorService.isEnabled(user.id))
      return routeAfterSignIn(req, res, this.accountService);
    // Keep the secret already shown, so a scanned QR code stays valid
    const setup =
      (await this.authenticatorService.pendingSetup(user)) ??
      (await this.authenticatorService.beginSetup(user));
    return this.render(res, 'two-factor-setup', {
      title: 'Set up your authenticator app',
      setup,
      panelTitle: 'A second lock on your account.',
      panelText:
        'Scan the code with your authenticator app. From now on signing in asks for the code it shows.',
    });
  }

  @Post('auth/two-factor/setup')
  async confirmSetupTwoFactor(
    @Req() req: Request,
    @Res() res: Response,
    @Body('code') code?: string | string[],
  ) {
    const user = await this.signedInUser(req);
    if (!user) return res.redirect(303, '/auth/login');
    try {
      req.session.recoveryCodes = await this.authenticatorService.confirmSetup(
        user,
        (Array.isArray(code) ? code.join('') : (code ?? '')).trim(),
      );
      return res.redirect(303, '/auth/two-factor/recovery-codes');
    } catch (error) {
      return fail(req, res, '/auth/two-factor/setup', {}, error);
    }
  }

  @Get('auth/two-factor/recovery-codes')
  async setupRecoveryCodes(@Req() req: Request, @Res() res: Response) {
    const user = await this.signedInUser(req);
    if (!user) return res.redirect('/auth/login');
    const codes = req.session.recoveryCodes;
    delete req.session.recoveryCodes;
    if (!codes) return routeAfterSignIn(req, res, this.accountService);
    return this.render(res, 'two-factor-codes', {
      title: 'Save your recovery codes',
      codes,
      text: codes.join('\n'),
      panelTitle: 'Keep a way back in.',
      panelText:
        'Recovery codes let you sign in if you lose your phone. Each one works once.',
    });
  }

  /** Leaves the two-step screens for the portal (or the account picker). */
  @Get('auth/continue')
  async continueToPortal(@Req() req: Request, @Res() res: Response) {
    if (!req.session.userId) return res.redirect('/auth/login');
    return routeAfterSignIn(req, res, this.accountService);
  }

  @Get('auth/two-factor')
  async twoFactor(
    @Req() req: Request,
    @Res() res: Response,
    @Query('recovery') recovery?: string,
  ) {
    const pending = req.session.twoFactor;
    if (!pending || pending.expires < Date.now()) {
      delete req.session.twoFactor;
      return res.redirect('/auth/login');
    }
    const user = await this.userService.filter({ id: pending.userId });
    if (!user) return res.redirect('/auth/login');
    const byEmail = pending.method === 'email';
    const bySms =
      byEmail && this.authService.channelFor(user) === OtpChannel.Sms;
    return this.render(res, 'two-factor', {
      title: bySms
        ? 'Check your phone'
        : byEmail
          ? 'Check your email'
          : 'Two-step verification',
      byEmail,
      bySms,
      destination: this.authService.destinationFor(user),
      useRecovery: !byEmail && recovery === '1',
      panelTitle: 'One more step to keep your account safe.',
      panelText:
        'Your account is protected with an authenticator app. Enter the code it shows to finish signing in.',
    });
  }

  @Post('auth/two-factor')
  async submitTwoFactor(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: { code?: string | string[]; recovery?: string },
  ) {
    const pending = req.session.twoFactor;
    if (!pending || pending.expires < Date.now()) {
      delete req.session.twoFactor;
      req.session.flash = {
        type: 'info',
        message: 'That took too long. Sign in again.',
      };
      return res.redirect(303, '/auth/login');
    }
    const usingRecovery =
      pending.method === 'app' && typeof body.recovery === 'string';
    const code = usingRecovery
      ? String(body.recovery).trim()
      : (Array.isArray(body.code)
          ? body.code.join('')
          : (body.code ?? '')
        ).trim();
    const url = usingRecovery
      ? '/auth/two-factor?recovery=1'
      : '/auth/two-factor';
    if (!code)
      return back(
        req,
        res,
        url,
        {},
        {
          code: usingRecovery
            ? 'Enter a recovery code'
            : 'Enter the 6-digit code',
        },
      );
    try {
      const method =
        pending.method === 'email'
          ? await this.authService
              .verifyLoginCode(pending.userId, code)
              .then(() => 'email' as const)
          : await this.authenticatorService.verify(pending.userId, code);
      const user = await this.userService.filter({
        id: pending.userId,
        active: true,
      });
      if (!user) return res.redirect(303, '/auth/login');
      delete req.session.twoFactor;
      await signIn(req, user, pending.remember);
      if (method === 'recovery')
        req.session.flash = {
          type: 'info',
          message:
            'You used a recovery code. Get new ones from My account if you are running low.',
        };
      if (pending.inviteToken)
        return res.redirect(303, `/auth/invite/${pending.inviteToken}`);
      // Signed in with an emailed code: offer (never force) an authenticator
      if (method === 'email')
        return res.redirect(303, '/auth/two-factor/suggest');
      return routeAfterSignIn(req, res, this.accountService);
    } catch (error) {
      return fail(req, res, url, {}, error);
    }
  }

  @Post('auth/two-factor/resend')
  async resendLoginCode(@Req() req: Request, @Res() res: Response) {
    const pending = req.session.twoFactor;
    if (!pending || pending.expires < Date.now() || pending.method !== 'email')
      return res.redirect(303, '/auth/login');
    const user = await this.userService.filter({ id: pending.userId });
    if (!user) return res.redirect(303, '/auth/login');
    try {
      await this.authService.sendLoginCode(user, true);
      req.session.flash = {
        type: 'success',
        message: 'We sent you a new code.',
      };
    } catch (error) {
      req.session.flash = { type: 'error', message: (error as Error).message };
    }
    return res.redirect(303, '/auth/two-factor');
  }

  /* -------------------------- Registration ------------------------- */

  @Get('auth/register')
  register(@Req() req: Request, @Res() res: Response) {
    if (req.session.userId) return res.redirect('/');
    return this.render(res, 'register', {
      title: 'Create account',
      passwordHint: PASSWORD_HINT,
      panelTitle: 'Bring your business to SaveApp.',
      panelText:
        'Create your account, add your business details and upload your documents. We review them and get you set up.',
    });
  }

  @Post('auth/register')
  async submitRegister(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ) {
    const { values, errors } = await validateForm(RegisterForm, body);
    if (Object.keys(errors).length)
      return back(req, res, '/auth/register', body, errors);

    try {
      const user = await this.authService.register(values);
      req.session.pendingUserId = user.id;
      req.session.flash = {
        type: 'success',
        message: 'Account created. Check your email for a 6-digit code.',
      };
      return res.redirect(303, '/auth/verify');
    } catch (error) {
      return fail(req, res, '/auth/register', body, error);
    }
  }

  /* ----------------------- Email verification ---------------------- */

  @Get('auth/verify')
  async verify(@Req() req: Request, @Res() res: Response) {
    const user = req.session.pendingUserId
      ? await this.userService.filter({ id: req.session.pendingUserId })
      : null;
    if (!user) return res.redirect('/auth/login');

    return this.render(res, 'verify', {
      title: 'Verify your email',
      email: maskEmail(user.email),
      resendAction: '/auth/verify/resend',
      panelTitle: 'One last step to secure your account.',
      panelText:
        'Verifying your email keeps your account safe and lets us reach you about your business.',
    });
  }

  @Post('auth/verify')
  async submitVerify(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ) {
    const userId = req.session.pendingUserId;
    if (!userId) return res.redirect(303, '/auth/login');

    const { values, errors } = await validateForm(VerifyCodeForm, body);
    if (Object.keys(errors).length)
      return back(req, res, '/auth/verify', {}, errors);

    try {
      const user = await this.authService.verifyEmail(userId, values.code);
      delete req.session.pendingUserId;
      await signIn(req, user, false);
      req.session.flash = {
        type: 'success',
        message: `Welcome, ${user.fullName.split(' ')[0]}! Your email is verified.`,
      };
      return routeAfterSignIn(req, res, this.accountService);
    } catch (error) {
      return fail(req, res, '/auth/verify', {}, error);
    }
  }

  @Post('auth/verify/resend')
  async resendVerification(@Req() req: Request, @Res() res: Response) {
    const userId = req.session.pendingUserId;
    if (!userId) return res.redirect(303, '/auth/login');
    try {
      await this.authService.resendVerificationCode(userId);
      req.session.flash = {
        type: 'success',
        message: 'We sent you a new code.',
      };
    } catch (error) {
      req.session.flash = { type: 'error', message: (error as Error).message };
    }
    return res.redirect(303, '/auth/verify');
  }

  /* ------------------------- Password reset ------------------------ */

  @Get('auth/forgot-password')
  forgotPassword(@Res() res: Response) {
    return this.render(res, 'forgot-password', {
      title: 'Forgot password',
      panelTitle: 'Locked out? It happens.',
      panelText:
        'Reset your password in under a minute with a code sent to your email.',
    });
  }

  @Post('auth/forgot-password')
  async submitForgotPassword(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ) {
    const { values, errors } = await validateForm(ForgotPasswordForm, body);
    if (Object.keys(errors).length)
      return back(req, res, '/auth/forgot-password', body, errors);

    await this.authService.requestPasswordReset(values.email);
    req.session.resetEmail = values.email;
    req.session.flash = {
      type: 'success',
      message: 'If an account exists for that email, we sent a reset code.',
    };
    return res.redirect(303, '/auth/reset-password');
  }

  @Get('auth/reset-password')
  resetPassword(@Req() req: Request, @Res() res: Response) {
    const email = req.session.resetEmail;
    if (!email) return res.redirect('/auth/forgot-password');
    return this.render(res, 'reset-password', {
      title: 'Reset password',
      email: maskEmail(email),
      passwordHint: PASSWORD_HINT,
      resendAction: '/auth/reset-password/resend',
      panelTitle: 'Choose a strong new password.',
      panelText:
        'Use a password you do not use anywhere else to keep your account secure.',
    });
  }

  @Post('auth/reset-password')
  async submitResetPassword(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ) {
    const email = req.session.resetEmail;
    if (!email) return res.redirect(303, '/auth/forgot-password');

    const { values, errors } = await validateForm(ResetPasswordForm, body);
    if (Object.keys(errors).length)
      return back(req, res, '/auth/reset-password', {}, errors);

    try {
      await this.authService.resetPassword(
        email,
        values.code,
        values.password,
        values.confirmPassword,
      );
      delete req.session.resetEmail;
      req.session.flash = {
        type: 'success',
        message: 'Password updated. Sign in with your new password.',
      };
      return res.redirect(303, '/auth/login');
    } catch (error) {
      return fail(req, res, '/auth/reset-password', {}, error);
    }
  }

  @Post('auth/reset-password/resend')
  async resendReset(@Req() req: Request, @Res() res: Response) {
    const email = req.session.resetEmail;
    if (!email) return res.redirect(303, '/auth/forgot-password');
    await this.authService.requestPasswordReset(email);
    req.session.flash = {
      type: 'success',
      message: 'If an account exists, a new code is on its way.',
    };
    return res.redirect(303, '/auth/reset-password');
  }

  /* ------------------------ Account selection ---------------------- */

  @Get('auth/accounts')
  async accounts(@Req() req: Request, @Res() res: Response) {
    const userId = req.session.userId;
    if (!userId) return res.redirect('/auth/login');
    const user = await this.userService.filter({ id: userId });
    if (!user) return res.redirect('/auth/login');

    const active = await this.accountService.portalAccounts(userId);
    if (!active.length) return res.redirect('/onboarding');
    return this.render(res, 'accounts', {
      title: 'Choose an account',
      firstName: user.fullName.split(' ')[0],
      accounts: active.map((account) => ({
        ...this.accountService.summarize(account),
        portal: portalForLevel(account.type).name,
        isStaff: !account.business,
        current: account.id === req.session.accountId,
      })),
      panelTitle: 'One sign in, every business you work with.',
      panelText:
        'Switch between the SaveApp team and the businesses you belong to without signing out.',
    });
  }

  @Post('auth/accounts')
  async selectAccount(
    @Req() req: Request,
    @Res() res: Response,
    @Body('accountId') accountId: string,
  ) {
    const userId = req.session.userId;
    if (!userId) return res.redirect(303, '/auth/login');

    const account = (await this.accountService.portalAccounts(userId)).find(
      (item) => item.id === Number(accountId),
    );
    if (!account) {
      req.session.flash = {
        type: 'error',
        message: 'That account is not available.',
      };
      return res.redirect(303, '/auth/accounts');
    }
    req.session.accountId = account.id;
    return res.redirect(303, destination(req, account.type));
  }

  @Post('auth/logout')
  async logout(
    @Req() req: Request,
    @Res() res: Response,
    @Body('reason') reason?: string,
  ) {
    await new Promise((resolve) => req.session.destroy(resolve));
    res.clearCookie(SESSION_COOKIE);
    return res.redirect(
      303,
      reason === 'idle' ? '/auth/login?idle=1' : '/auth/login?signedOut=1',
    );
  }

  /**
   * "Stay signed in" on the idle dialog, and a ping while the user is active:
   * touching the session keeps it alive (sessions are rolling).
   */
  @Post('auth/keep-alive')
  keepAlive(@Req() req: Request, @Res() res: Response) {
    if (!req.session.userId) return res.status(401).json({ ok: false });
    return res.status(204).end();
  }

  /* --------------------------- Helpers ----------------------------- */

  private async signedInUser(req: Request) {
    return req.session.userId
      ? this.userService.filter({ id: req.session.userId, active: true })
      : null;
  }

  private render(
    res: Response,
    view: string,
    context: Record<string, unknown>,
  ) {
    return res.render(`pages/auth/${view}`, {
      layout: 'layouts/auth',
      ...formState(res),
      ...context,
    });
  }
}
