import {
  Body,
  Controller,
  Get,
  Injectable,
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
  Portal as PortalAccess,
} from '../../../authentication/decorators/portal.decorator';
import { User } from '../../../authentication/entities/user.entity';
import { ForbiddenPageException } from '../../../authentication/filters/redirect.filter';
import { Account } from '../../../onboarding/entities/account.entity';
import {
  PORTALS,
  Portal,
  firstSectionPage,
} from '../../../shared/constants/portals';
import { FormError, validateForm } from '../../../shared/utils/form.util';
import { fragment, sectionView } from '../../../shared/utils/portal-view.util';
import { TEAM_PERMISSIONS } from '../../constants/permissions.catalog';
import { InviteMemberForm } from '../../dtos/role-form.dto';
import {
  AuthorizationLevel,
  MERCHANT_LEVELS,
  SetPermission,
} from '../../entities/permission.entity';
import { InviteService } from '../../services/invite.service';
import { scopeFor } from '../../services/role.service';
import { TeamPresenter } from '../../services/team-presenter.service';
import { TeamService } from '../../services/team.service';

const STATUS_TABS = [
  { value: '', label: 'All', key: 'all' },
  { value: 'Active', label: 'Active', key: 'active' },
  { value: 'Inactive', label: 'Inactive', key: 'inactive' },
] as const;

/**
 * A portal's team: members with their roles (drawer to change roles or
 * deactivate) and pending invitations (invite, resend, revoke). Viewing,
 * inviting, assigning roles and managing each need their own permission.
 */
// @Injectable so TypeScript records the constructor types for the subclasses
@Injectable()
abstract class TeamViewController {
  protected abstract readonly portal: Portal;

  constructor(
    private readonly teamService: TeamService,
    private readonly presenter: TeamPresenter,
    private readonly inviteService: InviteService,
  ) {}

  private get base() {
    return `${this.portal.basePath}/team`;
  }

  private rights(req: Request) {
    const permissions = (req['permissions'] as SetPermission[]) ?? [];
    const set = TEAM_PERMISSIONS[this.portal.key];
    return {
      view: set.view.some((item) => permissions.includes(item)),
      invite: permissions.includes(set.invite),
      assign: permissions.includes(set.assign),
      manage: permissions.includes(set.manage),
    };
  }

  private need(req: Request, right: 'view' | 'invite' | 'manage') {
    if (!this.rights(req)[right])
      throw new ForbiddenPageException(this.portal.basePath);
  }

  private scope(req: Request) {
    return scopeFor(req['account'] as Account);
  }

  private async counts(req: Request) {
    const scope = this.scope(req);
    return {
      [`${this.base}/members`]: (await this.teamService.counts(scope)).all,
      [`${this.base}/invites`]: await this.inviteService.countPending(scope),
    };
  }

  @Get()
  index(@Req() req: Request, @Res() res: Response) {
    const first = firstSectionPage(
      this.portal,
      'team',
      (req['permissions'] as string[]) ?? [],
    );
    if (!first) throw new ForbiddenPageException(this.portal.basePath);
    return res.redirect(first);
  }

  /* ----------------------------- Members --------------------------- */

  @Get('members')
  async members(
    @Req() req: Request,
    @Res() res: Response,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page = '1',
  ) {
    this.need(req, 'view');
    const counts = await this.teamService.counts(this.scope(req));
    return res.render(
      'pages/team/members',
      sectionView(
        this.portal,
        req,
        'team',
        'Members',
        {
          q,
          status,
          rights: this.rights(req),
          tabs: STATUS_TABS.map((tab) => ({
            ...tab,
            count: counts[tab.key],
            active: tab.value === status,
          })),
          ...(await this.table(req, q, status, Number(page))),
        },
        await this.counts(req),
      ),
    );
  }

  @Get('members/table')
  async membersTable(
    @Req() req: Request,
    @Res() res: Response,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page = '1',
  ) {
    this.need(req, 'view');
    return fragment(res, 'team/table', {
      q,
      status,
      ...(await this.table(req, q, status, Number(page))),
    });
  }

  @Get('members/:id')
  async memberDrawer(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.need(req, 'view');
    const account = await this.teamService.findInScope(this.scope(req), id);
    if (!account)
      return res.status(404).json({ ok: false, message: 'Member not found' });
    return fragment(res, 'team/drawer', await this.drawerContext(req, account));
  }

