import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Portal } from '../../../authentication/decorators/portal.decorator';
import { ForbiddenPageException } from '../../../authentication/filters/redirect.filter';
import { RequirePermission } from '../../../authorization/decorators/require-permission.decorator';
import {
  AuthorizationLevel,
  SetPermission,
} from '../../../authorization/entities/permission.entity';
import {
  Business,
  OnboardingStatus,
} from '../../../onboarding/entities/business.entity';
import { ReviewStatus } from '../../../onboarding/entities/kyc.entity';
import {
  KycService,
  OnboardingStage,
} from '../../../onboarding/services/kyc.service';
import { PORTALS } from '../../../shared/constants/portals';
import { FormError } from '../../../shared/utils/form.util';
import {
  formatDate,
  fragment,
  imageUrl,
  initials,
  pager,
  portalView,
} from '../../../shared/utils/portal-view.util';
import {
  ItemDecision,
  KycReviewService,
  ReviewOutcome,
} from '../../services/kyc-review.service';
import {
  MerchantAdminService,
  MerchantFilter,
  MerchantRow,
  STATUS_ACTIONS,
} from '../../services/merchant-admin.service';
import {
  MerchantWorkspaceService,
  WorkspaceTab,
} from '../../services/merchant-workspace.service';
import { AnalyticsPresenter } from '../../../analytics/services/analytics-presenter.service';
import { OverviewPresenter } from '../../../analytics/services/overview-presenter.service';

const BASE = '/admin/merchants';

const TABS = [
  { value: '', label: 'All', key: 'all' },
  { value: MerchantFilter.Review, label: 'Awaiting review' },
  { value: MerchantFilter.Onboarding, label: 'Still onboarding' },
  { value: MerchantFilter.Approved, label: 'Approved' },
  { value: MerchantFilter.Rejected, label: 'Rejected' },
  { value: MerchantFilter.Suspended, label: 'Suspended' },
];

const STAGE_LABELS: Record<OnboardingStage, string> = {
  [OnboardingStage.Draft]: 'Still onboarding',
  [OnboardingStage.Review]: 'Awaiting review',
  [OnboardingStage.Rejected]: 'Rejected',
  [OnboardingStage.Approved]: 'Approved',
  [OnboardingStage.Suspended]: 'Suspended',
};

/** Parses review fields `decision_<requirementId>` / `comment_<requirementId>`. */
const decisionsFrom = (body: Record<string, unknown>): ItemDecision[] =>
  Object.entries(body)
    .filter(([key]) => key.startsWith('decision_'))
    .map(([key, raw]) => {
      const requirementId = Number(key.slice('decision_'.length));
      // A pending placeholder and a chosen radio can arrive together
      const values = (Array.isArray(raw) ? raw : [raw]).map(String);
      const chosen =
        values
          .filter((value) => value !== String(ReviewStatus.Pending))
          .pop() ?? ReviewStatus.Pending;
      const comment = body[`comment_${requirementId}`];
      return {
        requirementId,
        status: Object.values(ReviewStatus).includes(chosen as ReviewStatus)
          ? (chosen as ReviewStatus)
          : ReviewStatus.Pending,
        comment: typeof comment === 'string' ? comment : undefined,
      };
    });

/**
 * Merchants for the SaveApp team: the list (search and status filter) and
 * each merchant's workspace, where KYC is reviewed item by item and the
 * business approved, rejected, suspended or reactivated.
 */
@ApiExcludeController()
@Controller('admin/merchants')
@Portal(AuthorizationLevel.Staff)
@RequirePermission(SetPermission.StaffMerchantsView)
export class MerchantsViewController {
  constructor(
    private readonly merchantAdmin: MerchantAdminService,
    private readonly workspace: MerchantWorkspaceService,
    private readonly overviewPresenter: OverviewPresenter,
    private readonly analyticsPresenter: AnalyticsPresenter,
    private readonly kycReview: KycReviewService,
    private readonly kycService: KycService,
  ) {}

  /* ------------------------------ List ----------------------------- */

  @Get()
  async page(
    @Req() req: Request,
    @Res() res: Response,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page = '1',
  ) {
    const counts = await this.merchantAdmin.counts();
    return res.render(
      'pages/merchants/index',
      portalView(PORTALS.admin, req, 'Merchants', {
        q,
        status,
        tabs: TABS.map((tab) => ({
          ...tab,
          count: counts[tab.value || 'all'] ?? 0,
          active: tab.value === status,
        })),
        ...(await this.table(q, status, Number(page))),
      }),
    );
  }

