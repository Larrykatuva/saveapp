import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { AuthorizationLevel } from '../../authorization/entities/permission.entity';
import {
  APPROVED_ONLY,
  PORTAL_LEVELS,
  PortalGuard,
} from '../guards/portal.guard';

/**
 * Restricts a view route to signed-in users whose active account has one of
 * these levels, e.g. @Portal(AuthorizationLevel.Staff) or
 * @Portal(...MERCHANT_LEVELS). The user and account are exposed as
 * `req.user`/`req.account` and to templates as {{user}}/{{account}}.
 */
export const Portal = (...levels: AuthorizationLevel[]) =>
  applyDecorators(SetMetadata(PORTAL_LEVELS, levels), UseGuards(PortalGuard));

/**
 * A merchant page that opens once the business is approved; until then the
 * merchant is sent back to the onboarding status on the dashboard.
 */
export const ApprovedOnly = () => SetMetadata(APPROVED_ONLY, true);
