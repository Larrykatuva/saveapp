import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../authentication/authentication.module';
import { AuthorizationModule } from './authorization.module';
import {
  AdminRolesViewController,
  MerchantRolesViewController,
} from './controllers/views/roles.controller';
import {
  AdminTeamViewController,
  MerchantTeamViewController,
} from './controllers/views/team.controller';

/**
 * Team (members, invitations) and roles & permissions pages for the admin
 * and merchant portals. Kept apart from AuthorizationModule so
 * AuthenticationModule can depend on the authorization services without a
 * circular import.
 */
@Module({
  imports: [AuthenticationModule, AuthorizationModule],
  controllers: [
    // Roles first: /team/roles must not be taken for a team sub-route
    AdminRolesViewController,
    MerchantRolesViewController,
    AdminTeamViewController,
    MerchantTeamViewController,
  ],
})
export class RolesModule {}
