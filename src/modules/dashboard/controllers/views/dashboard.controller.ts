import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Portal } from '../../../authentication/decorators/portal.decorator';
import { User } from '../../../authentication/entities/user.entity';
import {
  AuthorizationLevel,
  MERCHANT_LEVELS,
  SetPermission,
} from '../../../authorization/entities/permission.entity';
import { InviteService } from '../../../authorization/services/invite.service';
import { scopeFor } from '../../../authorization/services/role.service';
import { TeamService } from '../../../authorization/services/team.service';
import { Account } from '../../../onboarding/entities/account.entity';
import {
  KycService,
  OnboardingStage,
} from '../../../onboarding/services/kyc.service';
import { PORTALS } from '../../../shared/constants/portals';
import {
  formatDate,
  imageUrl,
  initials,
  portalView,
} from '../../../shared/utils/portal-view.util';
import {
  MerchantAdminService,
  MerchantFilter,
} from '../../../management/services/merchant-admin.service';
import { AnalyticsService } from '../../../analytics/services/analytics.service';
import {
  OVERVIEW_DAYS,
  OverviewPresenter,
  ago,
  count,
  moneyTiles,
  percent,
  transactionRow,
} from '../../../analytics/services/overview-presenter.service';

/** Admin overview: merchants by status and the queue waiting for review. */
@ApiExcludeController()
@Controller('admin')
@Portal(AuthorizationLevel.Staff)
export class AdminDashboardController {
  constructor(
    private readonly merchantAdmin: MerchantAdminService,
    private readonly teamService: TeamService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get()
  async page(@Req() req: Request, @Res() res: Response) {
    const permissions = (req['permissions'] as string[]) ?? [];
    const canSeeMerchants = permissions.includes(
      SetPermission.StaffMerchantsView,
    );
    const counts = canSeeMerchants ? await this.merchantAdmin.counts() : {};
    const queue = canSeeMerchants
      ? await this.merchantAdmin.awaitingReview(6)
      : [];
    const team = await this.teamService.counts(
      scopeFor(req['account'] as Account),
    );
    // SaveApp-wide card activity for the last 30 days
    let activity: Record<string, unknown> = {};
    if (canSeeMerchants) {
      const { current, previous } = this.analytics.window(OVERVIEW_DAYS);
      const scope = { businessId: null, days: OVERVIEW_DAYS } as const;
      const [now, before, cards, recent, merchants] = await Promise.all([
        this.analytics.totals(scope, current),
        this.analytics.totals(scope, previous),
        this.analytics.cardCounts(null),
        this.analytics.recentTransactions(null, 6),
        this.analytics.recentMerchants(5),
      ]);
      activity = {
        activityTiles: [
          {
            label: 'Active cards',
            icon: 'credit-card',
            value: count(cards.active),
            sub: `${count(cards.total)} issued, ${count(now.cardsIssued)} in ${OVERVIEW_DAYS} days`,
            href: '/admin/analytics',
          },
          ...moneyTiles(now, before, '/admin').map((item) => ({
            ...item,
            href: '/admin/analytics',
          })),
          {
            label: 'Webhook delivery',
            icon: 'webhook',
            value: percent(now.delivered, now.deliveries),
            sub: now.deliveries
              ? `${count(now.deliveries)} events, ${now.avgDeliveryMs ?? 0} ms average`
              : `No events in ${OVERVIEW_DAYS} days`,
            href: '/admin/analytics',
          },
        ],
        recent: recent.map(transactionRow),
        newMerchants: merchants.map((merchant) => ({
          ...merchant,
          initials: initials(merchant.name),
          joined: ago(merchant.createdAt),
          tone:
            { Approved: 'success', Pending: 'warning', Rejected: 'danger' }[
              merchant.status
            ] ?? 'neutral',
          href: `/admin/merchants/${merchant.id}`,
        })),
      };
    }
    const tile = (label: string, filter: string, icon: string) => ({
      label,
      icon,
      value: counts[filter] ?? 0,
      href: `/admin/merchants?status=${filter}`,
    });
    return res.render(
      'pages/dashboard/admin',
      portalView(PORTALS.admin, req, 'Overview', {
        firstName: (req['user'] as User).fullName.split(' ')[0],
        canSeeMerchants,
        totalMerchants: counts.all ?? 0,
        tiles: [
          tile('Awaiting review', MerchantFilter.Review, 'inbox'),
          tile('Still onboarding', MerchantFilter.Onboarding, 'hourglass'),
          tile('Approved', MerchantFilter.Approved, 'badge-check'),
          tile('Rejected', MerchantFilter.Rejected, 'circle-x'),
          tile('Suspended', MerchantFilter.Suspended, 'circle-pause'),
        ],
        queue: queue.map((business) => ({
          name: business.name,
          email: business.email,
          initials: initials(business.name),
          logo: imageUrl(business.logo),
          country: business.country?.name ?? 'No country',
          submitted: formatDate(business.kycRecord?.submittedAt),
          href: `/admin/merchants/${business.id}/kyc`,
        })),
        teamActive: team.active,
        ...activity,
      }),
    );
  }
}

/**
 * Merchant overview. Until the business is approved it shows where
 * onboarding stands (stepper, checklist, rejected items); afterwards a short
 * summary of the business and its team.
 */
@ApiExcludeController()
@Controller('merchant')
@Portal(...MERCHANT_LEVELS)
export class MerchantDashboardController {
  constructor(
    private readonly kycService: KycService,
    private readonly teamService: TeamService,
    private readonly inviteService: InviteService,
    private readonly overview: OverviewPresenter,
  ) {}

  @Get()
  async page(@Req() req: Request, @Res() res: Response) {
    const account = req['account'] as Account;
    const business = account.business;
    const permissions = (req['permissions'] as string[]) ?? [];
    const kyc = await this.kycService.forBusiness(business);
    const stage = this.kycService.stage(business, kyc);
    const requirements = await this.kycService.requirementsFor(business);
    const progress = this.kycService.progress(requirements, kyc.kyc ?? []);
    const rows = this.kycService.rows(requirements, kyc);
    const scope = scopeFor(account);
    const team = await this.teamService.counts(scope);
    const context = {
      firstName: (req['user'] as User).fullName.split(' ')[0],
      business: {
        name: business.name,
        email: business.email,
        phone: business.phone,
        address: business.address,
        country: business.country?.name ?? 'Not set',
        flag: business.country?.logo,
        logo: imageUrl(business.logo),
        initials: initials(business.name),
      },
      stage,
      isDraft: stage === OnboardingStage.Draft,
      isReview: stage === OnboardingStage.Review,
      isRejected: stage === OnboardingStage.Rejected,
      isSuspended: stage === OnboardingStage.Suspended,
      canVerify: permissions.includes(SetPermission.MerchantKycSubmit),
      steps: this.kycService.steps(stage),
      progress,
      reviewNote: kyc.reviewNote,
      submitted: formatDate(kyc.submittedAt),
      rejectedItems: rows.filter((row) => row.submission?.isRejected),
      checklist: rows,
      team: {
        active: team.active,
        invites: await this.inviteService.countPending(scope),
      },
    };
    const approved = stage === OnboardingStage.Approved;
    return res.render(
      approved
        ? 'pages/dashboard/merchant'
        : 'pages/dashboard/merchant-onboarding',
      portalView(PORTALS.merchant, req, 'Overview', {
        ...context,
        ...(approved
          ? await this.overview.merchant(business.id, permissions)
          : {}),
      }),
    );
  }
}
