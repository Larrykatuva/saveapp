import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthenticationModule } from '../authentication/authentication.module';
import { Business } from '../onboarding/entities/business.entity';
import { Requirement } from '../onboarding/entities/requirement.entity';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { SharedModule } from '../shared/shared.module';
import {
  AdminSettingsViewController,
  MerchantSettingsViewController,
} from './controllers/views/account-settings.controller';
import { CountriesViewController } from './controllers/views/countries.controller';
import { RequirementsViewController } from './controllers/views/requirements.controller';
import { Country } from './entities/country.entity';
import { CountryService } from './services/country.service';

/**
 * Settings pages: countries and onboarding requirements (admin), the
 * business profile and notifications (merchant), and My account (both).
 */
@Module({
  imports: [
    SharedModule,
    AuthenticationModule,
    OnboardingModule,
    TypeOrmModule.forFeature([Country, Business, Requirement]),
  ],
  controllers: [
    CountriesViewController,
    RequirementsViewController,
    AdminSettingsViewController,
    MerchantSettingsViewController,
  ],
  providers: [CountryService],
  exports: [CountryService],
})
export class SettingsModule {}
