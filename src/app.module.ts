import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import EnvConfig from './configs/env.config';
import EventsConfig from './configs/events.config';
import DatabaseConfig from './configs/database.config';
import RedisConfig from './configs/redis.config';
import MailConfig from './configs/mail.config';
import { SharedModule } from './modules/shared/shared.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuthenticationModule } from './modules/authentication/authentication.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { SettingsModule } from './modules/settings/settings.module';
import { RolesModule } from './modules/authorization/roles.module';
import { ManagementModule } from './modules/management/management.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { SiteModule } from './modules/site/site.module';

@Module({
  imports: [
    EnvConfig,
    EventsConfig,
    DatabaseConfig,
    RedisConfig,
    MailConfig,
    ScheduleModule.forRoot(),
    SharedModule,
    NotificationsModule,
    AuthenticationModule,
    OnboardingModule,
    SettingsModule,
    RolesModule,
    ManagementModule,
    DashboardModule,
    AnalyticsModule,
    IntegrationsModule,
    SiteModule,
  ],
})
export class AppModule {}
