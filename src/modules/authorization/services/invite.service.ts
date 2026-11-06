import { createHash, randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { User } from '../../authentication/entities/user.entity';
import { NotifyService } from '../../notifications/services/notify.service';
import { Account } from '../../onboarding/entities/account.entity';
import { Business } from '../../onboarding/entities/business.entity';
import { Invite, InviteStatus } from '../../onboarding/entities/invite.entity';
import { EmailTemplate } from '../../shared/constants/email-templates';
import { EntityService } from '../../shared/services/entity.service';
import { FormError } from '../../shared/utils/form.util';
import { SystemRoles } from '../constants/roles.catalog';
import { AuthorizationLevel } from '../entities/permission.entity';
import { RoleScope, RoleService } from './role.service';

export const INVITE_DAYS = 7;

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export interface InviteForm {
  email: string;
  fullName?: string;
  roleId: number;
}

/**
 * Email invitations to join a business (merchant portal) or the SaveApp team
 * (admin portal). The link carries a random token; only its hash is stored.
 * Accepting creates (or reactivates) the person's account with the invited
 * role.
 */
@Injectable()
export class InviteService extends EntityService<Invite> {
  private readonly logger = new Logger(InviteService.name);

  constructor(
    @InjectRepository(Invite) private inviteRepository: Repository<Invite>,
    @InjectRepository(Account) private accountRepository: Repository<Account>,
    @InjectRepository(Business)
    private businessRepository: Repository<Business>,
    private readonly roleService: RoleService,
    private readonly notifyService: NotifyService,
    private readonly configService: ConfigService,
  ) {
    super();
    super.setRepository(this.inviteRepository);
  }

  private ownerWhere(scope: RoleScope) {
    return { business: scope.businessId ? { id: scope.businessId } : IsNull() };
  }

  /** Invitations waiting for an answer (expired ones included), newest first. */
  async pending(scope: RoleScope): Promise<Invite[]> {
    return this.filterMany(
      { ...this.ownerWhere(scope), status: InviteStatus.Pending },
      { relations: { role: true }, order: { createdAt: 'DESC' } },
    );
  }

  async countPending(scope: RoleScope): Promise<number> {
    return this.inviteRepository.count({
      where: {
        ...this.ownerWhere(scope),
        status: InviteStatus.Pending,
        expiry: MoreThan(new Date()),
      },
    });
  }

  async findInScope(scope: RoleScope, id: number): Promise<Invite | null> {
    return this.filter(
      { id, ...this.ownerWhere(scope) },
      { relations: { role: true } },
    );
  }

  async invite(
    scope: RoleScope,
    inviter: User,
    form: InviteForm,
  ): Promise<Invite> {
    const email = form.email.trim().toLowerCase();
    const role = await this.roleService.findInScope(scope, form.roleId);
    const errors: Record<string, string> = {};
    if (!role || !role.active) errors.roleId = 'Choose an active role';

    const member = await this.accountRepository.findOne({
      where: {
        user: { email },
        type: scope.level,
        active: true,
        ...this.ownerWhere(scope),
      },
    });
    if (member) errors.email = 'This person is already on the team';

    const open = await this.filter({
      email,
      ...this.ownerWhere(scope),
      status: InviteStatus.Pending,
      expiry: MoreThan(new Date()),
    });
    if (open)
      errors.email =
        'This person already has an open invitation. Resend it from the list instead.';
    if (Object.keys(errors).length)
      throw new FormError('Please fix the highlighted fields', errors);

    const token = randomBytes(32).toString('hex');
    const invite = await this.save({
      email,
      fullName: form.fullName?.trim() || null,
      role: role,
      business: scope.businessId
        ? ({ id: scope.businessId } as Business)
        : undefined,
      token: hash(token),
      expiry: this.expiry(),
      status: InviteStatus.Pending,
    });
    await this.send(invite, token, inviter, role?.name ?? SystemRoles.Viewer);
    return invite;
  }

  /** Sends a fresh link (the old one stops working) and restarts the clock. */
  async resend(invite: Invite, inviter: User): Promise<void> {
    if (invite.status !== InviteStatus.Pending)
      throw new FormError('Only open invitations can be resent');
    const token = randomBytes(32).toString('hex');
    await this.update(
      { id: invite.id },
      { token: hash(token), expiry: this.expiry() },
    );
    await this.send(
      invite,
      token,
      inviter,
      invite.role?.name ?? SystemRoles.Viewer,
    );
  }

  async revoke(invite: Invite): Promise<void> {
    if (invite.status !== InviteStatus.Pending)
      throw new FormError('Only open invitations can be revoked');
    await this.update({ id: invite.id }, { status: InviteStatus.Revoked });
  }

  /** The invitation behind a link, with its business and role. */
  async findByToken(token: string): Promise<Invite | null> {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const invite = await this.filter(
      { token: hash(token) },
      { relations: { business: true, role: true } },
    );
    if (
      invite &&
      invite.status === InviteStatus.Pending &&
      invite.expiry < new Date()
    ) {
      await this.update({ id: invite.id }, { status: InviteStatus.Expired });
      invite.status = InviteStatus.Expired;
    }
    return invite;
  }

  /**
   * Creates (or reactivates) the user's account for the invitation's business
   * or the staff team, gives it the invited role and closes the invitation.
   */
  async accept(invite: Invite, user: User): Promise<Account> {
    if (invite.status !== InviteStatus.Pending)
      throw new FormError('This invitation is no longer valid');
    if (user.email.toLowerCase() !== invite.email.toLowerCase())
      throw new FormError(
        `This invitation was sent to ${invite.email}. Sign in with that email to accept it.`,
      );
    const level = invite.business?.type ?? AuthorizationLevel.Staff;
    const existing = await this.accountRepository.findOne({
      where: {
        user: { id: user.id },
        type: level,
        business: invite.business ? { id: invite.business.id } : IsNull(),
      },
    });
    const account = existing
      ? { ...existing, active: true }
      : await this.accountRepository.save({
          user,
          type: level,
          business: invite.business ?? undefined,
          active: true,
        });
    if (existing)
      await this.accountRepository.update(
        { id: existing.id },
        { active: true },
      );

    const role =
      invite.role?.active && invite.role.type === level
        ? invite.role
        : await this.roleService.systemRole(level, SystemRoles.Viewer);
    if (role) await this.roleService.assignRole(account.id, role.id);
    await this.update(
      { id: invite.id },
      {
        status: InviteStatus.Accepted,
        actionBy: { id: account.id } as Account,
      },
    );
    return account;
  }

  /** Where the invitation leads: the business name, or SaveApp for staff. */
  entityName(invite: Pick<Invite, 'business'>): string {
    return invite.business?.name ?? 'the SaveApp team';
  }

  private expiry() {
    return new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  }

  private async send(
    invite: Invite,
    token: string,
    inviter: User,
    roleName: string,
  ) {
    const business = invite.business?.id
      ? await this.businessRepository.findOneBy({ id: invite.business.id })
      : null;
    const url = this.notifyService.url(`/auth/invite/${token}`);
    this.notifyService.email({
      email: invite.email,
      subject: `${inviter.fullName} invited you to ${business?.name ?? 'SaveApp'}`,
      template: EmailTemplate.Invite,
      context: {
        inviterName: inviter.fullName,
        entityName: business?.name ?? 'the SaveApp team',
        roleName,
        url,
        expiryDays: INVITE_DAYS,
      },
    });
    if (this.configService.get<string>('ENV') === 'DEV')
      this.logger.debug(`[DEV] invitation link for ${invite.email}: ${url}`);
  }
}
