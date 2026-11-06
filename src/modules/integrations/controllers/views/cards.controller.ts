import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  ApprovedOnly,
  Portal,
} from '../../../authentication/decorators/portal.decorator';
import { Purpose } from '../../../authentication/entities/code.entity';
import { User } from '../../../authentication/entities/user.entity';
import { AttemptService } from '../../../authentication/services/attempt.service';
import { AuthService } from '../../../authentication/services/auth.service';
import { CodeService } from '../../../authentication/services/code.service';
import { RequirePermission } from '../../../authorization/decorators/require-permission.decorator';
import {
  MERCHANT_LEVELS,
  SetPermission,
} from '../../../authorization/entities/permission.entity';
import { Card, CardState } from '../../../cards/entities/card.entity';
import { Account } from '../../../onboarding/entities/account.entity';
import { EmailTemplate } from '../../../shared/constants/email-templates';
import { PORTALS } from '../../../shared/constants/portals';
import { fragment, portalView } from '../../../shared/utils/portal-view.util';
import { CardDetailsService } from '../../services/card-details.service';
import { CardActor, CardService } from '../../services/card.service';
import { CardsPresenter } from '../../services/cards-presenter.service';

const BASE = '/merchant/cards';

// Full card details in the portal: a code sent to the signed-in user
const REVEAL_CODE_MINUTES = 5;
const REVEAL_RESEND_MS = 60_000;
const REVEAL_MAX_WRONG = 5;
const REVEAL_WINDOW_MS = 15 * 60_000;
// How long the portal keeps the details on screen before hiding them
const REVEAL_SHOW_SECONDS = 60;

/** "6224545300493690" → "6224 5453 0049 3690" */
const groupDigits = (value: string) => value.replace(/(\d{4})(?=\d)/g, '$1 ');

/** UnionPay's expiry ("2031-11-30T00:00:00", or already "11/31") as MM/YY. */
const shortExpiry = (value: string | null) => {
  if (!value) return '--/--';
  const iso = /^(\d{4})-(\d{2})/.exec(value);
  return iso ? `${iso[2]}/${iso[1].slice(2)}` : value;
};

/**
 * Cards the business issued through the API: the list, and a drawer with
 * what SaveApp stores plus live details from UnionPay (status, balance,
 * recent transactions). Full number, expiry and CVV are shown after a
 * one-time code sent to the signed-in user. Changes to cards happen through
 * the API.
 */
@ApiExcludeController()
@Controller('merchant/cards')
@Portal(...MERCHANT_LEVELS)
@ApprovedOnly()
@RequirePermission(SetPermission.MerchantCardsView)
export class CardsViewController {
  constructor(
    private readonly cardService: CardService,
    private readonly presenter: CardsPresenter,
    private readonly cardDetailsService: CardDetailsService,
    private readonly authService: AuthService,
    private readonly codeService: CodeService,
    private readonly attemptService: AttemptService,
  ) {}

  private businessId(req: Request) {
    return (req['account'] as Account).business.id;
  }

  private actor(req: Request): CardActor {
    const account = req['account'] as Account;
    const user = req['user'] as User;
    return { account, label: user.fullName || user.email };
  }

  /** Cards whose full details can be asked for (UnionPay refuses the rest). */
  private revealable(card: Card) {
    return card.status === CardState.Active;
  }

  @Get()
  async page(
    @Req() req: Request,
    @Res() res: Response,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page = '1',
  ) {
    const businessId = this.businessId(req);
    return res.render(
      'pages/cards/index',
      portalView(PORTALS.merchant, req, 'Cards', {
        q,
        status,
        tabs: await this.presenter.tabs(businessId, status),
        ...(await this.presenter.table(
          businessId,
          q,
          status,
          Number(page),
          BASE,
        )),
      }),
    );
  }

  @Get('table')
  async tableFragment(
    @Req() req: Request,
    @Res() res: Response,
    @Query('q') q = '',
    @Query('status') status = '',
    @Query('page') page = '1',
  ) {
    return fragment(
      res,
      'cards/table',
      await this.presenter.table(
        this.businessId(req),
        q,
        status,
        Number(page),
        BASE,
      ),
    );
  }

  @Get(':id')
  async drawer(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const card = await this.cardService.findInBusiness(
      this.businessId(req),
      id,
    );
    if (!card)
      return res.status(404).json({ ok: false, message: 'Card not found' });
    return fragment(
      res,
      'cards/drawer',
      await this.presenter.drawer(
        card,
        BASE,
        this.revealable(card) ? `${BASE}/${card.id}/reveal` : null,
      ),
    );
  }

