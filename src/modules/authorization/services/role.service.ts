import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Account } from '../../onboarding/entities/account.entity';
import { EntityService } from '../../shared/services/entity.service';
import { FormError } from '../../shared/utils/form.util';
import {
  RoleSets,
  SystemRoles,
  defaultRoleSet,
} from '../constants/roles.catalog';
import { AccountRole } from '../entities/accountRole.entity';
import {
  AuthorizationLevel,
  Permission,
  permissionLevels,
} from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { RolePermission } from '../entities/rolePermission.entity';

/**
 * Whose roles a portal manages: the level plus, for merchants, the business
 * that owns its custom roles. Staff custom roles are platform-wide.
 */
export interface RoleScope {
  level: AuthorizationLevel;
  businessId?: number;
}

export const scopeFor = (account: Account): RoleScope => ({
  level: account.type,
  businessId: account.business?.id,
});

export interface RoleSummary {
  id: number;
  name: string;
  description: string | null;
  system: boolean;
  active: boolean;
  level: AuthorizationLevel;
  permissionIds: number[];
  memberCount: number;
}

@Injectable()
export class RoleService extends EntityService<Role> {
  constructor(
    @InjectRepository(Role) private roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(AccountRole)
    private accountRoleRepository: Repository<AccountRole>,
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
  ) {
    super();
    super.setRepository(this.roleRepository);
  }

  /** System roles of the level plus the scope's own custom roles. */
  async list(scope: RoleScope): Promise<RoleSummary[]> {
    const roles = await this.roleRepository.find({
      where: [
        { type: scope.level, system: true },
        {
          type: scope.level,
          system: false,
          business: scope.businessId ? { id: scope.businessId } : IsNull(),
        },
      ],
      // System roles stay on top; within each group the newest first
      order: { system: 'DESC', createdAt: 'DESC' },
    });
    return this.summarize(roles, scope.businessId);
  }

  /** A role the scope may see, or null. */
  async findInScope(scope: RoleScope, id: number): Promise<Role | null> {
    const role = await this.roleRepository.findOne({
      where: { id },
      relations: { business: true },
    });
    if (!role || role.type !== scope.level) return null;
    if (role.system) return role;
    return (role.business?.id ?? undefined) === scope.businessId ? role : null;
  }

