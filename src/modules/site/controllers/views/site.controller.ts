import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { routeAfterSignIn } from '../../../authentication/utils/session.util';
import { AccountService } from '../../../onboarding/services/account.service';
import { TOKEN_SECONDS } from '../../../integrations/services/api-token.service';

/**
 * Public pages: the landing page (signed-in people go straight to their
 * portal) and the developer guide for integrating with the merchant API.
 */
@ApiExcludeController()
@Controller()
export class SiteViewController {
  constructor(private readonly accountService: AccountService) {}

  @Get()
  async landing(@Req() req: Request, @Res() res: Response) {
    if (req.session.userId)
      return routeAfterSignIn(req, res, this.accountService);
    return res.render('pages/site/landing', {
      layout: 'layouts/site',
      title: 'Cards for your customers',
      apiBase: `${req.protocol}://${req.get('host')}/api`,
    });
  }

  @Get('developers')
  developers(@Req() req: Request, @Res() res: Response) {
    const origin = `${req.protocol}://${req.get('host')}`;
    return res.render('pages/site/developers', {
      layout: 'layouts/site',
      title: 'Developer guide',
      bodyClass: 'site-docs',
      apiBase: `${origin}/api`,
      docsUrl: `${origin}/docs`,
      tokenMinutes: TOKEN_SECONDS / 60,
    });
  }
}
