import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { User } from '../../../authentication/entities/user.entity';
import { SignedInGuard } from '../../../authentication/guards/signed-in.guard';
import { CountryService } from '../../../settings/services/country.service';
import { FormError, validateForm } from '../../../shared/utils/form.util';
import { CreateBusinessForm } from '../../dtos/business-form.dto';
import { AccountService } from '../../services/account.service';
import { BusinessService } from '../../services/business.service';
import { KycService } from '../../services/kyc.service';

export const LOGO_UPLOAD = FileInterceptor('logo', {
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

/**
 * Where a verified user without a business lands: they create the business,
 * which gives them its Owner account, then continue to onboarding documents in the
 * merchant portal.
 */
@ApiExcludeController()
@Controller('onboarding')
@UseGuards(SignedInGuard)
export class OnboardingViewController {
  constructor(
    private readonly businessService: BusinessService,
    private readonly accountService: AccountService,
    private readonly countryService: CountryService,
    private readonly kycService: KycService,
  ) {}

  @Get()
  async page(@Req() req: Request, @Res() res: Response) {
    return this.render(req, res, {}, {});
  }

  @Post('business')
  @UseInterceptors(LOGO_UPLOAD)
  async create(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: Record<string, unknown>,
    @UploadedFile() logo?: Express.Multer.File,
  ) {
    const { values, errors } = await validateForm(CreateBusinessForm, body);
    try {
      if (Object.keys(errors).length)
        throw new FormError('Please fix the highlighted fields', errors);
      const account = await this.businessService.register(
        req['user'] as User,
        values,
        logo,
      );
      req.session.accountId = account.id;
      req.session.flash = {
        type: 'success',
        message: `${values.name} is set up. Next, upload your onboarding documents.`,
      };
      return res.redirect(303, '/merchant/settings/onboarding');
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      res.status(422);
      return this.render(req, res, body, error.errors, error.message);
    }
  }

  private async render(
    req: Request,
    res: Response,
    values: Record<string, unknown>,
    errors: Record<string, string>,
    message?: string,
  ) {
    const user = req['user'] as User;
    const accounts = await this.accountService.portalAccounts(user.id);
    const countries = await this.countryService.activeOptions();
    return res.render('pages/onboarding/business', {
      layout: 'layouts/onboarding',
      title: 'Set up your business',
      steps: this.kycService.steps(null),
      firstName: user.fullName.split(' ')[0],
      hasAccounts: accounts.length > 0,
      countries: countries.map((country) => ({
        id: country.id,
        name: country.name,
        selected: Number(values.country) === country.id,
      })),
      values,
      errors,
      formError: message,
    });
  }
}
