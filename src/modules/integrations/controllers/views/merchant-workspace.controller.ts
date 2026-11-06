import {
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
import { RequirePermission } from '../../../authorization/decorators/require-permission.decorator';
import {
  AuthorizationLevel,
  SetPermission,
} from '../../../authorization/entities/permission.entity';
import { CredentialScopes } from '../../../credentials/entities/scope.entity';
import { MerchantWorkspaceService } from '../../../management/services/merchant-workspace.service';
import {
  formatDate,
  fragment,
  pager,
} from '../../../shared/utils/portal-view.util';
import { DeliveryStatus } from '../../entities/webhook.entity';
import { CardService } from '../../services/card.service';
import {
  CardsPresenter,
  formatDateTime,
} from '../../services/cards-presenter.service';
import { CredentialService } from '../../services/credential.service';
import { TransactionsPresenter } from '../../services/transactions-presenter.service';
import { WebhookLogService } from '../../services/webhook-log.service';
import { WebhookService } from '../../services/webhook.service';

const SCOPE_LABELS: Record<CredentialScopes, string> = {
  [CredentialScopes.Card]: 'Cards',
  [CredentialScopes.WalletAsService]: 'Wallet as a service',
};

/**
 * The admin's merchant workspace sections that live with the card and API
 * features: Cards, Transactions and Integrations, read only for the SaveApp
 * team (no full card details, no key or webhook changes). Pages render in
 * the workspace shell from MerchantWorkspaceService.
 */
@ApiExcludeController()
@Controller('admin/merchants/:merchantId/cards')
@Portal(AuthorizationLevel.Staff)
@RequirePermission(SetPermission.StaffMerchantsView)
export class MerchantCardsWorkspaceController {
  constructor(
    private readonly workspace: MerchantWorkspaceService,
    private readonly cardService: CardService,
    private readonly presenter: CardsPresenter,
  ) {}

  @Get()
  async page(
    @Req() req: Request,
    @Res() res: Response,
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page = '1',
  ) {
    const business = await this.workspace.load(res, merchantId);
    if (!business) return;
    const base = `${this.workspace.base(business)}/cards`;
    return this.workspace.render(req, res, business, 'cards', 'Cards', {
      q,
      status,
      tableUrl: `${base}/table`,
      tabs: await this.presenter.tabs(business.id, status),
      ...(await this.presenter.table(
        business.id,
        q,
        status,
        Number(page),
        base,
      )),
    });
  }

  @Get('table')
  async table(
    @Res() res: Response,
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page = '1',
  ) {
    return fragment(
      res,
      'cards/table',
      await this.presenter.table(
        merchantId,
        q,
        status,
        Number(page),
        `/admin/merchants/${merchantId}/cards`,
      ),
    );
  }

  @Get(':id')
  async drawer(
    @Res() res: Response,
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const card = await this.cardService.findInBusiness(merchantId, id);
    if (!card)
      return res.status(404).json({ ok: false, message: 'Card not found' });
    // Full card details stay with the merchant: no reveal for staff
    return fragment(
      res,
      'cards/drawer',
      await this.presenter.drawer(
        card,
        `/admin/merchants/${merchantId}/cards`,
        null,
      ),
    );
  }

  @Get(':id/live')
  async live(
    @Res() res: Response,
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const card = await this.cardService.findInBusiness(merchantId, id);
    if (!card)
      return res.status(404).json({ ok: false, message: 'Card not found' });
    return fragment(
      res,
      'cards/live',
      await this.presenter.live(
        card,
        `/admin/merchants/${merchantId}/transactions`,
      ),
    );
  }
}

@ApiExcludeController()
@Controller('admin/merchants/:merchantId/transactions')
@Portal(AuthorizationLevel.Staff)
@RequirePermission(SetPermission.StaffMerchantsView)
export class MerchantTransactionsWorkspaceController {
  constructor(
    private readonly workspace: MerchantWorkspaceService,
    private readonly presenter: TransactionsPresenter,
  ) {}

  @Get()
  async page(
    @Req() req: Request,
    @Res() res: Response,
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page = '1',
  ) {
    const business = await this.workspace.load(res, merchantId);
    if (!business) return;
    const base = `${this.workspace.base(business)}/transactions`;
    return this.workspace.render(
      req,
      res,
      business,
      'transactions',
      'Transactions',
      {
        q,
        status,
        tableUrl: `${base}/table`,
        syncUrl: `${base}/sync`,
        ...(await this.presenter.summary(business.id, status)),
        ...(await this.presenter.table(
          business.id,
          q,
          status,
          Number(page),
          base,
          `${this.workspace.base(business)}/cards`,
        )),
      },
    );
  }

  @Get('table')
  async table(
    @Res() res: Response,
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page = '1',
  ) {
    const base = `/admin/merchants/${merchantId}`;
    return fragment(
      res,
      'transactions/table',
      await this.presenter.table(
        merchantId,
        q,
        status,
        Number(page),
        `${base}/transactions`,
        `${base}/cards`,
      ),
    );
  }

  /** Staff may pull the merchant's latest transactions from UnionPay too. */
  @Post('sync')
  async sync(
    @Res() res: Response,
    @Param('merchantId', ParseIntPipe) merchantId: number,
  ) {
    return res.json(await this.presenter.sync(merchantId));
  }
}

@ApiExcludeController()
@Controller('admin/merchants/:merchantId/integrations')
@Portal(AuthorizationLevel.Staff)
@RequirePermission(SetPermission.StaffMerchantsView)
export class MerchantIntegrationsWorkspaceController {
  constructor(
    private readonly workspace: MerchantWorkspaceService,
    private readonly credentialService: CredentialService,
    private readonly webhookService: WebhookService,
    private readonly webhookLogService: WebhookLogService,
  ) {}

  /** API keys, webhook endpoints and event logs, read only. */
  @Get()
  async page(
    @Req() req: Request,
    @Res() res: Response,
    @Param('merchantId', ParseIntPipe) merchantId: number,
  ) {
    const business = await this.workspace.load(res, merchantId);
    if (!business) return;
    const [credentials, webhooks, counts] = await Promise.all([
      this.credentialService.list(business.id),
      this.webhookService.list(business.id),
      this.webhookLogService.counts(business.id),
    ]);
    return this.workspace.render(
      req,
      res,
      business,
      'integrations',
      'Integrations',
      {
        credentials: credentials.map((credential) => ({
          name: credential.name,
          hint: credential.hint,
          scopes: credential.scopes.map((scope) => SCOPE_LABELS[scope]),
          ips: (credential.ips ?? []).join(', '),
          active: credential.active,
          created: formatDate(credential.createdAt),
          lastUsed: formatDateTime(credential.lastUsedAt),
        })),
        webhooks: webhooks.map((webhook) => ({
          url: webhook.url,
          active: webhook.active,
          lastDelivery: formatDateTime(webhook.lastDeliveryAt),
          lastStatus: webhook.lastStatus,
          delivered: webhook.lastStatus === DeliveryStatus.Delivered,
          lastError: webhook.lastError,
        })),
        eventCounts: {
          all: counts.all ?? 0,
          delivered: counts[DeliveryStatus.Delivered] ?? 0,
          failed: counts[DeliveryStatus.Failed] ?? 0,
        },
        eventsUrl: `${this.workspace.base(business)}/integrations/events`,
        ...(await this.events(business.id, 1)),
      },
    );
  }

  @Get('events')
  async eventsTable(
    @Res() res: Response,
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Query('page') page = '1',
  ) {
    return fragment(
      res,
      'merchants/events_table',
      await this.events(merchantId, Number(page)),
    );
  }

  @Get('events/:id')
  async eventDrawer(
    @Res() res: Response,
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const delivery = await this.webhookLogService.findInBusiness(
      merchantId,
      id,
    );
    if (!delivery)
      return res.status(404).json({ ok: false, message: 'Event not found' });
    let pretty = delivery.payload;
    try {
      pretty = JSON.stringify(JSON.parse(delivery.payload), null, 2);
    } catch {
      // Keep the raw text
    }
    return fragment(res, 'integrations/event_drawer', {
      delivery: {
        eventId: delivery.eventId,
        event: delivery.event,
        url: delivery.url,
        delivered: delivery.status === DeliveryStatus.Delivered,
        status: delivery.status,
        error: delivery.error,
        duration: delivery.durationMs,
        when: formatDateTime(delivery.createdAt),
        payload: pretty,
      },
    });
  }

  private async events(businessId: number, page: number) {
    const result = await this.webhookLogService.search(businessId, {}, page);
    const base = `/admin/merchants/${businessId}/integrations/events`;
    return {
      deliveries: result.items.map((delivery) => ({
        drawerUrl: `${base}/${delivery.id}`,
        eventId: delivery.eventId,
        event: delivery.event,
        url: delivery.url,
        delivered: delivery.status === DeliveryStatus.Delivered,
        status: delivery.status,
        duration: delivery.durationMs,
        when: formatDateTime(delivery.createdAt),
      })),
      ...pager(result, base, {}),
    };
  }
}
