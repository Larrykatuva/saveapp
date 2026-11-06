import { Column, Entity, ManyToOne, Unique } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';
import { Role } from './role.entity';
import { Permission } from './permission.entity';

@Entity()
@Unique(['role', 'permission'])
export class RolePermission extends CommonEntity {
  @ManyToOne(() => Role, (role: Role) => role.id, { onDelete: 'CASCADE' })
  role: Role;

  @ManyToOne(() => Permission, (permission: Permission) => permission.id, {
    onDelete: 'CASCADE',
  })
  permission: Permission;

  @Column({ type: Boolean, default: true })
  active: boolean;
}
