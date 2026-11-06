import { Column, Entity, Index } from 'typeorm';
import { CommonEntity } from '../../shared/entites/common.entity';

/**
 * Every action that can be granted through a role. Codes are prefixed with
 * the account level they belong to; labels and groups live in
 * constants/permissions.catalog.ts and are synced to the database on boot.
 */
export enum SetPermission {
  // Staff (SaveApp team, admin portal)
  StaffTeamView = 'staff.team.view',
  StaffTeamInvite = 'staff.team.invite',
  StaffTeamManage = 'staff.team.manage',
  StaffRolesAssign = 'staff.roles.assign',
  StaffRolesCreate = 'staff.roles.create',
  StaffRolesUpdate = 'staff.roles.update',
  StaffRolePermissions = 'staff.roles.permissions',
  StaffMerchantsView = 'staff.merchants.view',
  StaffMerchantsKycReview = 'staff.merchants.kyc',
  StaffMerchantsApprove = 'staff.merchants.approve',
  StaffCountriesManage = 'staff.settings.countries',
  StaffRequirementsManage = 'staff.settings.requirements',

  // Merchant (B2B and WhiteLabel businesses, merchant portal)
  MerchantTeamView = 'merchant.team.view',
  MerchantTeamInvite = 'merchant.team.invite',
  MerchantTeamManage = 'merchant.team.manage',
  MerchantRolesAssign = 'merchant.roles.assign',
  MerchantRolesCreate = 'merchant.roles.create',
  MerchantRolesUpdate = 'merchant.roles.update',
  MerchantRolePermissions = 'merchant.roles.permissions',
  MerchantProfileManage = 'merchant.business.profile',
  MerchantKycSubmit = 'merchant.business.kyc',
  MerchantCardsView = 'merchant.cards.view',
  MerchantCardsReveal = 'merchant.cards.reveal',
  MerchantCredentialsView = 'merchant.credentials.view',
  MerchantCredentialsManage = 'merchant.credentials.manage',
  MerchantWebhooksManage = 'merchant.webhooks.manage',
}

export enum AuthorizationLevel {
  B2C = 'B2C',
  B2B = 'B2B',
  WhiteLabel = 'WhiteLabel',
  Staff = 'Staff',
}

/** Levels served by the merchant portal. */
export const MERCHANT_LEVELS = [
  AuthorizationLevel.B2B,
  AuthorizationLevel.WhiteLabel,
];

/**
 * Permission levels a level's roles draw from. Merchant permissions are
 * stored once at B2B and shared by WhiteLabel businesses, which also get any
 * WhiteLabel-only permissions.
 */
export const permissionLevels = (
  level: AuthorizationLevel,
): AuthorizationLevel[] =>
  level === AuthorizationLevel.WhiteLabel
    ? [AuthorizationLevel.B2B, AuthorizationLevel.WhiteLabel]
    : [level];

@Entity()
export class Permission extends CommonEntity {
  @Column({ enum: SetPermission })
  @Index({ unique: true })
  name: SetPermission;

  // Human readable label, e.g. "Invite user"
  @Column({ type: 'text' })
  description: string;

  // Account level the permission belongs to
  @Column({
    enum: AuthorizationLevel,
    default: AuthorizationLevel.B2C,
  })
  type: AuthorizationLevel;

  // Heading it is listed under, e.g. "Team & access"
  @Column({ type: String, default: 'General' })
  group: string;

  // Sensitive, platform-internal action (shown with an "Internal" badge)
  @Column({ type: Boolean, default: false })
  internal: boolean;

  @Column({ type: Boolean, default: true })
  active: boolean;
}
