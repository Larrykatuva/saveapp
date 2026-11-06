import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Account } from '../../onboarding/entities/account.entity';
import { PERMISSION_CATALOG } from '../constants/permissions.catalog';
import { RoleSets, defaultRoleSet } from '../constants/roles.catalog';
import { AccountRole } from '../entities/accountRole.entity';
import { Permission, permissionLevels } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { RolePermission } from '../entities/rolePermission.entity';

/**
 * Keeps the database in line with the code on every start:
 * 1. permissions match PERMISSION_CATALOG (new ones added, labels updated,
 *    removed ones deactivated);
 * 2. each level's system roles exist and hold exactly their definition;
 * 3. accounts without any role get their level's default role.
 */
@Injectable()
export class AuthorizationSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthorizationSyncService.name);

  constructor(
    @InjectRepository(Permission) private permissions: Repository<Permission>,
    @InjectRepository(Role) private roles: Repository<Role>,
    @InjectRepository(RolePermission)
    private rolePermissions: Repository<RolePermission>,
    @InjectRepository(AccountRole)
    private accountRoles: Repository<AccountRole>,
    @InjectRepository(Account) private accounts: Repository<Account>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.syncPermissions();
      await this.syncSystemRoles();
      await this.assignDefaultRoles();
    } catch (error) {
      this.logger.error(
        `Authorization sync failed: ${(error as Error).message}`,
      );
    }
  }

  private async syncPermissions() {
    const existing = await this.permissions.find();
    const known = new Set(PERMISSION_CATALOG.map((item) => item.name));
    for (const item of PERMISSION_CATALOG) {
      const row = existing.find((permission) => permission.name === item.name);
      const data = {
        description: item.label,
        type: item.level,
        group: item.group,
        internal: Boolean(item.internal),
        active: true,
      };
      if (row) await this.permissions.update({ id: row.id }, data);
      else await this.permissions.save({ name: item.name, ...data });
    }
    const stale = existing.filter(
      (permission) => !known.has(permission.name) && permission.active,
    );
    for (const permission of stale)
      await this.permissions.update({ id: permission.id }, { active: false });
  }

  private async syncSystemRoles() {
    for (const set of RoleSets) {
      let role = await this.roles.findOneBy({
        name: set.name,
        type: set.type,
        system: true,
      });
      if (!role)
        role = await this.roles.save({
          name: set.name,
          type: set.type,
          system: true,
          active: true,
          description: set.description,
        });
      else if (role.description !== set.description || !role.active)
        await this.roles.update(
          { id: role.id },
          { description: set.description, active: true },
        );

      // Roles with a fixed list get only those; others get the whole level
      const levelPermissions = (
        await this.permissions.findBy({
          type: In(permissionLevels(set.type)),
          active: true,
        })
      ).filter(
        (permission) =>
          !set.permissions || set.permissions.includes(permission.name),
      );
      const links = await this.rolePermissions.find({
        where: { role: { id: role.id } },
        relations: { permission: true },
      });
      for (const permission of levelPermissions) {
        const link = links.find((item) => item.permission.id === permission.id);
        if (!link)
          await this.rolePermissions.save({ role, permission, active: true });
        else if (!link.active)
          await this.rolePermissions.update({ id: link.id }, { active: true });
      }
      // System roles hold exactly their definition: drop anything extra
      const allowed = new Set(
        levelPermissions.map((permission) => permission.id),
      );
      const extra = links.filter((link) => !allowed.has(link.permission.id));
      if (extra.length) {
        await this.rolePermissions.delete(extra.map((link) => link.id));
        this.logger.log(
          `Removed ${extra.length} extra permission(s) from ${set.type} ${set.name}`,
        );
      }
    }
  }

  private async assignDefaultRoles() {
    const orphans = await this.accounts
      .createQueryBuilder('account')
      .leftJoin(AccountRole, 'ar', 'ar."accountId" = account.id')
      .where('ar.id IS NULL')
      .getMany();
    let assigned = 0;
    for (const account of orphans) {
      const set = defaultRoleSet(account.type);
      if (!set) continue;
      const role = await this.roles.findOneBy({
        name: set.name,
        type: set.type,
        system: true,
      });
      if (!role) continue;
      await this.accountRoles.save({ account, role, active: true });
      assigned += 1;
    }
    if (assigned)
      this.logger.log(
        `Assigned default system roles to ${assigned} account(s)`,
      );
  }
}
