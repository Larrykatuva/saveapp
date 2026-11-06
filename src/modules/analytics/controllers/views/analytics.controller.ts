import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  ApprovedOnly,
  Portal,
} from '../../../authentication/decorators/portal.decorator';
import { RequirePermission } from '../../../authorization/decorators/require-permission.decorator';
import {
  AuthorizationLevel,
  MERCHANT_LEVELS,
  SetPermission,
} from '../../../authorization/entities/permission.entity';
import { Account } from '../../../onboarding/entities/account.entity';
import { PORTALS } from '../../../shared/constants/portals';
import { portalView } from '../../../shared/utils/portal-view.util';
import { AnalyticsPresenter } from '../../services/analytics-presenter.service';

/** Analytics of the merchant's own business. */
@ApiExcludeController()
@Controller('merchant/analytics')
@Portal(...MERCHANT_LEVELS)
@ApprovedOnly()
@RequirePermission(SetPermission.MerchantCardsView)
export class MerchantAnalyticsViewController {
  constructor(private readonly presenter: AnalyticsPresenter) {}

  @Get()
  async page(
    @Req() req: Request,
    @Res() res: Response,
    @Query('days') days = '30',
  ) {
    const businessId = (req['account'] as Account).business.id;
    const context = await this.presenter.page(
      { businessId, days: this.presenter.range(days) },
      { admin: false, base: '/merchant/analytics' },
    );
    return res.render(
      'pages/analytics/index',
      portalView(PORTALS.merchant, req, 'Analytics', context),
    );
  }
}

/** Analytics of all of SaveApp, or of one merchant picked in the filter. */
@ApiExcludeController()
@Controller('admin/analytics')
@Portal(AuthorizationLevel.Staff)
@RequirePermission(SetPermission.StaffMerchantsView)
export class AdminAnalyticsViewController {
  constructor(private readonly presenter: AnalyticsPresenter) {}

  @Get()
  async page(
    @Req() req: Request,
    @Res() res: Response,
    @Query('days') days = '30',
    @Query('business') business = '',
  ) {
    const businessId = /^\d+$/.test(business) ? Number(business) : null;
    const context = await this.presenter.page(
      { businessId, days: this.presenter.range(days) },
      {
        admin: true,
        business: businessId ? String(businessId) : '',
        base: '/admin/analytics',
      },
    );
    return res.render(
      'pages/analytics/index',
      portalView(PORTALS.admin, req, 'Analytics', context),
    );
  }
}
