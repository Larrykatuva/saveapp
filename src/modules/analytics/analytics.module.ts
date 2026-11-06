import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../authentication/authentication.module';
import {
  AdminAnalyticsViewController,
  MerchantAnalyticsViewController,
} from './controllers/views/analytics.controller';
import { AnalyticsPresenter } from './services/analytics-presenter.service';
import { AnalyticsService } from './services/analytics.service';
import { OverviewPresenter } from './services/overview-presenter.service';

/** Analytics page of both portals (charts over cards, transactions, events). */
@Module({
  imports: [AuthenticationModule],
  controllers: [MerchantAnalyticsViewController, AdminAnalyticsViewController],
  providers: [AnalyticsService, AnalyticsPresenter, OverviewPresenter],
  exports: [AnalyticsService, AnalyticsPresenter, OverviewPresenter],
})
export class AnalyticsModule {}
