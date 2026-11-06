import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { User } from '../../authentication/entities/user.entity';
import { Account } from '../../onboarding/entities/account.entity';
import { EntityService } from '../../shared/services/entity.service';
import { FormError } from '../../shared/utils/form.util';
import { pageCount, pageWindow } from '../../shared/utils/portal-view.util';
import { SystemRoles } from '../constants/roles.catalog';
import { AccountRole } from '../entities/accountRole.entity';
import { AuthorizationLevel } from '../entities/permission.entity';
import { RoleScope, RoleService } from './role.service';

export interface TeamRights {
  assign: boolean;
  manage: boolean;
}

export interface TeamChanges {
  roleIds: number[];
  active?: boolean;
}

/** The full-access role a scope must never lose its last holder of. */
const keeperRole = (level: AuthorizationLevel) =>
  level === AuthorizationLevel.Staff
    ? SystemRoles.SuperAdmin
    : SystemRoles.Owner;

/**
 * Members of a portal's team: staff accounts for the admin portal, the
 * business's accounts for the merchant portal. Roles are assigned through
 * AccountRole; revoking deactivates the link instead of deleting it so the
 * default-role sync never hands a revoked role back.
 */
@Injectable()
export class TeamService extends EntityService<Account> {
  constructor(
    @InjectRepository(Account) private accountRepository: Repository<Account>,
    @InjectRepository(AccountRole)
    private accountRoleRepository: Repository<AccountRole>,
    private readonly roleService: RoleService,
  ) {
    super();
    super.setRepository(this.accountRepository);
  }

  private scoped(scope: RoleScope) {
    const builder = this.accountRepository
      .createQueryBuilder('account')
      .innerJoinAndSelect('account.user', 'user')
      .where('account.type = :level', { level: scope.level });
    if (scope.businessId)
      builder.andWhere('account."businessId" = :businessId', {
        businessId: scope.businessId,
      });
    else builder.andWhere('account."businessId" IS NULL');
    return builder;
  }

  async list(scope: RoleScope, query = '', status = '', page = 1) {
    const builder = this.scoped(scope).orderBy('account.createdAt', 'DESC');
    const term = query.trim();
    if (term)
      builder.andWhere(
        new Brackets((where) =>
          where
            .where('user.fullName ILIKE :term', { term: `%${term}%` })
            .orWhere('user.email ILIKE :term', { term: `%${term}%` }),
        ),
      );
    if (status === 'Active') builder.andWhere('account.active = true');
    if (status === 'Inactive') builder.andWhere('account.active = false');

    const window = pageWindow(page);
    const [items, total] = await builder
      .skip(window.skip)
      .take(window.take)
      .getManyAndCount();
    return { items, total, page: window.page, pages: pageCount(total) };
  }

  async counts(scope: RoleScope) {
    const rows = await this.scoped(scope)
      .select('account.active', 'active')
      .addSelect('COUNT(*)', 'count')
      .groupBy('account.active')
      .getRawMany<{ active: boolean; count: string }>();
    const active = Number(rows.find((row) => row.active)?.count ?? 0);
    const inactive = Number(rows.find((row) => !row.active)?.count ?? 0);
    return { all: active + inactive, active, inactive };
  }

  async findInScope(
    scope: RoleScope,
    accountId: number,
  ): Promise<Account | null> {
    return this.scoped(scope)
      .andWhere('account.id = :accountId', { accountId })
      .getOne();
  }

  /** Active role ids per account. */
  async activeRoleIds(accountIds: number[]): Promise<Record<number, number[]>> {
    if (!accountIds.length) return {};
    const rows = await this.accountRoleRepository
      .createQueryBuilder('ar')
      .select(['ar."accountId" AS "accountId"', 'ar."roleId" AS "roleId"'])
      .where('ar."accountId" IN (:...accountIds)', { accountIds })
      .andWhere('ar.active = true')
      .getRawMany<{ accountId: number; roleId: number }>();
    const map: Record<number, number[]> = {};
    for (const row of rows) (map[row.accountId] ??= []).push(row.roleId);
    return map;
  }

  /** Active members of a scope holding a role, e.g. the business's owners. */
  async holders(scope: RoleScope, roleId: number): Promise<Account[]> {
    return this.scoped(scope)
      .innerJoin(
        AccountRole,
        'ar',
        'ar."accountId" = account.id AND ar.active = true AND ar."roleId" = :roleId',
        { roleId },
      )
      .andWhere('account.active = true')
      .getMany();
  }

  /**
   * Applies role and active changes after checking the actor's rights.
   * Nobody can change their own roles or deactivate themselves, and the last
   * active Owner (Super Admin for staff) always keeps that role.
   */
  async saveMember(
    scope: RoleScope,
    actorAccountId: number,
    account: Account & { user: User },
    changes: TeamChanges,
    rights: TeamRights,
  ): Promise<{ added: number; removed: number }> {
    const self = account.id === actorAccountId;
    const available = await this.roleService.list(scope);
    const availableIds = new Set(available.map((role) => role.id));
    const current = (await this.activeRoleIds([account.id]))[account.id] ?? [];
    const picked = [
      ...new Set(changes.roleIds.filter((id) => availableIds.has(id))),
    ];
    const toAdd = picked.filter((id) => !current.includes(id));
    const toRemove = current.filter(
      (id) => availableIds.has(id) && !picked.includes(id),
    );
    const activeChanged =
      changes.active !== undefined && changes.active !== account.active;

    if (self && (toAdd.length || toRemove.length || activeChanged))
      throw new FormError(
        "You can't change your own roles or deactivate yourself. Ask another admin.",
      );
    if ((toAdd.length || toRemove.length) && !rights.assign)
      throw new FormError("You don't have permission to change roles");
    if (activeChanged && !rights.manage)
      throw new FormError("You don't have permission to manage team members");
    if (!picked.length && (changes.active ?? account.active))
      throw new FormError('Give this person at least one role');
    const inactivePick = toAdd.find(
      (id) => !available.find((role) => role.id === id)?.active,
    );
    if (inactivePick)
      throw new FormError(
        'Inactive roles cannot be assigned. Activate the role first.',
      );

    const keeperName: string = keeperRole(scope.level);
    const keeper = available.find(
      (role) => role.system && role.name === keeperName,
    );
    const losesKeeper =
      keeper &&
      current.includes(keeper.id) &&
      (toRemove.includes(keeper.id) || changes.active === false);
    if (losesKeeper) {
      const others = (await this.holders(scope, keeper.id)).filter(
        (holder) => holder.id !== account.id,
      );
      if (!others.length)
        throw new FormError(
          `${account.user.fullName} is the only active ${keeper.name}. Make someone else ${keeper.name} first.`,
        );
    }

    for (const roleId of toAdd)
      await this.roleService.assignRole(account.id, roleId);
    for (const roleId of toRemove)
      await this.accountRoleRepository.update(
        { account: { id: account.id }, role: { id: roleId } },
        { active: false },
      );
    if (activeChanged)
      await this.update({ id: account.id }, { active: changes.active });
    return { added: toAdd.length, removed: toRemove.length };
  }
}