  @Get('table')
  async tableFragment(
    @Res() res: Response,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page = '1',
  ) {
    return fragment(
      res,
      'merchants/table',
      await this.table(q, status, Number(page)),
    );
  }

  /* --------------------------- Workspace --------------------------- */

  @Get(':id')
  async overview(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const business = await this.load(res, id);
    if (!business) return;
    const kyc = await this.kycService.forBusiness(business);
    const stage = this.kycService.stage(business, kyc);
    const requirements = await this.kycService.requirementsFor(business);
    const members = await this.merchantAdmin.members(business.id);
    const permissions = (req['permissions'] as string[]) ?? [];
    const activity =
      business.status === OnboardingStatus.Approved
        ? await this.overviewPresenter.merchant(
            business.id,
            [
              SetPermission.MerchantCardsView,
              SetPermission.MerchantCredentialsView,
            ],
            this.workspace.base(business),
          )
        : {};
    return this.render(req, res, business, 'overview', 'Overview', {
      ...activity,
      details: [
        { label: 'Email', value: business.email },
        { label: 'Phone', value: business.phone },
        { label: 'Address', value: business.address },
        { label: 'Country', value: business.country?.name ?? 'Not set' },
        {
          label: 'Type',
          value:
            business.type === AuthorizationLevel.WhiteLabel
              ? 'White-label merchant'
              : 'Merchant (B2B)',
        },
        { label: 'Created', value: formatDate(business.createdAt) },
        {
          label: 'Submitted for review',
          value: formatDate(kyc.submittedAt) ?? 'Not yet',
        },
      ],
      stageLabel: STAGE_LABELS[stage],
      isReview: stage === OnboardingStage.Review,
      reviewNote: kyc.reviewNote,
      progress: this.kycService.progress(requirements, kyc.kyc ?? []),
      members: members.map((account) => ({
        name: account.user.fullName,
        email: account.user.email,
        initials: initials(account.user.fullName),
        active: account.active,
        joined: formatDate(account.createdAt),
      })),
      actions: permissions.includes(SetPermission.StaffMerchantsApprove)
        ? Object.entries(STATUS_ACTIONS)
            .filter(([, action]) => action.from === business.status)
            .map(([key, action]) => ({
              key,
              label: action.label,
              danger: key === 'suspend',
              text:
                key === 'suspend'
                  ? `${business.name}'s team loses access to the merchant portal until you reactivate it.`
                  : `${business.name}'s team can use the merchant portal again.`,
            }))
        : [],
    });
  }

  /** The merchant's Analytics page, as the merchant sees it. */
  @Get(':id/analytics')
  async analytics(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Query('days') days = '30',
  ) {
    const business = await this.load(res, id);
    if (!business) return;
    const context = await this.analyticsPresenter.page(
      { businessId: business.id, days: this.analyticsPresenter.range(days) },
      {
        admin: false,
        showFilter: false,
        base: `${this.workspace.base(business)}/analytics`,
      },
    );
    return this.render(req, res, business, 'analytics', 'Analytics', context);
  }

  /** Members with their roles, and invitations (read only). */
  @Get(':id/team')
  async team(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const business = await this.load(res, id);
    if (!business) return;
    const [members, roles, invites] = await Promise.all([
      this.merchantAdmin.members(business.id),
      this.merchantAdmin.memberRoles(business.id),
      this.merchantAdmin.invites(business.id),
    ]);
    return this.render(req, res, business, 'team', 'Team', {
      members: members.map((account) => ({
        name: account.user.fullName,
        email: account.user.email,
        phone: account.user.phoneNumber,
        initials: initials(account.user.fullName),
        photo: imageUrl(account.user.profile),
        roles: roles.get(account.id) ?? [],
        active: account.active,
        joined: formatDate(account.createdAt),
      })),
      invites: invites.map((invite) => ({
        email: invite.email,
        status: invite.status,
        tone:
          invite.status === 'Accepted'
            ? 'success'
            : invite.status === 'Pending'
              ? 'warning'
              : 'neutral',
        sent: formatDate(invite.createdAt),
      })),
    });
  }

