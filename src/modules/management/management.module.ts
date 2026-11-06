import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { Account } from '../onboarding/entities/account.entity';
import { Business } from '../onboarding/entities/business.entity';
import { Kyc } from '../onboarding/entities/kyc.entity';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { MerchantsViewController } from './controllers/views/merchants.controller';
import { KycReviewService } from './services/kyc-review.service';
import { MerchantAdminService } from './services/merchant-admin.service';
import { MerchantWorkspaceService } from './services/merchant-workspace.service';

/** The SaveApp team's merchant list, workspace and KYC review. */
@Module({
  imports: [
    AuthenticationModule,
    OnboardingModule,
    AnalyticsModule,
    TypeOrmModule.forFeature([Business, Account, Kyc]),
  ],
  controllers: [MerchantsViewController],
  providers: [MerchantAdminService, MerchantWorkspaceService, KycReviewService],
  exports: [MerchantAdminService, MerchantWorkspaceService],
})
export class ManagementModule {}
