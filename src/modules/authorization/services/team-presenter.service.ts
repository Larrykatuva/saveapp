import { Injectable } from '@nestjs/common';
import { Account } from '../../onboarding/entities/account.entity';
import { Invite } from '../../onboarding/entities/invite.entity';
import {
  formatDate,
  imageUrl,
  initials,
  pager,
} from '../../shared/utils/portal-view.util';
import { InviteService } from './invite.service';
import { RoleScope, RoleService } from './role.service';
import { TeamRights, TeamService } from './team.service';

/** View models for the team tables, member drawer and invitations list. */
@Injectable()
export class TeamPresenter {
  constructor(
    private readonly teamService: TeamService,
    private readonly roleService: RoleService,
    private readonly inviteService: InviteService,
  ) {}

  async table(
    scope: RoleScope,
    base: string,
    actorAccountId: number,
    q: string,
    status: string,
    page: number,
  ) {
    const result = await this.teamService.list(scope, q, status, page);
    const roles = await this.roleService.list(scope);
    const assigned = await this.teamService.activeRoleIds(
      result.items.map((item) => item.id),
    );
    return {
      base,
      members: result.items.map((account) => {
        const names = roles
          .filter((role) => assigned[account.id]?.includes(role.id))
          .map((role) => role.name);
        return {
          id: account.id,
          name: account.user.fullName,
          email: account.user.email,
          initials: initials(account.user.fullName),
          photo: imageUrl(account.user.profile),
          roles: names.slice(0, 2),
          moreRoles: Math.max(0, names.length - 2),
          active: account.active,
          joined: formatDate(account.createdAt),
          isMe: account.id === actorAccountId,
        };
      }),
      ...pager(result, `${base}/table`, { q, status }),
      filtered: Boolean(q || status),
    };
  }

  async drawer(
    scope: RoleScope,
    base: string,
    actorAccountId: number,
    account: Account,
    rights: TeamRights,
  ) {
    const isMe = account.id === actorAccountId;
    const roles = await this.roleService.list(scope);
    const current =
      (await this.teamService.activeRoleIds([account.id]))[account.id] ?? [];
    return {
      base,
      member: {
        id: account.id,
        name: account.user.fullName,
        email: account.user.email,
        phone: account.user.phoneNumber,
        initials: initials(account.user.fullName),
        photo: imageUrl(account.user.profile),
        active: account.active,
        joined: formatDate(account.createdAt),
        isMe,
      },
      roles: roles.map((role) => {
        const assigned = current.includes(role.id);
        return {
          id: role.id,
          name: role.name,
          system: role.system,
          active: role.active,
          permissionCount: role.permissionIds.length,
          assigned,
          locked: isMe || !rights.assign || (!assigned && !role.active),
        };
      }),
      assignedCount: current.length,
      canManage: rights.manage && !isMe,
      canEditRoles: !isMe && rights.assign,
      canSave: !isMe && (rights.manage || rights.assign),
    };
  }

  async invites(scope: RoleScope, base: string) {
    const now = new Date();
    const invites = await this.inviteService.pending(scope);
    return {
      base,
      invites: invites.map((invite: Invite) => ({
        id: invite.id,
        email: invite.email,
        fullName: invite.fullName,
        initials: initials(invite.fullName || invite.email),
        role: invite.role?.name ?? 'Viewer',
        sent: formatDate(invite.updatedAt),
        expires: formatDate(invite.expiry),
        expired: invite.expiry < now,
      })),
    };
  }

  /** Active roles the inviter can hand out, system roles first. */
  async inviteRoles(scope: RoleScope, selected?: number) {
    const roles = await this.roleService.list(scope);
    return roles
      .filter((role) => role.active)
      .map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        system: role.system,
        selected: role.id === selected,
      }));
  }
}
