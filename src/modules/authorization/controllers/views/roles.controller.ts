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
import { ForbiddenPageException } from '../../../authentication/filters/redirect.filter';
import { Account } from '../../../onboarding/entities/account.entity';
import { PORTALS, Portal } from '../../../shared/constants/portals';
import { FormError, validateForm } from '../../../shared/utils/form.util';
import {
  fragment,
  initials,
  sectionView,
} from '../../../shared/utils/portal-view.util';
import { ROLE_PERMISSIONS } from '../../constants/permissions.catalog';
import { RoleForm } from '../../dtos/role-form.dto';
import {
  AuthorizationLevel,
  MERCHANT_LEVELS,
  SetPermission,
} from '../../entities/permission.entity';
import { Role } from '../../entities/role.entity';
import { PermissionService } from '../../services/permission.service';
import {
  RoleService,
  RoleSummary,
  scopeFor,
} from '../../services/role.service';

/**
 * Roles & permissions for a portal (two-pane: role list and the selected
 * role's permissions). System roles are listed read-only; custom roles belong
 * to the signed-in account's business (or the platform, for staff).
 */
// @Injectable so TypeScript records the constructor types for the subclasses
@Injectable()
abstract class RolesViewController {
  protected abstract readonly portal: Portal;

  constructor(
    private readonly roleService: RoleService,
    private readonly permissionService: PermissionService,
  ) {}

  private get base() {
    return `${this.portal.basePath}/team/roles`;
  }

  private rights(req: Request) {
    const permissions = (req['permissions'] as SetPermission[]) ?? [];
    const set = ROLE_PERMISSIONS[this.portal.key];
    return {
      create: permissions.includes(set.create),
      update: permissions.includes(set.update),
      permissions: permissions.includes(set.permissions),
    };
  }

  private need(
    req: Request,
    right: 'create' | 'update' | 'permissions' | 'any',
  ) {
    const rights = this.rights(req);
    const ok =
      right === 'any'
        ? rights.create || rights.update || rights.permissions
        : rights[right];
    if (!ok) throw new ForbiddenPageException(this.portal.basePath);
  }

  private scope(req: Request) {
    return scopeFor(req['account'] as Account);
  }

  @Get()
  async page(
    @Req() req: Request,
    @Res() res: Response,
    @Query('role') selected?: string,
  ) {
    this.need(req, 'any');
    const roles = await this.roleService.list(this.scope(req));
    const current =
      roles.find((role) => role.id === Number(selected)) ?? roles[0];
    return res.render(
      'pages/roles/index',
      sectionView(this.portal, req, 'team', 'Roles & permissions', {
        base: this.base,
        rights: this.rights(req),
        ...this.listContext(roles, current?.id),
        detail: current ? await this.detailContext(req, current) : null,
      }),
    );
  }

  @Get('list')
  async list(
    @Req() req: Request,
    @Res() res: Response,
    @Query('selected') selected?: string,
  ) {
    this.need(req, 'any');
    const roles = await this.roleService.list(this.scope(req));
    return fragment(res, 'roles/list', {
      base: this.base,
      ...this.listContext(roles, Number(selected)),
    });
  }

  @Get('new')
  newForm(@Req() req: Request, @Res() res: Response) {
    this.need(req, 'create');
    return fragment(res, 'roles/form', {
      action: this.base,
      values: {},
      errors: {},
    });
  }

  @Get(':id')
  async detail(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.need(req, 'any');
    const scope = this.scope(req);
    const role = await this.roleService.findInScope(scope, id);
    if (!role) return fragment(res, 'roles/empty', { base: this.base }, 404);
    const [summary] = await this.roleService.summarize(
      [role],
      scope.businessId,
    );
    return fragment(res, 'roles/detail', {
      base: this.base,
      ...(await this.detailContext(req, summary)),
    });
  }

  @Get(':id/edit')
  async editForm(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.need(req, 'update');
    const role = await this.editable(req, res, id);
    if (!role) return;
    return fragment(res, 'roles/form', {
      action: `${this.base}/${id}`,
      editing: true,
      values: role,
      errors: {},
    });
  }

  @Get(':id/permissions')
  async addPermissionsForm(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.need(req, 'permissions');
    const role = await this.editable(req, res, id);
    if (!role) return;
    const [summary] = await this.roleService.summarize([role]);
    const available = (await this.permissionService.forLevel(role.type)).filter(
      (permission) => !summary.permissionIds.includes(permission.id),
    );
    return fragment(res, 'roles/add_permissions', {
      action: `${this.base}/${id}/permissions`,
      role: summary,
      groups: this.permissionService.group(available),
      availableCount: available.length,
    });
  }

