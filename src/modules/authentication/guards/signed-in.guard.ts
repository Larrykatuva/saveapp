import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { imageUrl, initials } from '../../shared/utils/portal-view.util';
import { RedirectException } from '../filters/redirect.filter';
import { UserService } from '../services/user.service';

/**
 * Requires a signed-in, active user but no particular account. Used by flows
 * such as creating a business, which happen before a user has an account.
 * The user is exposed as `req.user` and to templates as {{user}}.
 */
@Injectable()
export class SignedInGuard implements CanActivate {
  constructor(private readonly userService: UserService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const user = req.session.userId
      ? await this.userService.filter({ id: req.session.userId, active: true })
      : null;
    if (!user) {
      req.session.returnTo = req.originalUrl;
      throw new RedirectException('/auth/login');
    }

    req['user'] = user;
    res.locals.user = {
      ...user,
      initials: initials(user.fullName),
      photoUrl: imageUrl(user.profile),
    };
    return true;
  }
}