  /** Live from UnionPay; each part fails on its own without breaking the rest. */
  @Get(':id/live')
  async live(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const card = await this.cardService.findInBusiness(
      this.businessId(req),
      id,
    );
    if (!card)
      return res.status(404).json({ ok: false, message: 'Card not found' });
    return fragment(
      res,
      'cards/live',
      await this.presenter.live(card, '/merchant/transactions'),
    );
  }

  /**
   * Full details, step 1: sends a one-time code to the signed-in user (SMS to
   * a verified phone, otherwise email) and remembers which card it is for.
   */
  @Post(':id/reveal')
  @RequirePermission(SetPermission.MerchantCardsReveal)
  async requestReveal(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const card = await this.cardService.findInBusiness(
      this.businessId(req),
      id,
    );
    if (!card)
      return res.status(404).json({ ok: false, message: 'Card not found' });
    if (!this.revealable(card))
      return res.status(400).json({
        ok: false,
        message: `This card is ${card.status.toLowerCase()}, so its details can't be shown`,
      });

    const user = req['user'] as User;
    const cooldown = `resend:card-details:${user.id}`;
    if (await this.attemptService.onCooldown(cooldown))
      return res.status(429).json({
        ok: false,
        message: 'Please wait a minute before requesting another code',
      });
    await this.attemptService.startCooldown(cooldown, REVEAL_RESEND_MS);

    const last4 = (card.accountNumber ?? '').slice(-4);
    await this.authService.sendOtp(
      user,
      Purpose.CardDetails,
      REVEAL_CODE_MINUTES,
      {
        subject: '{code} is your SaveApp card details code',
        template: EmailTemplate.CardDetailsCode,
      },
      (code) =>
        `${code} is your SaveApp code to see the details of card ending ${last4}. It expires in ${REVEAL_CODE_MINUTES} minutes. Never share it.`,
    );
    req.session.cardReveal = {
      cardId: card.id,
      expires: Date.now() + REVEAL_CODE_MINUTES * 60_000,
    };
    const destination = this.authService.destinationFor(user);
    await this.cardService.log(
      card,
      this.actor(req),
      'Details requested',
      `One-time code sent to ${destination}`,
    );
    return res.json({
      ok: true,
      message: `We sent a 6-digit code to ${destination}`,
      expiresIn: REVEAL_CODE_MINUTES * 60,
    });
  }

  /**
   * Full details, step 2: checks the code and answers with the number,
   * expiry and CVV straight from UnionPay. Never stored or cached.
   */
  @Post(':id/reveal/verify')
  @RequirePermission(SetPermission.MerchantCardsReveal)
  async verifyReveal(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body('code') code: unknown,
  ) {
    res.set('Cache-Control', 'no-store');
    const card = await this.cardService.findInBusiness(
      this.businessId(req),
      id,
    );
    if (!card)
      return res.status(404).json({ ok: false, message: 'Card not found' });

    const pending = req.session.cardReveal;
    if (!pending || pending.cardId !== card.id || pending.expires < Date.now())
      return res.status(400).json({
        ok: false,
        message: 'Request a new code for this card',
      });

    const user = req['user'] as User;
    const wrongKey = `card-details:wrong:${user.id}`;
    if (await this.attemptService.isBlocked(wrongKey, REVEAL_MAX_WRONG)) {
      delete req.session.cardReveal;
      return res.status(429).json({
        ok: false,
        message: 'Too many wrong codes. Try again in 15 minutes.',
      });
    }
    const entered = typeof code === 'string' ? code.replace(/\D/g, '') : '';
    const valid =
      entered.length === 6 &&
      (await this.codeService.consume(user, Purpose.CardDetails, entered));
    if (!valid) {
      await this.attemptService.fail(wrongKey, REVEAL_WINDOW_MS);
      return res.status(400).json({
        ok: false,
        message: 'That code is wrong or has expired',
      });
    }
    await this.attemptService.clear(wrongKey);
    delete req.session.cardReveal;

    try {
      const details = await this.cardDetailsService.reveal(
        card,
        this.actor(req),
        'code sent to the signed-in user',
      );
      return res.json({
        ok: true,
        number: groupDigits(details.cardNumber),
        expiry: shortExpiry(details.expiry),
        cvv: details.cvv,
        showFor: REVEAL_SHOW_SECONDS,
      });
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 502;
      return res.status(status).json({
        ok: false,
        message:
          error instanceof HttpException
            ? error.message
            : 'UnionPay could not be reached. Request a new code and try again.',
      });
    }
  }
}
