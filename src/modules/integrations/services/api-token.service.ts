import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CredentialWithScopes } from './credential.service';

export const TOKEN_SECONDS = 3600;
const TOKEN_TYPE = 'merchant-api';

interface ApiTokenPayload {
  cid: number;
  typ: string;
}

export interface AccessToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scopes: string[];
}

/**
 * Access tokens for the merchant API (as scripay-wallet does it): a client
 * id and secret are exchanged for a one-hour HS256 JWT signed with
 * PRIVATE_KEY. The token only names the credential; the guard re-checks the
 * credential on every call, so deactivating it takes effect at once.
 */
@Injectable()
export class ApiTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private get secret(): string {
    return this.configService.getOrThrow<string>('PRIVATE_KEY');
  }

  issue(credential: CredentialWithScopes): AccessToken {
    return {
      access_token: this.jwtService.sign<ApiTokenPayload>(
        { cid: credential.id, typ: TOKEN_TYPE },
        { secret: this.secret, expiresIn: TOKEN_SECONDS },
      ),
      token_type: 'Bearer',
      expires_in: TOKEN_SECONDS,
      scopes: credential.scopes,
    };
  }

  /** The credential id a token was issued for. */
  verify(token: string): number {
    let payload: ApiTokenPayload;
    try {
      payload = this.jwtService.verify<ApiTokenPayload>(token, {
        secret: this.secret,
      });
    } catch (error) {
      throw new UnauthorizedException(
        (error as Error).name === 'TokenExpiredError'
          ? 'Access token has expired. Request a new one.'
          : 'Invalid access token',
      );
    }
    if (payload.typ !== TOKEN_TYPE || !payload.cid)
      throw new UnauthorizedException('Invalid access token');
    return payload.cid;
  }
}
