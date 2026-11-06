import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { CredentialScopes } from '../../credentials/entities/scope.entity';
import { OnboardingStatus } from '../../onboarding/entities/business.entity';
import { API_SCOPES } from '../decorators/api.decorator';
import { ApiTokenService } from '../services/api-token.service';
import {
  CredentialService,
  CredentialWithScopes,
  normalizeIp,
} from '../services/credential.service';

/**
 * Checks a credential may be used from this request's IP: in production the
 * credential must list its IPs; elsewhere an empty list allows any address.
 */
export function assertIpAllowed(
  credential: CredentialWithScopes,
  request: Request,
  production: boolean,
  logger?: Logger,
) {
  const ips = credential.ips ?? [];
  if (!ips.length) {
    if (production)
      throw new ForbiddenException(
        'This credential has no IP whitelist. Add the IP addresses that call the API in the merchant portal.',
      );
    return;
  }
  const ip = normalizeIp(request.ip);
  if (!ips.includes(ip)) {
    logger?.warn(`Blocked API call from ${ip} for credential ${credential.id}`);
    throw new ForbiddenException(`Requests from ${ip} are not allowed`);
  }
}

/** A credential's business must be approved before it can use the API. */
export function assertBusinessApproved(credential: CredentialWithScopes) {
  if (credential.business?.status !== OnboardingStatus.Approved)
    throw new ForbiddenException(
      'Your business is not approved on SaveApp, so its API access is paused',
    );
}

/**
 * Bearer-token guard for the merchant API: valid token, active credential of
 * an approved business, caller IP on the whitelist, and the route's scope.
 * Sets request.credential and request.business.
 */
@Injectable()
export class CredentialGuard implements CanActivate {
  private readonly logger = new Logger(CredentialGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: ApiTokenService,
    private readonly credentialService: CredentialService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token)
      throw new UnauthorizedException(
        'Send the access token as Authorization: Bearer <token>',
      );

    const credential = await this.credentialService.findForApi(
      this.tokenService.verify(token),
    );
    if (!credential)
      throw new UnauthorizedException('This credential has been deactivated');
    assertBusinessApproved(credential);
    assertIpAllowed(
      credential,
      request,
      this.configService.get<string>('ENV') === 'PROD',
      this.logger,
    );

    const required = this.reflector.getAllAndOverride<CredentialScopes[]>(
      API_SCOPES,
      [context.getHandler(), context.getClass()],
    );
    if (
      required?.length &&
      !required.some((scope) => credential.scopes.includes(scope))
    )
      throw new ForbiddenException(
        `This credential is not allowed to use ${required.join(' or ')} endpoints`,
      );

    request['credential'] = credential;
    request['business'] = credential.business;
    await this.credentialService.touch(credential);
    return true;
  }
}
