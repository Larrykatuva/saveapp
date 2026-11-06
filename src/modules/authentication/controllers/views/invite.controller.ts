import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { InviteService } from '../../../authorization/services/invite.service';
import {
  Invite,
  InviteStatus,
} from '../../../onboarding/entities/invite.entity';
import { FormError, validateForm } from '../../../shared/utils/form.util';
import {
  InviteLoginForm,
  InviteRegisterForm,
  PASSWORD_HINT,
} from '../../dtos/auth-form.dtos';
import { User } from '../../entities/user.entity';
import { AuthService } from '../../services/auth.service';
import { AuthenticatorService } from '../../services/authenticator.service';
import { UserService } from '../../services/user.service';
import {
  back,
  destination,
  fail,
  formState,
  signIn,
  startTwoFactor,
} from '../../utils/session.util';

const CLOSED: Record<string, string> = {
  [InviteStatus.Accepted]: 'This invitation has already been accepted.',
  [InviteStatus.Revoked]: 'This invitation was withdrawn by the sender.',
  [InviteStatus.Expired]:
    'This invitation has expired. Ask the person who invited you to send a new one.',
  [InviteStatus.Rejected]: 'This invitation was declined.',
};

/**
 * Accepting an invitation from the email link. People who already have a
 * SaveApp login sign in (or confirm, if signed in); new people create their
 * login here, without a separate email check since the link proves the inbox.
 */
@ApiExcludeController()
@Controller('auth/invite')
export class InviteViewController {
  constructor(
    private readonly inviteService: InviteService,
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly authenticatorService: AuthenticatorService,
  ) {}

  @Get(':token')
  async page(
    @Req() req: Request,
    @Res() res: Response,
    @Param('token') token: string,
  ) {
    const invite = await this.inviteService.findByToken(token);
    if (!invite || invite.status !== InviteStatus.Pending)
      return this.render(res, token, invite, {
        closed: invite
          ? CLOSED[invite.status]
          : 'This invitation link is not valid. Check that you copied the whole link.',
      });

    const existing = await this.userService.findByEmail(invite.email);
    const signedIn = req.session.userId
      ? await this.userService.filter({ id: req.session.userId })
      : null;
    const mode = !existing
      ? 'register'
      : signedIn?.id === existing.id
        ? 'accept'
        : signedIn
          ? 'other'
          : 'login';
    return this.render(res, token, invite, {
      mode,
      isRegister: mode === 'register',
      isLogin: mode === 'login',
      isAccept: mode === 'accept',
      isOther: mode === 'other',
      signedInEmail: signedIn?.email,
      passwordHint: PASSWORD_HINT,
      prefillName: invite.fullName ?? '',
    });
  }

  @Post(':token/accept')
  async accept(
    @Req() req: Request,
    @Res() res: Response,
    @Param('token') token: string,
  ) {
    const invite = await this.inviteService.findByToken(token);
    const user = req.session.userId
      ? await this.userService.filter({ id: req.session.userId })
      : null;
    if (!invite || !user) return res.redirect(303, `/auth/invite/${token}`);
    return this.join(req, res, token, invite, user);
  }

  @Post(':token/login')
  async login(
    @Req() req: Request,
    @Res() res: Response,
    @Param('token') token: string,
    @Body() body: unknown,
  ) {
    const url = `/auth/invite/${token}`;
    const invite = await this.inviteService.findByToken(token);
    if (!invite) return res.redirect(303, url);
    const { values, errors } = await validateForm(InviteLoginForm, body);
    if (Object.keys(errors).length) return back(req, res, url, body, errors);
    try {
      const user = await this.authService.authenticate(
        invite.email,
        values.password,
      );
      // Second step first (authenticator or emailed code), then back here
      if (await this.authenticatorService.isEnabled(user.id))
        return startTwoFactor(req, res, user, 'app', false, token);
      await this.authService.sendLoginCode(user);
      return startTwoFactor(req, res, user, 'email', false, token);
    } catch (error) {
      return fail(req, res, url, body, error);
    }
  }

  @Post(':token/register')
  async register(
    @Req() req: Request,
    @Res() res: Response,
    @Param('token') token: string,
    @Body() body: unknown,
  ) {
    const url = `/auth/invite/${token}`;
    const invite = await this.inviteService.findByToken(token);
    if (!invite) return res.redirect(303, url);
    const { values, errors } = await validateForm(InviteRegisterForm, body);
    if (Object.keys(errors).length) return back(req, res, url, body, errors);
    try {
      const user = await this.authService.registerInvited(invite.email, values);
      await signIn(req, user, false);
      return this.join(req, res, token, invite, user);
    } catch (error) {
      return fail(req, res, url, body, error);
    }
  }

  /** Accepts for the signed-in user and opens the portal of the new account. */
  private async join(
    req: Request,
    res: Response,
    token: string,
    invite: Invite,
    user: User,
  ) {
    try {
      const account = await this.inviteService.accept(invite, user);
      req.session.accountId = account.id;
      req.session.flash = {
        type: 'success',
        message: `Welcome to ${this.inviteService.entityName(invite)}.`,
      };
      return res.redirect(303, destination(req, account.type));
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      req.session.flash = { type: 'error', message: error.message };
      return res.redirect(303, `/auth/invite/${token}`);
    }
  }

  private render(
    res: Response,
    token: string,
    invite: Invite | null,
    context: Record<string, unknown>,
  ) {
    return res.render('pages/auth/invite', {
      layout: 'layouts/auth',
      title: 'Accept invitation',
      token,
      invite: invite && {
        email: invite.email,
        entityName: this.inviteService.entityName(invite),
        roleName: invite.role?.name ?? 'Viewer',
        isStaff: !invite.business,
      },
      panelTitle: 'Your team is waiting.',
      panelText:
        'Accept the invitation to work with your team on SaveApp. One login covers every business you belong to.',
      ...formState(res),
      ...context,
    });
  }
}
