import {
  ExecutionContext,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import { CredentialScopes } from '../../credentials/entities/scope.entity';
import { Business } from '../../onboarding/entities/business.entity';
import type { CredentialWithScopes } from '../services/credential.service';

export const API_SCOPES = 'api:scopes';

/** Scopes (any of) a credential needs for an API route; checked by CredentialGuard. */
export const ApiScopes = (...scopes: CredentialScopes[]) =>
  SetMetadata(API_SCOPES, scopes);

/** The credential that signed the request (set by CredentialGuard). */
export const ApiCredential = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CredentialWithScopes =>
    context.switchToHttp().getRequest<Request>()[
      'credential'
    ] as CredentialWithScopes,
);

/** The credential's business (set by CredentialGuard). */
export const ApiBusiness = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Business =>
    context.switchToHttp().getRequest<Request>()['business'] as Business,
);