  @Post('members/:id')
  async saveMember(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      roleIds?: string | string[];
      active?: string;
      activePresent?: string;
    },
  ) {
    this.need(req, 'view');
    const scope = this.scope(req);
    const account = await this.teamService.findInScope(scope, id);
    if (!account)
      return res.status(404).json({ ok: false, message: 'Member not found' });
    const rights = this.rights(req);
    const roleIds = (
      Array.isArray(body.roleIds)
        ? body.roleIds
        : body.roleIds
          ? [body.roleIds]
          : []
    ).map(Number);
    try {
      const { added, removed } = await this.teamService.saveMember(
        scope,
        (req['account'] as Account).id,
        account,
        {
          roleIds,
          active:
            rights.manage && body.activePresent
              ? body.active === 'on'
              : undefined,
        },
        rights,
      );
      const parts = [
        added ? `${added} role${added === 1 ? '' : 's'} assigned` : '',
        removed ? `${removed} revoked` : '',
      ].filter(Boolean);
      return res.json({
        ok: true,
        message: `${account.user.fullName} updated${parts.length ? ` · ${parts.join(', ')}` : ''}`,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'team/drawer',
        {
          ...(await this.drawerContext(req, account)),
          formError: error.message,
        },
        422,
      );
    }
  }

  /* --------------------------- Invitations ------------------------- */

  @Get('invites')
  async invites(@Req() req: Request, @Res() res: Response) {
    this.need(req, 'view');
    return res.render(
      'pages/team/invites',
      sectionView(
        this.portal,
        req,
        'team',
        'Invitations',
        {
          rights: this.rights(req),
          ...(await this.presenter.invites(this.scope(req), this.base)),
        },
        await this.counts(req),
      ),
    );
  }

  @Get('invites/list')
  async invitesList(@Req() req: Request, @Res() res: Response) {
    this.need(req, 'view');
    return fragment(res, 'team/invites', {
      rights: this.rights(req),
      ...(await this.presenter.invites(this.scope(req), this.base)),
    });
  }

  @Get('invites/new')
  async inviteForm(@Req() req: Request, @Res() res: Response) {
    this.need(req, 'invite');
    return fragment(
      res,
      'team/invite_form',
      await this.inviteContext(req, {}, {}),
    );
  }

  @Post('invites')
  async invite(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: Record<string, unknown>,
  ) {
    this.need(req, 'invite');
    const { values, errors } = await validateForm(InviteMemberForm, body);
    try {
      if (Object.keys(errors).length)
        throw new FormError('Please fix the highlighted fields', errors);
      const invite = await this.inviteService.invite(
        this.scope(req),
        req['user'] as User,
        values,
      );
      return res.json({
        ok: true,
        message: `Invitation sent to ${invite.email}`,
        redirect: `${this.base}/invites`,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'team/invite_form',
        await this.inviteContext(req, body, error.errors),
        422,
      );
    }
  }

  @Post('invites/:id/resend')
  async resend(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.need(req, 'manage');
    return this.inviteAction(req, res, id, 'resend');
  }

  @Post('invites/:id/revoke')
  async revoke(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.need(req, 'manage');
    return this.inviteAction(req, res, id, 'revoke');
  }

  /* --------------------------- Helpers ----------------------------- */

  private async inviteAction(
    req: Request,
    res: Response,
    id: number,
    action: 'resend' | 'revoke',
  ) {
    const invite = await this.inviteService.findInScope(this.scope(req), id);
    if (!invite)
      return res
        .status(404)
        .json({ ok: false, message: 'Invitation not found' });
    try {
      if (action === 'resend')
        await this.inviteService.resend(invite, req['user'] as User);
      else await this.inviteService.revoke(invite);
      return res.json({
        ok: true,
        message:
          action === 'resend'
            ? `Invitation sent to ${invite.email} again`
            : `Invitation to ${invite.email} revoked`,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return res.status(409).json({ ok: false, message: error.message });
    }
  }

  private async inviteContext(
    req: Request,
    values: Record<string, unknown>,
    errors: Record<string, string>,
  ) {
    const scope = this.scope(req);
    return {
      action: `${this.base}/invites`,
      values,
      errors,
      roles: await this.presenter.inviteRoles(scope, Number(values.roleId)),
      isStaff: scope.level === AuthorizationLevel.Staff,
    };
  }

  private table(req: Request, q: string, status: string, page: number) {
    return this.presenter.table(
      this.scope(req),
      `${this.base}/members`,
      (req['account'] as Account).id,
      q,
      status,
      page,
    );
  }

  private drawerContext(req: Request, account: Account) {
    return this.presenter.drawer(
      this.scope(req),
      `${this.base}/members`,
      (req['account'] as Account).id,
      account,
      this.rights(req),
    );
  }
}

@ApiExcludeController()
@Controller('admin/team')
@PortalAccess(AuthorizationLevel.Staff)
export class AdminTeamViewController extends TeamViewController {
  protected readonly portal = PORTALS.admin;
}

@ApiExcludeController()
@Controller('merchant/team')
@PortalAccess(...MERCHANT_LEVELS)
@ApprovedOnly()
export class MerchantTeamViewController extends TeamViewController {
  protected readonly portal = PORTALS.merchant;
}
