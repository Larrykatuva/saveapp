import { SetMetadata } from '@nestjs/common';
import { SetPermission } from '../entities/permission.entity';

export const REQUIRED_PERMISSIONS = 'permissions:any';

/**
 * Requires at least one of the given permissions. Checked by PortalGuard, so
 * use it together with @Portal(...levels).
 */
export const RequirePermission = (...permissions: SetPermission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);
