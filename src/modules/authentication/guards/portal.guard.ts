import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { REQUIRED_PERMISSIONS } from '../../authorization/decorators/require-permission.decorator';
import {
  AuthorizationLevel,
  SetPermission,
} from '../../authorization/entities/permission.entity';
import { PermissionService } from '../../authorization/services/permission.service';
import { OnboardingStatus } from '../../onboarding/entities/business.entity';
import {
  AccountService,
  businessStatusMeta,
} from '../../onboarding/services/account.service';
import { portalForLevel } from '../../shared/constants/portals';
import { imageUrl, initials } from '../../shared/utils/portal-view.util';
import {
  ForbiddenPageException,
  RedirectException,
} from '../filters/redirect.filter';
import { UserService } from '../services/user.service';

export const PORTAL_LEVELS = 'portal:levels';
// Merchant pages that need an approved business
export const APPROVED_ONLY = 'portal:approved-only';

/**
 * Session guard for the portals: a signed-in, active user acting as an
 * active account of one of the route's levels, holding any permission the
 * route requires (@RequirePermission).
 */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userService: UserService,
    private readonly accountService: AccountService,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const levels =
      this.reflector.getAllAndOverride<AuthorizationLevel[]>(
        PORTAL_LEVELS,
        targets,
      ) ?? [];
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const { userId, accountId } = req.session;
    const portal = portalForLevel(levels[0]);

    if (!userId) {
      if (req.method === 'GET') req.session.returnTo = req.originalUrl;
      throw new RedirectException('/auth/login');
    }

    const user = await this.userService.filter({ id: userId, active: true });
    if (!user) {
      await new Promise((resolve) => req.session.destroy(resolve));
      throw new RedirectException('/auth/login');
    }

    const account = accountId
      ? await this.accountService.activeAccount(userId, accountId)
      : null;
    if (!account) {
      delete req.session.accountId;
      throw new RedirectException('/auth/accounts');
    }
    // Signed in, but this portal belongs to a different account level
    if (!levels.includes(account.type))
      throw new RedirectException('/auth/accounts');

    // Effective permissions, checked against @RequirePermission (any of)
    const permissions = await this.permissionService.permissionsFor(account.id);
    const required = this.reflector.getAllAndOverride<SetPermission[]>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    if (
      required?.length &&
      !required.some((item) => permissions.includes(item))
    )
      throw new ForbiddenPageException(portal.basePath);

    const business = account.business;
    const approved = !business || business.status === OnboardingStatus.Approved;
    if (
      !approved &&
      this.reflector.getAllAndOverride<boolean>(APPROVED_ONLY, targets)
    ) {
      req.session.flash = {
        type: 'info',
        message: 'This opens once your business is approved.',
      };
      throw new RedirectException(portal.basePath);
    }

    req['user'] = user;
    req['account'] = account;
    req['permissions'] = permissions;
    req['approved'] = approved;
    res.locals.permissions = permissions;
    res.locals.user = {
      ...user,
      initials: initials(user.fullName),
      firstName: user.fullName.split(' ')[0],
      photoUrl: imageUrl(user.profile),
    };
    res.locals.account = this.accountService.summarize(account);
    // Identity card at the top of the merchant portal's sidebar
    if (business)
      res.locals.sidebarBusiness = {
        name: business.name,
        status: business.status,
        ...businessStatusMeta(business.status),
        logo: imageUrl(business.logo),
        initials: initials(business.name),
      };
    return true;
  }
}