  /**
   * Permission ids and member counts per role. Members of shared system
   * roles are counted within the business only.
   */
  async summarize(roles: Role[], businessId?: number): Promise<RoleSummary[]> {
    if (!roles.length) return [];
    const ids = roles.map((role) => role.id);
    const links = await this.rolePermissionRepository
      .createQueryBuilder('rp')
      .select([
        'rp."roleId" AS "roleId"',
        'rp."permissionId" AS "permissionId"',
      ])
      .where('rp."roleId" IN (:...ids)', { ids })
      .andWhere('rp.active = true')
      .getRawMany<{ roleId: number; permissionId: number }>();
    const members = this.accountRoleRepository
      .createQueryBuilder('ar')
      .innerJoin('ar.account', 'account')
      .select('ar."roleId"', 'roleId')
      .addSelect('COUNT(*)', 'count')
      .where('ar."roleId" IN (:...ids)', { ids })
      .andWhere('ar.active = true')
      .groupBy('ar."roleId"');
    if (businessId)
      members.andWhere('account."businessId" = :businessId', { businessId });
    const counts = await members.getRawMany<{
      roleId: number;
      count: string;
    }>();
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description ?? null,
      system: role.system,
      active: role.active,
      level: role.type,
      permissionIds: links
        .filter((link) => link.roleId === role.id)
        .map((link) => link.permissionId),
      memberCount: Number(
        counts.find((row) => row.roleId === role.id)?.count ?? 0,
      ),
    }));
  }

  async create(
    scope: RoleScope,
    name: string,
    description?: string,
  ): Promise<Role> {
    await this.assertNameFree(scope, name);
    return this.save({
      type: scope.level,
      name,
      description: description || undefined,
      system: false,
      active: true,
      business: scope.businessId
        ? ({ id: scope.businessId } as never)
        : undefined,
    });
  }

  async rename(
    scope: RoleScope,
    role: Role,
    name: string,
    description?: string,
  ): Promise<void> {
    this.assertEditable(role);
    if (name.toLowerCase() !== role.name.toLowerCase())
      await this.assertNameFree(scope, name);
    await this.roleRepository.update(
      { id: role.id },
      { name, description: description || '' },
    );
  }

  async setActive(role: Role, active: boolean): Promise<void> {
    this.assertEditable(role);
    await this.roleRepository.update({ id: role.id }, { active });
  }

  async remove(role: Role): Promise<void> {
    this.assertEditable(role);
    await this.roleRepository.delete({ id: role.id });
  }

  /** Adds permissions of the role's own level; others are ignored. */
  async addPermissions(role: Role, permissionIds: number[]): Promise<number> {
    this.assertEditable(role);
    if (!permissionIds.length) return 0;
    const permissions = await this.permissionRepository.find({
      where: {
        id: In(permissionIds),
        type: In(permissionLevels(role.type)),
        active: true,
      },
    });
    const existing = await this.rolePermissionRepository.find({
      where: { role: { id: role.id } },
      relations: { permission: true },
    });
    const have = new Set(
      existing.filter((link) => link.active).map((link) => link.permission.id),
    );
    let added = 0;
    for (const permission of permissions) {
      if (have.has(permission.id)) continue;
      const inactive = existing.find(
        (link) => link.permission.id === permission.id,
      );
      if (inactive)
        await this.rolePermissionRepository.update(
          { id: inactive.id },
          { active: true },
        );
      else
        await this.rolePermissionRepository.save({
          role,
          permission,
          active: true,
        });
      added += 1;
    }
    return added;
  }

  async removePermission(role: Role, permissionId: number): Promise<void> {
    this.assertEditable(role);
    await this.rolePermissionRepository.delete({
      role: { id: role.id },
      permission: { id: permissionId },
    });
  }

  /** The seeded system role of a level, e.g. Owner for B2B. */
  async systemRole(
    level: AuthorizationLevel,
    name: SystemRoles,
  ): Promise<Role | null> {
    return this.roleRepository.findOneBy({ name, type: level, system: true });
  }

  /**
   * Gives an account a system role of its level (its default role when no
   * name is given). Idempotent.
   */
  async assignSystemRole(
    account: Pick<Account, 'id' | 'type'>,
    name?: SystemRoles,
  ): Promise<void> {
    const definition = name
      ? RoleSets.find((set) => set.name === name && set.type === account.type)
      : defaultRoleSet(account.type);
    if (!definition) return;
    const role = await this.systemRole(account.type, definition.name);
    if (role) await this.assignRole(account.id, role.id);
  }

  /** Assigns (or re-activates) a specific role on an account. */
  async assignRole(accountId: number, roleId: number): Promise<void> {
    const link = await this.accountRoleRepository.findOneBy({
      account: { id: accountId },
      role: { id: roleId },
    });
    if (link)
      await this.accountRoleRepository.update(
        { id: link.id },
        { active: true },
      );
    else
      await this.accountRoleRepository.save({
        account: { id: accountId } as Account,
        role: { id: roleId } as Role,
        active: true,
      });
  }

  private assertEditable(role: Role) {
    if (role.system)
      throw new FormError(
        'System roles are managed by the platform and cannot be changed',
      );
  }

  private async assertNameFree(scope: RoleScope, name: string) {
    const clash = await this.roleRepository
      .createQueryBuilder('role')
      .leftJoin('role.business', 'business')
      .where('LOWER(role.name) = LOWER(:name)', { name })
      .andWhere('role.type = :level', { level: scope.level })
      .andWhere(
        `(role.system = true OR ${
          scope.businessId ? 'business.id = :businessId' : 'business.id IS NULL'
        })`,
        { businessId: scope.businessId },
      )
      .getOne();
    if (clash)
      throw new FormError('Please fix the highlighted fields', {
        name: `A role called "${clash.name}" already exists`,
      });
  }
}
