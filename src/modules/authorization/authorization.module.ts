import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../authentication/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { Account } from '../onboarding/entities/account.entity';
import { Business } from '../onboarding/entities/business.entity';
import { Invite } from '../onboarding/entities/invite.entity';
import { AccountRole } from './entities/accountRole.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/rolePermission.entity';
import { AuthorizationSyncService } from './services/authorization-sync.service';
import { InviteService } from './services/invite.service';
import { PermissionService } from './services/permission.service';
import { RoleService } from './services/role.service';
import { TeamPresenter } from './services/team-presenter.service';
import { TeamService } from './services/team.service';

/** Roles, permissions, team members and invitations (services only; pages live in RolesModule). */
@Module({
  imports: [
    NotificationsModule,
    TypeOrmModule.forFeature([
      Permission,
      Role,
      RolePermission,
      AccountRole,
      Account,
      Business,
      Invite,
      User,
    ]),
  ],
  providers: [
    PermissionService,
    RoleService,
    TeamService,
    TeamPresenter,
    InviteService,
    AuthorizationSyncService,
  ],
  exports: [
    PermissionService,
    RoleService,
    TeamService,
    TeamPresenter,
    InviteService,
  ],
})
export class AuthorizationModule {}
