import {
  Body,
  Controller,
  Get,
  Header,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Card, CardState } from '../../../cards/entities/card.entity';
import { CredentialScopes } from '../../../credentials/entities/scope.entity';
import { Business } from '../../../onboarding/entities/business.entity';
import { PaginatedResponsePipe } from '../../../shared/pipes/paginated-response.pipe';
import { ResponsePipe } from '../../../shared/pipes/response.pipe';
import {
  ApiBusiness,
  ApiCredential,
  ApiScopes,
} from '../../decorators/api.decorator';
import {
  CardBalanceResDto,
  CardDetailsChallengeResDto,
  FullCardDetailsResDto,
  VerifyCardDetailsReqDto,
  CardDetailsResDto,
  CardResDto,
  CardStatusReqDto,
  CardTransactionsQueryDto,
  CardTransactionsResDto,
  CardsQueryDto,
  CreateCardReqDto,
  ReplaceCardReqDto,
} from '../../dtos/integrations-api.dtos';
import { CredentialGuard } from '../../guards/credential.guard';
import { CardDetailsService } from '../../services/card-details.service';
import { CardActor, CardService } from '../../services/card.service';
import type { CredentialWithScopes } from '../../services/credential.service';
import { TransactionService } from '../../services/transaction.service';

export const cardView = (card: Card): CardResDto => ({
  reference: card.reference,
  name: card.name,
  description: card.description,
  maskedNumber: card.accountNumber,
  type: card.type,
  currency: card.currency,
  status: card.status,
  expiryDate: card.expiryDate,
  issuedAt: card.issuedAt,
  cardholder: { alias: card.holder?.alias, mobile: card.holder?.mobile },
  createdAt: card.createdAt,
});

const actor = (credential: CredentialWithScopes): CardActor => ({
  label: `API key ${credential.name} (${credential.hint}…)`,
});

/**
 * UnionPay cards for a merchant's customers. Needs a credential with the
 * Card scope; every card belongs to the credential's business.
 */
