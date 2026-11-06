import {
  Body,
  Controller,
  ForbiddenException,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AttemptService } from '../../../authentication/services/attempt.service';
import { ResponsePipe } from '../../../shared/pipes/response.pipe';
import { TokenReqDto, TokenResDto } from '../../dtos/integrations-api.dtos';
import {
  assertBusinessApproved,
  assertIpAllowed,
} from '../../guards/credential.guard';
import { ApiTokenService } from '../../services/api-token.service';
import { CredentialService } from '../../services/credential.service';
import { isProduction } from '../../../../configs/environment';

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;

/** Client-credentials exchange: client id and secret for an access token. */
@ApiTags('Authentication')
@Controller('api/auth')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class AuthApiController {
  private readonly logger = new Logger(AuthApiController.name);

  constructor(
    private readonly credentialService: CredentialService,
    private readonly tokenService: ApiTokenService,
    private readonly attemptService: AttemptService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Returns a one-hour access token. The call must come from an IP on the
   * credential's whitelist; five wrong secrets lock the client id for 15
   * minutes.
   */
  @Post('token')
  @ResponsePipe(TokenResDto, HttpStatus.OK)
  async token(
    @Req() req: Request,
    @Body() body: TokenReqDto,
  ): Promise<TokenResDto> {
    const key = `api-token:${body.client_id.trim()}`;
    if (await this.attemptService.isBlocked(key, MAX_FAILURES))
      throw new ForbiddenException(
        'Too many failed attempts for this client id. Try again in 15 minutes.',
      );
    const credential = await this.credentialService.verify(
      body.client_id,
      body.client_secret,
    );
    if (!credential) {
      await this.attemptService.fail(key, LOCKOUT_MS);
      throw new UnauthorizedException('Invalid client credentials');
    }
    if (!credential.active)
      throw new UnauthorizedException('This credential has been deactivated');
    assertBusinessApproved(credential);
    assertIpAllowed(
      credential,
      req,
      isProduction(this.configService.get<string>('ENV')),
      this.logger,
    );
    await this.attemptService.clear(key);
    await this.credentialService.touch(credential);
    return this.tokenService.issue(credential);
  }
}
