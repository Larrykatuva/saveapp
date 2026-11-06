import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Portal as PortalAccess } from '../../../authentication/decorators/portal.decorator';
import {
  ChangePasswordForm,
  PASSWORD_HINT,
  ProfileForm,
} from '../../../authentication/dtos/auth-form.dtos';
import { OtpChannel, User } from '../../../authentication/entities/user.entity';
import { ForbiddenPageException } from '../../../authentication/filters/redirect.filter';
import { AuthService } from '../../../authentication/services/auth.service';
import { AuthenticatorService } from '../../../authentication/services/authenticator.service';
import { RequirePermission } from '../../../authorization/decorators/require-permission.decorator';
import {
  AuthorizationLevel,
  MERCHANT_LEVELS,
  SetPermission,
} from '../../../authorization/entities/permission.entity';
import { LOGO_UPLOAD } from '../../../onboarding/controllers/views/onboarding.controller';
import { BusinessForm } from '../../../onboarding/dtos/business-form.dto';
import { Account } from '../../../onboarding/entities/account.entity';
import { Business } from '../../../onboarding/entities/business.entity';
import { AccountService } from '../../../onboarding/services/account.service';
import { BusinessService } from '../../../onboarding/services/business.service';
import {
  PORTALS,
  Portal,
  firstSectionPage,
} from '../../../shared/constants/portals';
import {
  FieldErrors,
  FormError,
  validateForm,
} from '../../../shared/utils/form.util';
import {
  formatDate,
  fragment,
  imageUrl,
  initials,
  sectionView,
} from '../../../shared/utils/portal-view.util';
import { FileInterceptor } from '@nestjs/platform-express';

