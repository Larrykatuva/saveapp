import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Portal } from '../../../authentication/decorators/portal.decorator';
import { RequirePermission } from '../../../authorization/decorators/require-permission.decorator';
import {
  MERCHANT_LEVELS,
  SetPermission,
} from '../../../authorization/entities/permission.entity';
import { PORTALS } from '../../../shared/constants/portals';
import { FormError } from '../../../shared/utils/form.util';
import { fragment, sectionView } from '../../../shared/utils/portal-view.util';
import { Account } from '../../entities/account.entity';
import { Business } from '../../entities/business.entity';
import { RequirementInput } from '../../entities/requirement.entity';
import { KYC_FILE_TYPES } from '../../services/kyc-storage.service';
import { KycService, OnboardingStage } from '../../services/kyc.service';

const KYC_UPLOAD = FileInterceptor('file', {
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
const BASE = '/merchant/settings/onboarding';

/**
 * Onboarding, under the merchant's Settings: the documents their country
 * asks for, each uploaded in a drawer, then sent to the SaveApp team for
 * review. After a
 * rejection, items that need changes show the reviewer's comment and can be
 * replaced and resubmitted.
 */
@ApiExcludeController()
@Controller('merchant/settings/onboarding')
@Portal(...MERCHANT_LEVELS)
@RequirePermission(SetPermission.MerchantKycSubmit)
export class MerchantOnboardingViewController {
  constructor(private readonly kycService: KycService) {}

  private business(req: Request): Business {
    return (req['account'] as Account).business;
  }

  @Get()
  async page(@Req() req: Request, @Res() res: Response) {
    const business = this.business(req);
    const kyc = await this.kycService.forBusiness(business);
    const requirements = await this.kycService.requirementsFor(business);
    const stage = this.kycService.stage(business, kyc);
    const progress = this.kycService.progress(requirements, kyc.kyc ?? []);
    return res.render(
      'pages/settings/onboarding',
      sectionView(PORTALS.merchant, req, 'settings', 'Onboarding', {
        business: {
          name: business.name,
          country: business.country?.name ?? 'No country',
        },
        stage,
        isDraft: stage === OnboardingStage.Draft,
        isReview: stage === OnboardingStage.Review,
        isRejected: stage === OnboardingStage.Rejected,
        isApproved: stage === OnboardingStage.Approved,
        isSuspended: stage === OnboardingStage.Suspended,
        editable: this.kycService.editable(stage),
        canSubmit:
          this.kycService.editable(stage) &&
          !progress.missing &&
          !progress.rejected,
        reviewNote: kyc.reviewNote,
        steps: this.kycService.steps(stage),
        progress,
        items: this.kycService.rows(requirements, kyc),
      }),
    );
  }

  @Get(':requirementId/submit')
  async submitForm(
    @Req() req: Request,
    @Res() res: Response,
    @Param('requirementId', ParseIntPipe) requirementId: number,
  ) {
    const requirement = await this.requirement(req, requirementId);
    if (!requirement)
      return res
        .status(404)
        .json({ ok: false, message: 'Requirement not found' });
    return fragment(res, 'kyc/submit_form', this.formContext(requirement, {}));
  }

  @Post('submit')
  async submit(@Req() req: Request, @Res() res: Response) {
    const business = this.business(req);
    try {
      await this.kycService.submit(
        business,
        await this.kycService.forBusiness(business),
      );
      return res.json({
        ok: true,
        message:
          'Sent for review. We will email you once the SaveApp team has checked it.',
        redirect: '/merchant',
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return res.status(400).json({ ok: false, message: error.message });
    }
  }

  @Post(':requirementId')
  @UseInterceptors(KYC_UPLOAD)
  async saveItem(
    @Req() req: Request,
    @Res() res: Response,
    @Param('requirementId', ParseIntPipe) requirementId: number,
    @Body('value') value?: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const business = this.business(req);
    const kyc = await this.kycService.forBusiness(business);
    const requirement = await this.requirement(req, requirementId);
    if (!requirement)
      return res
        .status(404)
        .json({ ok: false, message: 'Requirement not found' });
    if (!this.kycService.editable(this.kycService.stage(business, kyc)))
      return res.status(409).json({
        ok: false,
        message: 'Your documents are locked while they are reviewed',
      });
    try {
      await this.kycService.submitItem(kyc, requirement, value, file);
      return res.json({
        ok: true,
        message: `${requirement.name} saved`,
        reload: true,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'kyc/submit_form',
        this.formContext(requirement, error.errors, value),
        422,
      );
    }
  }

  private async requirement(req: Request, id: number) {
    const requirements = await this.kycService.requirementsFor(
      this.business(req),
    );
    return requirements.find((item) => item.id === id) ?? null;
  }

  private formContext(
    requirement: {
      id: number;
      name: string;
      comment: string;
      input: RequirementInput;
    },
    errors: Record<string, string>,
    value?: string,
  ) {
    return {
      action: `${BASE}/${requirement.id}`,
      requirement,
      isFile: requirement.input === RequirementInput.FILE,
      isNumber: requirement.input === RequirementInput.NUMBER,
      acceptTypes: Object.keys(KYC_FILE_TYPES).join(','),
      value,
      errors,
    };
  }
}