@ApiTags('Cards')
@ApiBearerAuth('access-token')
@Controller('api')
@UseGuards(CredentialGuard)
@ApiScopes(CredentialScopes.Card)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class CardsApiController {
  constructor(
    private readonly cardService: CardService,
    private readonly cardDetailsService: CardDetailsService,
    private readonly transactionService: TransactionService,
  ) {}

  private async card(business: Business, reference: string): Promise<Card> {
    const card = await this.cardService.findByReference(business.id, reference);
    if (!card) throw new NotFoundException('Card not found');
    return card;
  }

  /**
   * UnionPay stops listing a card's transactions once it is replaced or
   * terminated, so store them first. A failed pull doesn't block the change.
   */
  private async keepTransactions(card: Card, business: Business) {
    if (
      card.status === CardState.Terminated ||
      card.status === CardState.Replaced
    )
      return;
    await this.transactionService
      .syncCard(card, business.id)
      .catch(() => undefined);
  }

  /** Cards of the business, newest first. */
  @Get('cards')
  @PaginatedResponsePipe(CardResDto, HttpStatus.OK)
  async list(
    @ApiBusiness() business: Business,
    @Query() filters: CardsQueryDto,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '10',
  ): Promise<[CardResDto[], number]> {
    const result = await this.cardService.search(
      business.id,
      filters,
      Number(page),
      Number(pageSize),
    );
    return [result.items.map(cardView), result.total];
  }

  /**
   * Issues a card to the mobile number's cardholder (registered with
   * UnionPay on first use).
   */
  @Post('cards')
  @ResponsePipe(CardResDto, HttpStatus.CREATED)
  async create(
    @ApiBusiness() business: Business,
    @ApiCredential() credential: CredentialWithScopes,
    @Body() body: CreateCardReqDto,
  ): Promise<CardResDto> {
    return cardView(
      await this.cardService.issue(business, body, actor(credential)),
    );
  }

  @Get('card/:reference')
  @ResponsePipe(CardResDto, HttpStatus.OK)
  async get(
    @ApiBusiness() business: Business,
    @Param('reference') reference: string,
  ): Promise<CardResDto> {
    return cardView(await this.card(business, reference));
  }

  /** Live status and expiry from UnionPay. */
  @Get('card/:reference/details')
  @ResponsePipe(CardDetailsResDto, HttpStatus.OK)
  async details(
    @ApiBusiness() business: Business,
    @Param('reference') reference: string,
  ): Promise<CardDetailsResDto> {
    const card = await this.card(business, reference);
    return { reference, ...(await this.cardService.liveDetails(card)) };
  }

  @Get('card/:reference/balance')
  @ResponsePipe(CardBalanceResDto, HttpStatus.OK)
  async balance(
    @ApiBusiness() business: Business,
    @Param('reference') reference: string,
  ): Promise<CardBalanceResDto> {
    const card = await this.card(business, reference);
    return { reference, ...(await this.cardService.balance(card)) };
  }

  @Get('card/:reference/transactions')
  @ResponsePipe(CardTransactionsResDto, HttpStatus.OK)
  async transactions(
    @ApiBusiness() business: Business,
    @Param('reference') reference: string,
    @Query() query: CardTransactionsQueryDto,
  ): Promise<CardTransactionsResDto> {
    const card = await this.card(business, reference);
    return {
      reference,
      ...(await this.cardService.transactions(card, query)),
    };
  }

  /** Block, unblock or permanently terminate a card. */
  @Post('card/:reference/status')
  @ResponsePipe(CardResDto, HttpStatus.OK)
  async status(
    @ApiBusiness() business: Business,
    @ApiCredential() credential: CredentialWithScopes,
    @Param('reference') reference: string,
    @Body() body: CardStatusReqDto,
  ): Promise<CardResDto> {
    const card = await this.card(business, reference);
    if (body.action === 'terminate')
      await this.keepTransactions(card, business);
    return cardView(
      await this.cardService.setStatus(
        card,
        body.action,
        body.reason,
        actor(credential),
      ),
    );
  }

  /**
   * Step 1 of seeing the full card details: sends a one-time code to your
   * webhook endpoints as a card.details_otp event and answers with the
   * challenge id. The code is valid for 5 minutes.
   */
  @Post('card/:reference/details')
  @ResponsePipe(CardDetailsChallengeResDto, HttpStatus.ACCEPTED)
  async requestDetails(
    @ApiBusiness() business: Business,
    @ApiCredential() credential: CredentialWithScopes,
    @Param('reference') reference: string,
  ): Promise<CardDetailsChallengeResDto> {
    const card = await this.card(business, reference);
    return this.cardDetailsService.request(
      card,
      credential,
      business.id,
      actor(credential),
    );
  }

  /**
   * Step 2: send back the challenge id and the code from the webhook to get
   * the full card number, expiry and CVV. Single use; never cached.
   */
  @Post('card/:reference/details/verify')
  @ResponsePipe(FullCardDetailsResDto, HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async verifyDetails(
    @ApiBusiness() business: Business,
    @ApiCredential() credential: CredentialWithScopes,
    @Param('reference') reference: string,
    @Body() body: VerifyCardDetailsReqDto,
  ): Promise<FullCardDetailsResDto> {
    const card = await this.card(business, reference);
    return this.cardDetailsService.verify(
      card,
      credential,
      body.challengeId,
      body.otp,
      actor(credential),
    );
  }

  /** Replaces a card; the answer is the new card and the old one stops working. */
  @Post('card/:reference/replace')
  @ResponsePipe(CardResDto, HttpStatus.CREATED)
  async replace(
    @ApiBusiness() business: Business,
    @ApiCredential() credential: CredentialWithScopes,
    @Param('reference') reference: string,
    @Body() body: ReplaceCardReqDto,
  ): Promise<CardResDto> {
    const card = await this.card(business, reference);
    await this.keepTransactions(card, business);
    return cardView(
      await this.cardService.replace(card, body.reason, actor(credential)),
    );
  }
}
