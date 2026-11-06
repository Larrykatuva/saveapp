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
import {
  ApprovedOnly,
  Portal,
} from '../../../authentication/decorators/portal.decorator';
import { ForbiddenPageException } from '../../../authentication/filters/redirect.filter';
import { RequirePermission } from '../../../authorization/decorators/require-permission.decorator';
import {
  MERCHANT_LEVELS,
  SetPermission,
} from '../../../authorization/entities/permission.entity';
import { CredentialScopes } from '../../../credentials/entities/scope.entity';
import { Account } from '../../../onboarding/entities/account.entity';
import { PORTALS, firstSectionPage } from '../../../shared/constants/portals';
import {
  FieldErrors,
  FormError,
  validateForm,
} from '../../../shared/utils/form.util';
import {
  formatDate,
  fragment,
  initials,
  pager,
  sectionView,
} from '../../../shared/utils/portal-view.util';
import { CredentialForm, WebhookForm } from '../../dtos/integrations-form.dtos';
import {
  DeliveryStatus,
  Webhook,
  WebhookEvent,
} from '../../entities/webhook.entity';
import { TOKEN_SECONDS } from '../../services/api-token.service';
import {
  AVAILABLE_SCOPES,
  CredentialInput,
  CredentialService,
  CredentialWithScopes,
  SCOPE_LABELS,
  parseIps,
} from '../../services/credential.service';
import { WebhookService } from '../../services/webhook.service';
import {
  EventLogFilters,
  WebhookLogService,
} from '../../services/webhook-log.service';

const BASE = '/merchant/integrations';
const P = SetPermission;