  @Post()
  async create(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: Record<string, unknown>,
  ) {
    this.need(req, 'create');
    const { values, errors } = await validateForm(RoleForm, body);
    if (Object.keys(errors).length)
      return fragment(
        res,
        'roles/form',
        { action: this.base, values: body, errors },
        422,
      );
    try {
      const role = await this.roleService.create(
        this.scope(req),
        values.name,
        values.description,
      );
      return res.json({
        ok: true,
        message: `${role.name} created. Add its permissions next.`,
        event: 'role:select',
        id: role.id,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'roles/form',
        { action: this.base, values: body, errors: error.errors },
        422,
      );
    }
  }

  @Post(':id')
  async update(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    this.need(req, 'update');
    const role = await this.editable(req, res, id);
    if (!role) return;
    const action = `${this.base}/${id}`;
    const { values, errors } = await validateForm(RoleForm, body);
    if (Object.keys(errors).length)
      return fragment(
        res,
        'roles/form',
        { action, editing: true, values: body, errors },
        422,
      );
    try {
      await this.roleService.rename(
        this.scope(req),
        role,
        values.name,
        values.description,
      );
      return res.json({
        ok: true,
        message: `${values.name} updated`,
        event: 'role:select',
        id,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return fragment(
        res,
        'roles/form',
        { action, editing: true, values: body, errors: error.errors },
        422,
      );
    }
  }

  @Post(':id/toggle')
  async toggle(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.need(req, 'update');
    const role = await this.editable(req, res, id);
    if (!role) return;
    await this.roleService.setActive(role, !role.active);
    return res.json({
      ok: true,
      active: !role.active,
      message: `${role.name} ${role.active ? 'deactivated' : 'activated'}`,
    });
  }

  @Post(':id/delete')
  async remove(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.need(req, 'update');
    const role = await this.editable(req, res, id);
    if (!role) return;
    await this.roleService.remove(role);
    return res.json({
      ok: true,
      message: `${role.name} deleted`,
      event: 'role:deleted',
    });
  }

  @Post(':id/permissions')
  async addPermissions(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body('permissionIds') ids?: string | string[],
  ) {
    this.need(req, 'permissions');
    const role = await this.editable(req, res, id);
    if (!role) return;
    const permissionIds = (Array.isArray(ids) ? ids : ids ? [ids] : [])
      .map(Number)
      .filter(Boolean);
    if (!permissionIds.length)
      return res
        .status(400)
        .json({ ok: false, message: 'Pick at least one permission' });
    const added = await this.roleService.addPermissions(role, permissionIds);
    return res.json({
      ok: true,
      message: `${added} permission${added === 1 ? '' : 's'} added to ${role.name}`,
      event: 'role:select',
      id,
    });
  }

  @Post(':id/permissions/:permissionId/remove')
  async removePermission(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Param('permissionId', ParseIntPipe) permissionId: number,
  ) {
    this.need(req, 'permissions');
    const role = await this.editable(req, res, id);
    if (!role) return;
    await this.roleService.removePermission(role, permissionId);
    return res.json({
      ok: true,
      message: `Permission removed from ${role.name}`,
      event: 'role:select',
      id,
    });
  }

  /* --------------------------- Helpers ----------------------------- */

  /** Loads a custom role in scope, or answers 404/409 and returns null. */
  private async editable(
    req: Request,
    res: Response,
    id: number,
  ): Promise<Role | null> {
    const role = await this.roleService.findInScope(this.scope(req), id);
    if (!role) {
      res.status(404).json({ ok: false, message: 'Role not found' });
      return null;
    }
    if (role.system) {
      res.status(409).json({
        ok: false,
        message:
          'System roles are managed by the platform and cannot be changed',
      });
      return null;
    }
    return role;
  }

  private listContext(roles: RoleSummary[], selectedId?: number) {
    return {
      roles: roles.map((role) => ({
        ...role,
        initials: initials(role.name),
        permissionCount: role.permissionIds.length,
        selected: role.id === selectedId,
      })),
      selectedId,
    };
  }

  private async detailContext(req: Request, role: RoleSummary) {
    const all = await this.permissionService.forLevel(role.level);
    const assigned = all.filter((permission) =>
      role.permissionIds.includes(permission.id),
    );
    const rights = this.rights(req);
    return {
      role: { ...role, initials: initials(role.name) },
      groups: this.permissionService.group(assigned),
      assignedCount: assigned.length,
      totalCount: all.length,
      levelLabel:
        role.level === AuthorizationLevel.Staff
          ? 'SaveApp team'
          : role.level === AuthorizationLevel.WhiteLabel
            ? 'White-label merchant'
            : 'Merchant',
      canUpdate: rights.update && !role.system,
      canPermissions: rights.permissions && !role.system,
    };
  }
}

@ApiExcludeController()
@Controller('admin/team/roles')
@PortalAccess(AuthorizationLevel.Staff)
export class AdminRolesViewController extends RolesViewController {
  protected readonly portal = PORTALS.admin;
}

@ApiExcludeController()
@Controller('merchant/team/roles')
@PortalAccess(...MERCHANT_LEVELS)
@ApprovedOnly()
export class MerchantRolesViewController extends RolesViewController {
  protected readonly portal = PORTALS.merchant;
}
