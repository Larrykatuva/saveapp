import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthenticationModule } from '../authentication/authentication.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { Country } from '../settings/entities/country.entity';
import { CountryService } from '../settings/services/country.service';
import { SharedModule } from '../shared/shared.module';
import { MerchantOnboardingViewController } from './controllers/views/merchant-onboarding.controller';
import { OnboardingViewController } from './controllers/views/onboarding.controller';
import { Account } from './entities/account.entity';
import { Business } from './entities/business.entity';
import { Customer } from './entities/customer.entity';
import { Invite } from './entities/invite.entity';
import { Kyc } from './entities/kyc.entity';
import { Requirement } from './entities/requirement.entity';
import { BusinessService } from './services/business.service';
import { KycStorageService } from './services/kyc-storage.service';
import { KycService } from './services/kyc.service';
import { RequirementService } from './services/requirement.service';

@Module({
  imports: [
    SharedModule,
    AuthenticationModule,
    AuthorizationModule,
    TypeOrmModule.forFeature([
      Account,
      Business,
      Customer,
      Invite,
      Kyc,
      Requirement,
      Country,
    ]),
  ],
  controllers: [OnboardingViewController, MerchantOnboardingViewController],
  providers: [
    BusinessService,
    KycService,
    RequirementService,
    KycStorageService,
    // Country picker on the business form (SettingsModule imports this module)
    CountryService,
  ],
  exports: [BusinessService, KycService, RequirementService],
})
export class OnboardingModule {}
