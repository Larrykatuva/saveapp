import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  ApprovedOnly,
  Portal,
} from '../../../authentication/decorators/portal.decorator';
import { RequirePermission } from '../../../authorization/decorators/require-permission.decorator';
import {
  MERCHANT_LEVELS,
  SetPermission,
} from '../../../authorization/entities/permission.entity';
import { Account } from '../../../onboarding/entities/account.entity';
import { PORTALS } from '../../../shared/constants/portals';
import { fragment, portalView } from '../../../shared/utils/portal-view.util';
import { TransactionsPresenter } from '../../services/transactions-presenter.service';

const BASE = '/merchant/transactions';

/**
 * Every card transaction of the business in one table, pulled from UnionPay
 * and stored (TransactionService). Rows open the card's drawer.
 */
@ApiExcludeController()
@Controller('merchant/transactions')
@Portal(...MERCHANT_LEVELS)
@ApprovedOnly()
@RequirePermission(SetPermission.MerchantCardsView)
export class TransactionsViewController {
  constructor(private readonly presenter: TransactionsPresenter) {}

  private businessId(req: Request) {
    return (req['account'] as Account).business.id;
  }

  @Get()
  async page(
    @Req() req: Request,
    @Res() res: Response,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page = '1',
  ) {
    const businessId = this.businessId(req);
    return res.render(
      'pages/transactions/index',
      portalView(PORTALS.merchant, req, 'Transactions', {
        q,
        status,
        ...(await this.presenter.summary(businessId, status)),
        ...(await this.presenter.table(
          businessId,
          q,
          status,
          Number(page),
          BASE,
          '/merchant/cards',
        )),
      }),
    );
  }

  @Get('table')
  async tableFragment(
    @Req() req: Request,
    @Res() res: Response,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page = '1',
  ) {
    return fragment(
      res,
      'transactions/table',
      await this.presenter.table(
        this.businessId(req),
        q,
        status,
        Number(page),
        BASE,
        '/merchant/cards',
      ),
    );
  }

  /** Pulls the business's cards from UnionPay ("Refresh", and on open). */
  @Post('sync')
  async sync(@Req() req: Request, @Res() res: Response) {
    return res.json(await this.presenter.sync(this.businessId(req)));
  }
}