/** One `photo` image for My account; type and size are checked on upload. */
const PHOTO_UPLOAD = FileInterceptor('photo', {
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

/** Account switches on the Notifications page, keyed by their URL segment. */
const NOTIFICATIONS = [
  {
    key: 'email',
    field: 'allowEmailNotifications',
    label: 'Email updates',
    hint: 'Verification results, document reviews and changes to your business status.',
  },
  {
    key: 'phone',
    field: 'allowPhoneNotifications',
    label: 'Text messages',
    hint: 'The same updates as SMS to your phone number.',
  },
  {
    key: 'applicant',
    field: 'allowApplicantNotifications',
    label: 'Applicant alerts',
    hint: 'A message when someone applies through your business.',
  },
] as const;

/**
 * Settings shared by both portals: the index (first page the account may
 * open) and My account (profile and password).
 */
// @Injectable so TypeScript records the constructor types for the subclasses
@Injectable()
abstract class SettingsViewController {
  protected abstract readonly portal: Portal;

  constructor(
    protected readonly authService: AuthService,
    protected readonly authenticatorService: AuthenticatorService,
  ) {}

  private get twoFactorBase() {
    return `${this.portal.basePath}/settings/account/two-factor`;
  }

  @Get()
  index(@Req() req: Request, @Res() res: Response) {
    const first = firstSectionPage(
      this.portal,
      'settings',
      (req['permissions'] as string[]) ?? [],
    );
    if (!first) throw new ForbiddenPageException(this.portal.basePath);
    return res.redirect(first);
  }

  @Get('account')
  async account(@Req() req: Request, @Res() res: Response) {
    const user = req['user'] as User;
    const enabledAt = await this.authenticatorService.enabledAt(user.id);
    return res.render(
      'pages/settings/account',
      sectionView(this.portal, req, 'settings', 'My account', {
        base: `${this.portal.basePath}/settings/account`,
        profile: this.profileContext(user, user, {}),
        password: {
          action: `${this.portal.basePath}/settings/account/password`,
          errors: {},
          passwordHint: PASSWORD_HINT,
        },
        codes: {
          base: `${this.portal.basePath}/settings/account`,
          email: user.email,
          phone: user.phoneNumber,
          phoneVerified: user.phoneVerified,
          bySms: this.authService.channelFor(user) === OtpChannel.Sms,
        },
        twoFactor: {
          base: this.twoFactorBase,
          enabled: Boolean(enabledAt),
          since: formatDate(enabledAt),
          recoveryLeft: enabledAt
            ? await this.authenticatorService.recoveryCodesLeft(user.id)
            : 0,
        },
      }),
    );
  }

  /* ------------------------ One-time codes ------------------------ */

  /** Drawer: texts a code to the profile phone number and asks for it. */
  @Get('account/phone/verify')
  async phoneVerifyForm(@Req() req: Request, @Res() res: Response) {
    const user = req['user'] as User;
    let notice: string | undefined;
    try {
      await this.authService.sendPhoneCode(user);
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      notice = error.message;
    }
    return fragment(res, 'settings/phone_verify', {
      action: `${this.portal.basePath}/settings/account/phone/verify`,
      resend: `${this.portal.basePath}/settings/account/phone/resend`,
      phone: user.phoneNumber,
      notice,
      errors: {},
    });
  }

  @Post('account/phone/resend')
  async resendPhoneCode(@Req() req: Request, @Res() res: Response) {
    try {
      await this.authService.sendPhoneCode(req['user'] as User);
      return res.json({ ok: true, message: 'We sent you a new code' });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return res.status(429).json({ ok: false, message: error.message });
    }
  }

  @Post('account/phone/verify')
  async verifyPhone(
    @Req() req: Request,
    @Res() res: Response,
    @Body('code') code?: string,
  ) {
    const user = req['user'] as User;
    try {
      await this.authService.verifyPhone(user, code ?? '');
      return res.json({
        ok: true,
        message: 'Phone number verified',
        reload: true,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'settings/phone_verify',
        {
          action: `${this.portal.basePath}/settings/account/phone/verify`,
          resend: `${this.portal.basePath}/settings/account/phone/resend`,
          phone: user.phoneNumber,
          errors: { code: error.errors.code ?? error.message },
        },
        422,
      );
    }
  }

  @Post('account/otp-channel')
  async otpChannel(
    @Req() req: Request,
    @Res() res: Response,
    @Body('channel') channel?: string,
  ) {
    const choice =
      channel === OtpChannel.Sms ? OtpChannel.Sms : OtpChannel.Email;
    try {
      await this.authService.setOtpChannel(req['user'] as User, choice);
      return res.json({
        ok: true,
        message:
          choice === OtpChannel.Sms
            ? 'One-time codes will come by SMS'
            : 'One-time codes will come by email',
        reload: true,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return res.status(400).json({ ok: false, message: error.message });
    }
  }

  /* ---------------------- Two-step verification -------------------- */

  /** Setup drawer: a fresh secret as a QR code and a key to type in. */
  @Get('account/two-factor/setup')
  async twoFactorSetup(@Req() req: Request, @Res() res: Response) {
    try {
      const setup = await this.authenticatorService.beginSetup(
        req['user'] as User,
      );
      return fragment(res, 'settings/two_factor_setup', {
        action: `${this.twoFactorBase}/setup`,
        setup,
        errors: {},
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return res.status(409).json({ ok: false, message: error.message });
    }
  }

  @Post('account/two-factor/setup')
  async confirmTwoFactor(
    @Req() req: Request,
    @Res() res: Response,
    @Body('code') code?: string | string[],
  ) {
    const user = req['user'] as User;
    const value = Array.isArray(code) ? code.join('') : (code ?? '');
    try {
      req.session.recoveryCodes = await this.authenticatorService.confirmSetup(
        user,
        value,
      );
      return res.json({
        ok: true,
        message: 'Two-step verification is on',
        event: 'drawer:open',
        url: `${this.twoFactorBase}/recovery-codes`,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      // Same secret as before, so the QR already scanned keeps working
      const setup = await this.authenticatorService.pendingSetup(user);
      if (!setup)
        return res.status(409).json({ ok: false, message: error.message });
      return fragment(
        res,
        'settings/two_factor_setup',
        {
          action: `${this.twoFactorBase}/setup`,
          setup,
          errors: error.errors,
          formError: Object.keys(error.errors).length
            ? undefined
            : error.message,
        },
        422,
      );
    }
  }

  /** Recovery codes, shown once after setup or regeneration. */
  @Get('account/two-factor/recovery-codes')
  recoveryCodes(@Req() req: Request, @Res() res: Response) {
    const codes = req.session.recoveryCodes;
    delete req.session.recoveryCodes;
    return fragment(res, 'settings/two_factor_codes', {
      codes: codes ?? null,
      text: (codes ?? []).join('\n'),
    });
  }

  @Get('account/two-factor/regenerate')
  regenerateForm(@Res() res: Response) {
    return fragment(res, 'settings/two_factor_confirm', {
      action: `${this.twoFactorBase}/regenerate`,
      regenerate: true,
      errors: {},
    });
  }

  @Post('account/two-factor/regenerate')
  async regenerate(
    @Req() req: Request,
    @Res() res: Response,
    @Body('code') code?: string,
  ) {
    try {
      req.session.recoveryCodes =
        await this.authenticatorService.regenerateRecoveryCodes(
          req['user'] as User,
          code ?? '',
        );
      return res.json({
        ok: true,
        message: 'New recovery codes created; the old ones no longer work',
        event: 'drawer:open',
        url: `${this.twoFactorBase}/recovery-codes`,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'settings/two_factor_confirm',
        {
          action: `${this.twoFactorBase}/regenerate`,
          regenerate: true,
          errors: { code: error.errors.code ?? error.message },
        },
        422,
      );
    }
  }

  @Get('account/two-factor/disable')
  disableForm(@Res() res: Response) {
    return fragment(res, 'settings/two_factor_confirm', {
      action: `${this.twoFactorBase}/disable`,
      errors: {},
    });
  }

  /** Turning it off needs the password and a current code (or a recovery code). */
  @Post('account/two-factor/disable')
  async disable(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: { password?: string; code?: string },
  ) {
    const user = req['user'] as User;
    const rerender = (errors: Record<string, string>) =>
      fragment(
        res,
        'settings/two_factor_confirm',
        { action: `${this.twoFactorBase}/disable`, errors },
        422,
      );
    try {
      if (!(await this.authService.checkPassword(user, body.password ?? '')))
        return rerender({ password: 'Your password is incorrect' });
      await this.authenticatorService.disable(user, body.code ?? '');
      return res.json({
        ok: true,
        message: 'Two-step verification is off',
        reload: true,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return rerender({ code: error.errors.code ?? error.message });
    }
  }

  @Post('account/profile')
  @UseInterceptors(PHOTO_UPLOAD)
  async saveProfile(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: Record<string, unknown>,
    @UploadedFile() photo?: Express.Multer.File,
  ) {
    const user = req['user'] as User;
    const { values, errors } = await validateForm(ProfileForm, body);
    try {
      if (Object.keys(errors).length)
        throw new FormError('Please fix the highlighted fields', errors);
      await this.authService.updateProfile(user, values, photo);
      return res.json({ ok: true, message: 'Profile saved', reload: true });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'settings/profile_form',
        this.profileContext(user, body, error.errors),
        422,
      );
    }
  }

  @Post('account/password')
  async savePassword(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: Record<string, unknown>,
  ) {
    const { values, errors } = await validateForm(ChangePasswordForm, body);
    try {
      if (Object.keys(errors).length)
        throw new FormError('Please fix the highlighted fields', errors);
      await this.authService.changePassword(req['user'] as User, values);
      return res.json({ ok: true, message: 'Password changed', reload: true });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'settings/password_form',
        {
          action: `${this.portal.basePath}/settings/account/password`,
          errors: error.errors,
          passwordHint: PASSWORD_HINT,
        },
        422,
      );
    }
  }

  private profileContext(
    user: User,
    values: Record<string, unknown> | User,
    errors: FieldErrors,
  ) {
    return {
      action: `${this.portal.basePath}/settings/account/profile`,
      email: user.email,
      initials: initials(user.fullName),
      photoUrl: imageUrl(user.profile),
      // image_field partial
      currentLogo: imageUrl(user.profile),
      customLogo: Boolean(user.profile),
      values,
      errors,
    };
  }
}

@ApiExcludeController()
@Controller('admin/settings')
@PortalAccess(AuthorizationLevel.Staff)
export class AdminSettingsViewController extends SettingsViewController {
  protected readonly portal = PORTALS.admin;
}

/**
 * Merchant settings: My account plus the business profile and the
 * account's notification switches.
 */
@ApiExcludeController()
@Controller('merchant/settings')
@PortalAccess(...MERCHANT_LEVELS)
export class MerchantSettingsViewController extends SettingsViewController {
  protected readonly portal = PORTALS.merchant;

  constructor(
    authService: AuthService,
    authenticatorService: AuthenticatorService,
    private readonly businessService: BusinessService,
    private readonly accountService: AccountService,
  ) {
    super(authService, authenticatorService);
  }

  @Get('business')
  business(@Req() req: Request, @Res() res: Response) {
    const business = (req['account'] as Account).business;
    return res.render(
      'pages/settings/business',
      sectionView(this.portal, req, 'settings', 'Business profile', {
        form: this.businessContext(req, business, {}),
      }),
    );
  }

  @Post('business')
  @RequirePermission(SetPermission.MerchantProfileManage)
  @UseInterceptors(LOGO_UPLOAD)
  async saveBusiness(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: Record<string, unknown>,
    @UploadedFile() logo?: Express.Multer.File,
  ) {
    const business = (req['account'] as Account).business;
    const { values, errors } = await validateForm(BusinessForm, body);
    try {
      if (Object.keys(errors).length)
        throw new FormError('Please fix the highlighted fields', errors);
      await this.businessService.updateProfile(business, values, logo);
      return res.json({
        ok: true,
        message: `${values.name} saved`,
        reload: true,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'settings/business_form',
        this.businessContext(req, { ...business, ...body }, error.errors),
        422,
      );
    }
  }

  @Get('notifications')
  notifications(@Req() req: Request, @Res() res: Response) {
    const account = req['account'] as Account;
    return res.render(
      'pages/settings/notifications',
      sectionView(this.portal, req, 'settings', 'Notifications', {
        phone: (req['user'] as User).phoneNumber,
        switches: NOTIFICATIONS.map((item) => ({
          ...item,
          on: account[item.field],
          url: `${this.portal.basePath}/settings/notifications/${item.key}`,
        })),
      }),
    );
  }

  @Post('notifications/:key')
  async toggleNotification(
    @Req() req: Request,
    @Res() res: Response,
    @Param('key') key: string,
  ) {
    const account = req['account'] as Account;
    const item = NOTIFICATIONS.find((entry) => entry.key === key);
    if (!item)
      return res.status(404).json({ ok: false, message: 'Unknown setting' });
    const on = !account[item.field];
    await this.accountService.update({ id: account.id }, { [item.field]: on });
    return res.json({
      ok: true,
      active: on,
      message: `${item.label} turned ${on ? 'on' : 'off'}`,
    });
  }

  private businessContext(
    req: Request,
    values: Record<string, unknown> | Business,
    errors: FieldErrors,
  ) {
    const business = (req['account'] as Account).business;
    const permissions = (req['permissions'] as string[]) ?? [];
    return {
      action: `${this.portal.basePath}/settings/business`,
      canEdit: permissions.includes(SetPermission.MerchantProfileManage),
      values,
      errors,
      hasErrors: Object.keys(errors).length > 0,
      country: business.country?.name ?? 'Not set',
      countryFlag: business.country?.logo,
      currentLogo: imageUrl(business.logo),
      customLogo: Boolean(business.logo),
      initials: initials(business.name),
    };
  }
}
