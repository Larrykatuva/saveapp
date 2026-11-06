import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthenticationModule } from '../authentication/authentication.module';
import { Card } from '../cards/entities/card.entity';
import { CardLog } from '../cards/entities/cardLog.entity';
import { Holder } from '../cards/entities/holder.entity';
import { Credential } from '../credentials/entities/credential.entity';
import { CredentialLog } from '../credentials/entities/credentialLog.entity';
import { Scope } from '../credentials/entities/scope.entity';
import { Account } from '../onboarding/entities/account.entity';
import { Business } from '../onboarding/entities/business.entity';
import { SharedModule } from '../shared/shared.module';
import { UnionpayService } from '../unionpay/integrations/unionpay.service';
import { AuthApiController } from './controllers/apis/auth-api.controller';
import { CardsApiController } from './controllers/apis/cards-api.controller';
import { TerrakaWebhookController } from './controllers/apis/terraka-webhook.controller';
import { CardsViewController } from './controllers/views/cards.controller';
import { IntegrationsViewController } from './controllers/views/integrations.controller';
import { CardChallenge } from './entities/card-challenge.entity';
import { Webhook } from './entities/webhook.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { CredentialGuard } from './guards/credential.guard';
import { ApiTokenService } from './services/api-token.service';
import { CardDetailsService } from './services/card-details.service';
import { CardService } from './services/card.service';
import { CredentialService } from './services/credential.service';
import { WebhookService } from './services/webhook.service';
import { WebhookLogService } from './services/webhook-log.service';
import { CardTransaction } from '../cards/entities/cardTransaction.entity';
import { TransactionsViewController } from './controllers/views/transactions.controller';
import { TransactionService } from './services/transaction.service';
import { ManagementModule } from '../management/management.module';
import {
  MerchantCardsWorkspaceController,
  MerchantIntegrationsWorkspaceController,
  MerchantTransactionsWorkspaceController,
} from './controllers/views/merchant-workspace.controller';
import { CardsPresenter } from './services/cards-presenter.service';
import { TransactionsPresenter } from './services/transactions-presenter.service';

/**
 * The merchant API and its portal pages: API credentials and access tokens
 * (with IP whitelist and scope checks), UnionPay cards issued through
 * Terraka, and webhooks that forward Terraka's card events to merchants.
 */
@Module({
  imports: [
    SharedModule,
    AuthenticationModule,
    ManagementModule,
    JwtModule.register({}),
    TypeOrmModule.forFeature([
      Credential,
      CredentialLog,
      Scope,
      Webhook,
      WebhookDelivery,
      CardChallenge,
      Card,
      CardLog,
      CardTransaction,
      Holder,
      Business,
      Account,
    ]),
  ],
  controllers: [
    AuthApiController,
    CardsApiController,
    TerrakaWebhookController,
    IntegrationsViewController,
    CardsViewController,
    TransactionsViewController,
    MerchantCardsWorkspaceController,
    MerchantTransactionsWorkspaceController,
    MerchantIntegrationsWorkspaceController,
  ],
  providers: [
    CredentialService,
    ApiTokenService,
    CardService,
    CardDetailsService,
    TransactionService,
    CardsPresenter,
    TransactionsPresenter,
    WebhookService,
    WebhookLogService,
    UnionpayService,
    CredentialGuard,
  ],
})
export class IntegrationsModule {}
