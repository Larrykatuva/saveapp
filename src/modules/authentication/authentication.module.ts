import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorizationModule } from '../authorization/authorization.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Account } from '../onboarding/entities/account.entity';
import { AccountService } from '../onboarding/services/account.service';
import { SharedModule } from '../shared/shared.module';
import { AuthViewController } from './controllers/views/auth.controller';
import { InviteViewController } from './controllers/views/invite.controller';
import { Authenticator } from './entities/authenticator.entity';
import { Code } from './entities/code.entity';
import { User } from './entities/user.entity';
import { ForbiddenPageFilter, RedirectFilter } from './filters/redirect.filter';
import { PortalGuard } from './guards/portal.guard';
import { SignedInGuard } from './guards/signed-in.guard';
import { AttemptService } from './services/attempt.service';
import { AuthService } from './services/auth.service';
import { AuthenticatorService } from './services/authenticator.service';
import { CodeService } from './services/code.service';
import { UserService } from './services/user.service';

@Module({
  imports: [
    SharedModule,
    NotificationsModule,
    AuthorizationModule,
    TypeOrmModule.forFeature([User, Code, Account, Authenticator]),
  ],
  controllers: [AuthViewController, InviteViewController],
  providers: [
    UserService,
    CodeService,
    AttemptService,
    AuthService,
    AuthenticatorService,
    AccountService,
    PortalGuard,
    SignedInGuard,
    { provide: APP_FILTER, useClass: RedirectFilter },
    { provide: APP_FILTER, useClass: ForbiddenPageFilter },
  ],
  exports: [
    UserService,
    AccountService,
    AuthService,
    AuthenticatorService,
    AttemptService,
    CodeService,
    PortalGuard,
    SignedInGuard,
    AuthorizationModule,
    NotificationsModule,
  ],
})
export class AuthenticationModule {}
