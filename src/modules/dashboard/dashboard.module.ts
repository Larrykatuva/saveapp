import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { ManagementModule } from '../management/management.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import {
  AdminDashboardController,
  MerchantDashboardController,
} from './controllers/views/dashboard.controller';

/** The overview page of each portal. */
@Module({
  imports: [
    AuthenticationModule,
    OnboardingModule,
    ManagementModule,
    AnalyticsModule,
  ],
  controllers: [AdminDashboardController, MerchantDashboardController],
})
export class DashboardModule {}