const formatDateTime = (value?: Date | string | null) =>
  value
    ? new Date(value).toLocaleString('en-KE', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

/**
 * Integrations for a merchant (laid out like Settings): API credentials
 * (client id and secret, scopes, IP whitelist) and webhook endpoints that
 * receive card events from UnionPay.
 */
@ApiExcludeController()
@Controller('merchant/integrations')
@Portal(...MERCHANT_LEVELS)
@ApprovedOnly()
export class IntegrationsViewController {
  constructor(
    private readonly credentialService: CredentialService,
    private readonly webhookService: WebhookService,
    private readonly webhookLogService: WebhookLogService,
  ) {}

  private account(req: Request) {
    return req['account'] as Account;
  }

  private canManage(req: Request) {
    return ((req['permissions'] as string[]) ?? []).includes(
      P.MerchantCredentialsManage,
    );
  }

  @Get()
  index(@Req() req: Request, @Res() res: Response) {
    const first = firstSectionPage(
      PORTALS.merchant,
      'integrations',
      (req['permissions'] as string[]) ?? [],
    );
    if (!first) throw new ForbiddenPageException(PORTALS.merchant.basePath);
    return res.redirect(first);
  }

  /* --------------------------- Credentials -------------------------- */

  @Get('credentials')
  @RequirePermission(P.MerchantCredentialsView, P.MerchantCredentialsManage)
  async credentials(@Req() req: Request, @Res() res: Response) {
    const origin = `${req.protocol}://${req.get('host')}`;
    return res.render(
      'pages/integrations/credentials',
      sectionView(PORTALS.merchant, req, 'integrations', 'Credentials', {
        canManage: this.canManage(req),
        apiBase: `${origin}/api`,
        docsUrl: `${origin}/docs`,
        tokenMinutes: TOKEN_SECONDS / 60,
        ...(await this.credentialsTable(req)),
      }),
    );
  }

  @Get('credentials/table')
  @RequirePermission(P.MerchantCredentialsView, P.MerchantCredentialsManage)
  async credentialsTableFragment(@Req() req: Request, @Res() res: Response) {
    return fragment(res, 'integrations/credentials_table', {
      canManage: this.canManage(req),
      ...(await this.credentialsTable(req)),
    });
  }

  @Get('credentials/new')
  @RequirePermission(P.MerchantCredentialsManage)
  newCredential(@Res() res: Response) {
    return fragment(
      res,
      'integrations/credential_form',
      this.credentialFormContext(
        `${BASE}/credentials`,
        { name: '', scopes: [CredentialScopes.Card], ips: '' },
        {},
      ),
    );
  }

  @Post('credentials')
  @RequirePermission(P.MerchantCredentialsManage)
  async createCredential(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: Record<string, unknown>,
  ) {
    const action = `${BASE}/credentials`;
    try {
      const input = await this.credentialInput(body);
      const account = this.account(req);
      const issued = await this.credentialService.create(
        account.business,
        account,
        input,
      );
      req.session.revealed = {
        credentialId: issued.credential.id,
        clientId: issued.clientId,
        clientSecret: issued.clientSecret,
      };
      return res.json({
        ok: true,
        message: `${input.name} created`,
        event: 'drawer:open',
        url: `${BASE}/credentials/${issued.credential.id}/reveal`,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'integrations/credential_form',
        this.credentialFormContext(action, this.formValues(body), error.errors),
        422,
      );
    }
  }

  /** Shows a new client id and/or secret once, then forgets it. */
  @Get('credentials/:id/reveal')
  @RequirePermission(P.MerchantCredentialsManage)
  revealCredential(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const revealed = req.session.revealed;
    delete req.session.revealed;
    return fragment(res, 'integrations/credential_reveal', {
      shown: revealed?.credentialId === id ? revealed : null,
    });
  }

  @Get('credentials/:id')
  @RequirePermission(P.MerchantCredentialsView, P.MerchantCredentialsManage)
  async credentialDrawer(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const credential = await this.findCredential(req, id);
    if (!credential)
      return res
        .status(404)
        .json({ ok: false, message: 'Credential not found' });
    return fragment(
      res,
      'integrations/credential_form',
      await this.editContext(req, credential, this.formValues(credential), {}),
    );
  }

  @Post('credentials/:id')
  @RequirePermission(P.MerchantCredentialsManage)
  async updateCredential(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    const credential = await this.findCredential(req, id);
    if (!credential)
      return res
        .status(404)
        .json({ ok: false, message: 'Credential not found' });
    try {
      const input = await this.credentialInput(body);
      await this.credentialService.updateDetails(
        credential,
        this.account(req),
        input,
      );
      return res.json({ ok: true, message: `${input.name} saved` });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'integrations/credential_form',
        await this.editContext(
          req,
          credential,
          this.formValues(body),
          error.errors,
        ),
        422,
      );
    }
  }

  @Post('credentials/:id/toggle')
  @RequirePermission(P.MerchantCredentialsManage)
  async toggleCredential(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const credential = await this.findCredential(req, id);
    if (!credential)
      return res
        .status(404)
        .json({ ok: false, message: 'Credential not found' });
    await this.credentialService.setActive(
      credential,
      this.account(req),
      !credential.active,
    );
    return res.json({
      ok: true,
      active: !credential.active,
      message: `${credential.name} ${credential.active ? 'deactivated' : 'activated'}`,
    });
  }

  @Post('credentials/:id/rotate')
  @RequirePermission(P.MerchantCredentialsManage)
  async rotateCredential(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const credential = await this.findCredential(req, id);
    if (!credential)
      return res
        .status(404)
        .json({ ok: false, message: 'Credential not found' });
    const clientSecret = await this.credentialService.rotate(
      credential,
      this.account(req),
    );
    req.session.revealed = { credentialId: credential.id, clientSecret };
    return res.json({
      ok: true,
      message: `New secret issued for ${credential.name}`,
      event: 'drawer:open',
      url: `${BASE}/credentials/${credential.id}/reveal`,
    });
  }

  /* ---------------------------- Webhooks ---------------------------- */

  @Get('webhooks')
  @RequirePermission(P.MerchantWebhooksManage)
  async webhooks(@Req() req: Request, @Res() res: Response) {
    return res.render(
      'pages/integrations/webhooks',
      sectionView(PORTALS.merchant, req, 'integrations', 'Webhooks', {
        ...(await this.webhooksTable(req)),
      }),
    );
  }

  @Get('webhooks/table')
  @RequirePermission(P.MerchantWebhooksManage)
  async webhooksTableFragment(@Req() req: Request, @Res() res: Response) {
    return fragment(
      res,
      'integrations/webhooks_table',
      await this.webhooksTable(req),
    );
  }

  @Get('webhooks/new')
  @RequirePermission(P.MerchantWebhooksManage)
  newWebhook(@Res() res: Response) {
    return fragment(res, 'integrations/webhook_form', {
      action: `${BASE}/webhooks`,
      values: { active: 'on' },
      errors: {},
    });
  }

  @Post('webhooks')
  @RequirePermission(P.MerchantWebhooksManage)
  async createWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: Record<string, unknown>,
  ) {
    const { values, errors } = await validateForm(WebhookForm, body);
    try {
      if (Object.keys(errors).length)
        throw new FormError('Please fix the highlighted fields', errors);
      const webhook = await this.webhookService.create(
        this.account(req).business,
        values.url,
        values.active === 'on',
      );
      return res.json({
        ok: true,
        message: 'Endpoint added. Copy its signing secret next.',
        event: 'drawer:open',
        url: `${BASE}/webhooks/${webhook.id}`,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'integrations/webhook_form',
        {
          action: `${BASE}/webhooks`,
          values: body,
          errors: error.errors,
          formError: Object.keys(error.errors).length
            ? undefined
            : error.message,
        },
        422,
      );
    }
  }

  @Get('webhooks/:id')
  @RequirePermission(P.MerchantWebhooksManage)
  async webhookDrawer(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const webhook = await this.findWebhook(req, id);
    if (!webhook)
      return res.status(404).json({ ok: false, message: 'Endpoint not found' });
    return fragment(
      res,
      'integrations/webhook_form',
      await this.webhookContext(webhook, {
        url: webhook.url,
        active: webhook.active ? 'on' : undefined,
      }),
    );
  }

  @Post('webhooks/:id')
  @RequirePermission(P.MerchantWebhooksManage)
  async updateWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    const webhook = await this.findWebhook(req, id);
    if (!webhook)
      return res.status(404).json({ ok: false, message: 'Endpoint not found' });
    const { values, errors } = await validateForm(WebhookForm, body);
    try {
      if (Object.keys(errors).length)
        throw new FormError('Please fix the highlighted fields', errors);
      await this.webhookService.edit(
        webhook,
        values.url,
        values.active === 'on',
      );
      return res.json({ ok: true, message: 'Endpoint saved' });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'integrations/webhook_form',
        await this.webhookContext(webhook, body, error.errors),
        422,
      );
    }
  }

  @Post('webhooks/:id/toggle')
  @RequirePermission(P.MerchantWebhooksManage)
  async toggleWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const webhook = await this.findWebhook(req, id);
    if (!webhook)
      return res.status(404).json({ ok: false, message: 'Endpoint not found' });
    await this.webhookService.update(
      { id: webhook.id },
      { active: !webhook.active },
    );
    return res.json({
      ok: true,
      active: !webhook.active,
      message: `Endpoint ${webhook.active ? 'paused' : 'turned on'}`,
    });
  }

  @Post('webhooks/:id/test')
  @RequirePermission(P.MerchantWebhooksManage)
  async testWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const webhook = await this.findWebhook(req, id);
    if (!webhook)
      return res.status(404).json({ ok: false, message: 'Endpoint not found' });
    const result = await this.webhookService.deliver(
      webhook,
      this.account(req).business.id,
      WebhookEvent.Test,
      { message: 'This is a test event from SaveApp' },
    );
    return res.status(result.ok ? 200 : 502).json({
      ok: result.ok,
      message: result.ok
        ? 'Test event delivered'
        : `Your endpoint did not accept the test event: ${result.error}`,
    });
  }

  @Post('webhooks/:id/rotate')
  @RequirePermission(P.MerchantWebhooksManage)
  async rotateWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const webhook = await this.findWebhook(req, id);
    if (!webhook)
      return res.status(404).json({ ok: false, message: 'Endpoint not found' });
    await this.webhookService.rotateSecret(webhook);
    return res.json({
      ok: true,
      message: 'New signing secret issued. Update your endpoint to use it.',
      event: 'drawer:open',
      url: `${BASE}/webhooks/${webhook.id}`,
    });
  }

  @Post('webhooks/:id/delete')
  @RequirePermission(P.MerchantWebhooksManage)
  async deleteWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const webhook = await this.findWebhook(req, id);
    if (!webhook)
      return res.status(404).json({ ok: false, message: 'Endpoint not found' });
    await this.webhookService.delete({ id: webhook.id });
    return res.json({ ok: true, message: 'Endpoint removed' });
  }

  /* --------------------------- Event logs --------------------------- */

  @Get('events')
  @RequirePermission(P.MerchantWebhooksManage)
  async events(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: EventLogFilters & { page?: string },
  ) {
    const businessId = this.account(req).business.id;
    const counts = await this.webhookLogService.counts(businessId);
    const webhooks = await this.webhookService.list(businessId);
    return res.render(
      'pages/integrations/events',
      sectionView(PORTALS.merchant, req, 'integrations', 'Event logs', {
        q: query.q ?? '',
        tabs: [
          { value: '', label: 'All', count: counts.all ?? 0 },
          ...Object.values(DeliveryStatus).map((status) => ({
            value: status,
            label: status,
            count: counts[status] ?? 0,
          })),
        ].map((tab) => ({
          ...tab,
          active: tab.value === (query.status ?? ''),
        })),
        events: Object.values(WebhookEvent).map((event) => ({
          value: event,
          selected: event === query.event,
        })),
        endpoints: webhooks.map((webhook) => ({
          id: webhook.id,
          url: webhook.url,
          selected: String(webhook.id) === query.webhook,
        })),
        ...(await this.eventsTable(req, query)),
      }),
    );
  }

  @Get('events/table')
  @RequirePermission(P.MerchantWebhooksManage)
  async eventsTableFragment(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: EventLogFilters & { page?: string },
  ) {
    return fragment(
      res,
      'integrations/events_table',
      await this.eventsTable(req, query),
    );
  }

  @Get('events/:id')
  @RequirePermission(P.MerchantWebhooksManage)
  async eventDrawer(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const delivery = await this.webhookLogService.findInBusiness(
      this.account(req).business.id,
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

  /* ----------------------------- Helpers ---------------------------- */

  private async eventsTable(
    req: Request,
    query: EventLogFilters & { page?: string },
  ) {
    const result = await this.webhookLogService.search(
      this.account(req).business.id,
      query,
      Number(query.page ?? 1),
    );
    return {
      deliveries: result.items.map((delivery) => ({
        id: delivery.id,
        eventId: delivery.eventId,
        event: delivery.event,
        url: delivery.url,
        delivered: delivery.status === DeliveryStatus.Delivered,
        status: delivery.status,
        duration: delivery.durationMs,
        when: formatDateTime(delivery.createdAt),
      })),
      filtered: Boolean(
        query.q || query.status || query.event || query.webhook,
      ),
      ...pager(result, `${BASE}/events/table`, {
        q: query.q,
        status: query.status,
        event: query.event,
        webhook: query.webhook,
      }),
    };
  }

  private findCredential(req: Request, id: number) {
    return this.credentialService.findInBusiness(
      this.account(req).business.id,
      id,
    );
  }

  private findWebhook(req: Request, id: number) {
    return this.webhookService.findInBusiness(
      this.account(req).business.id,
      id,
    );
  }

  /** Name, scopes and IP whitelist from the drawer, checked. */
  private async credentialInput(
    body: Record<string, unknown>,
  ): Promise<CredentialInput> {
    const { values, errors } = await validateForm(CredentialForm, body);
    const raw = body.scopes;
    const scopes = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
      (scope): scope is CredentialScopes =>
        Object.values(CredentialScopes).includes(scope as CredentialScopes),
    );
    const ips = parseIps(body.ips);
    if (ips.error) errors.ips = ips.error;
    if (!scopes.length)
      errors.scopes = 'Choose at least one thing this key can do';
    if (Object.keys(errors).length)
      throw new FormError('Please fix the highlighted fields', errors);
    return { name: values.name, scopes, ips: ips.ips };
  }

  private formValues(source: Record<string, unknown> | CredentialWithScopes) {
    const raw = (source as { scopes?: unknown }).scopes;
    const ips = (source as { ips?: unknown }).ips;
    return {
      name: (source as { name?: string }).name ?? '',
      scopes: (Array.isArray(raw) ? raw : raw ? [raw] : []) as string[],
      ips: Array.isArray(ips)
        ? ips.join('\n')
        : typeof ips === 'string'
          ? ips
          : '',
    };
  }

  private credentialFormContext(
    action: string,
    values: { name: string; scopes: string[]; ips: string },
    errors: FieldErrors,
  ) {
    return {
      action,
      values,
      errors,
      hasErrors: Object.keys(errors).length > 0,
      scopes: Object.values(CredentialScopes).map((scope) => ({
        value: scope,
        label: SCOPE_LABELS[scope],
        available: AVAILABLE_SCOPES.includes(scope),
        checked: values.scopes.includes(scope),
      })),
    };
  }

  private async editContext(
    req: Request,
    credential: CredentialWithScopes,
    values: { name: string; scopes: string[]; ips: string },
    errors: FieldErrors,
  ) {
    const logs = await this.credentialService.logs(credential.id);
    return {
      ...this.credentialFormContext(
        `${BASE}/credentials/${credential.id}`,
        values,
        errors,
      ),
      editing: true,
      canManage: this.canManage(req),
      credential: {
        id: credential.id,
        name: credential.name,
        hint: credential.hint,
        active: credential.active,
        created: formatDate(credential.createdAt),
        lastUsed: formatDateTime(credential.lastUsedAt),
      },
      logs: logs.map((log) => ({
        action: log.action,
        description: log.description,
        by: log.account?.user?.fullName ?? 'SaveApp',
        initials: initials(log.account?.user?.fullName ?? 'SaveApp'),
        when: formatDateTime(log.createdAt),
      })),
    };
  }

  private async credentialsTable(req: Request) {
    const credentials = await this.credentialService.list(
      this.account(req).business.id,
    );
    return {
      credentials: credentials.map((credential) => ({
        id: credential.id,
        name: credential.name,
        hint: credential.hint,
        scopes: credential.scopes.map((scope) => SCOPE_LABELS[scope]),
        ips: credential.ips ?? [],
        ipCount: (credential.ips ?? []).length,
        active: credential.active,
        created: formatDate(credential.createdAt),
        lastUsed: formatDateTime(credential.lastUsedAt),
      })),
    };
  }

  private async webhookContext(
    webhook: Webhook,
    values: Record<string, unknown>,
    errors: FieldErrors = {},
  ) {
    return {
      action: `${BASE}/webhooks/${webhook.id}`,
      editing: true,
      values,
      errors,
      webhook: {
        id: webhook.id,
        secret: await this.webhookService.secretOf(webhook),
        lastDelivery: formatDateTime(webhook.lastDeliveryAt),
        lastStatus: webhook.lastStatus,
        lastError: webhook.lastError,
      },
    };
  }

  private async webhooksTable(req: Request) {
    const webhooks = await this.webhookService.list(
      this.account(req).business.id,
    );
    return {
      webhooks: webhooks.map((webhook) => ({
        id: webhook.id,
        url: webhook.url,
        active: webhook.active,
        lastDelivery: formatDateTime(webhook.lastDeliveryAt),
        lastStatus: webhook.lastStatus,
        delivered: webhook.lastStatus === DeliveryStatus.Delivered,
        lastError: webhook.lastError,
        created: formatDate(webhook.createdAt),
      })),
    };
  }
}
