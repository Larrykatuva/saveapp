import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EntityService } from '../../shared/services/entity.service';
import { PERMISSION_GROUPS } from '../constants/permissions.catalog';
import { AccountRole } from '../entities/accountRole.entity';
import {
  AuthorizationLevel,
  Permission,
  SetPermission,
  permissionLevels,
} from '../entities/permission.entity';

@Injectable()
export class PermissionService extends EntityService<Permission> {
  constructor(
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
    @InjectRepository(AccountRole)
    private accountRoleRepository: Repository<AccountRole>,
  ) {
    super();
    super.setRepository(this.permissionRepository);
  }

  /**
   * Everything an account may do: the union of the active permissions of its
   * active roles.
   */
  async permissionsFor(accountId: number): Promise<SetPermission[]> {
    const rows = await this.accountRoleRepository
      .createQueryBuilder('accountRole')
      .innerJoin('accountRole.role', 'role', 'role.active = true')
      .innerJoin(
        'role_permission',
        'rp',
        'rp."roleId" = role.id AND rp.active = true',
      )
      .innerJoin(
        'permission',
        'permission',
        'permission.id = rp."permissionId" AND permission.active = true',
      )
      .where('"accountRole"."accountId" = :accountId', { accountId })
      .andWhere('accountRole.active = true')
      .select('DISTINCT permission.name', 'name')
      .getRawMany<{ name: SetPermission }>();
    return rows.map((row) => row.name);
  }

  /** Permissions a role of this level can hold. */
  async forLevel(level: AuthorizationLevel): Promise<Permission[]> {
    return this.filterMany(
      { type: In(permissionLevels(level)), active: true },
      { order: { id: 'ASC' } },
    );
  }

  /** Permissions grouped under their headings, in display order. */
  group<T extends { group: string }>(permissions: T[]) {
    const order = (group: string) => {
      const index = PERMISSION_GROUPS.indexOf(group);
      return index === -1 ? PERMISSION_GROUPS.length : index;
    };
    const groups = new Map<string, T[]>();
    for (const permission of permissions)
      groups.set(permission.group, [
        ...(groups.get(permission.group) ?? []),
        permission,
      ]);
    return [...groups.entries()]
      .sort(([a], [b]) => order(a) - order(b))
      .map(([group, items]) => ({ group, items }));
  }
}