  @Get(':id/kyc')
  async kyc(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const business = await this.load(res, id);
    if (!business) return;
    const kyc = await this.kycService.forBusiness(business);
    const stage = this.kycService.stage(business, kyc);
    const requirements = await this.kycService.requirementsFor(business);
    const current = new Set(requirements.map((item) => item.id));
    const permissions = (req['permissions'] as string[]) ?? [];
    const canReview = permissions.includes(
      SetPermission.StaffMerchantsKycReview,
    );
    return this.render(req, res, business, 'kyc', 'KYC documents', {
      stageLabel: STAGE_LABELS[stage],
      isReview: stage === OnboardingStage.Review,
      isDraft: stage === OnboardingStage.Draft,
      reviewNote: kyc.reviewNote,
      progress: this.kycService.progress(requirements, kyc.kyc ?? []),
      items: this.kycService.rows(requirements, kyc),
      // Answers to requirements that were removed after submission
      retired: (kyc.kyc ?? [])
        .filter(
          (item) => item.value !== null && !current.has(item.requirementId),
        )
        .map((item) => this.kycService.itemView(item)),
      canReview,
      canDecide:
        canReview &&
        stage === OnboardingStage.Review &&
        permissions.includes(SetPermission.StaffMerchantsApprove),
      hasSubmissions: (kyc.kyc ?? []).some((item) => item.value !== null),
    });
  }

  @Post(':id/kyc')
  @RequirePermission(SetPermission.StaffMerchantsKycReview)
  async review(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    const business = await this.merchantAdmin.find(id);
    if (!business)
      return res.status(404).json({ ok: false, message: 'Merchant not found' });
    const outcome: ReviewOutcome =
      body.outcome === 'approve' || body.outcome === 'reject'
        ? body.outcome
        : 'save';
    const permissions = (req['permissions'] as string[]) ?? [];
    if (
      outcome !== 'save' &&
      !permissions.includes(SetPermission.StaffMerchantsApprove)
    )
      throw new ForbiddenPageException(PORTALS.admin.basePath);
    try {
      const message = await this.kycReview.review(
        business,
        await this.kycService.forBusiness(business),
        decisionsFrom(body),
        outcome,
        typeof body.note === 'string' ? body.note : undefined,
      );
      return res.json({ ok: true, message, reload: true });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return res.status(400).json({ ok: false, message: error.message });
    }
  }

  @Post(':id/status')
  @RequirePermission(SetPermission.StaffMerchantsApprove)
  async changeStatus(
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body('action') action: string,
    @Body('note') note?: string,
  ) {
    const business = await this.merchantAdmin.find(id);
    if (!business)
      return res.status(404).json({ ok: false, message: 'Merchant not found' });
    try {
      const status = await this.merchantAdmin.changeStatus(
        business,
        action,
        note,
      );
      return res.json({
        ok: true,
        message: `${business.name} is now ${status.toLowerCase()} · team notified`,
        reload: true,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return res.status(400).json({ ok: false, message: error.message });
    }
  }

  /* --------------------------- Helpers ----------------------------- */

  private load(res: Response, id: number): Promise<Business | null> {
    return this.workspace.load(res, id);
  }

  private render(
    req: Request,
    res: Response,
    business: Business,
    tab: WorkspaceTab,
    title: string,
    context: Record<string, unknown>,
  ) {
    return this.workspace.render(req, res, business, tab, title, context);
  }

  private card(business: Business) {
    return this.workspace.card(business);
  }

  private async table(q: string, status: string, page: number) {
    const result = await this.merchantAdmin.search(q, status, page);
    return {
      merchants: result.items.map((business: MerchantRow) => {
        const inReview = Boolean(
          business.status === OnboardingStatus.Pending &&
          business.kycRecord?.submittedAt,
        );
        return {
          ...this.card(business),
          href: `${BASE}/${business.id}`,
          type:
            business.type === AuthorizationLevel.WhiteLabel
              ? 'White-label'
              : 'B2B',
          stageLabel: inReview
            ? 'Awaiting review'
            : business.status === OnboardingStatus.Pending
              ? 'Still onboarding'
              : null,
          created: formatDate(business.createdAt),
        };
      }),
      filtered: Boolean(q || status),
      ...pager(result, `${BASE}/table`, { q, status }),
    };
  }
}
