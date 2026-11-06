import {
  AuthorizationLevel,
  MERCHANT_LEVELS,
  SetPermission,
} from '../entities/permission.entity';

/**
 * System roles seeded for each level. They are read-only in the portals and
 * always hold exactly their definition (synced on boot).
 */
export enum SystemRoles {
  SuperAdmin = 'Super Admin',
  Compliance = 'Compliance',
  Owner = 'Owner',
  Admin = 'Admin',
  Viewer = 'Viewer',
}

export interface RoleSet {
  name: SystemRoles;
  type: AuthorizationLevel;
  description: string;
  // Given to accounts of the level that have no role yet
  default: boolean;
  // Fixed permissions; omitted means every permission of the level
  permissions?: SetPermission[];
}

const P = SetPermission;

const staffSets: RoleSet[] = [
  {
    name: SystemRoles.SuperAdmin,
    type: AuthorizationLevel.Staff,
    description: 'Full access to the admin portal.',
    default: true,
  },
  {
    name: SystemRoles.Compliance,
    type: AuthorizationLevel.Staff,
    description:
      'Reviews merchant KYC, approves or rejects merchants and keeps onboarding requirements up to date.',
    default: false,
    permissions: [
      P.StaffMerchantsView,
      P.StaffMerchantsKycReview,
      P.StaffMerchantsApprove,
      P.StaffRequirementsManage,
    ],
  },
  {
    name: SystemRoles.Viewer,
    type: AuthorizationLevel.Staff,
    description:
      'Can look at merchants and the team without changing anything.',
    default: false,
    permissions: [P.StaffMerchantsView, P.StaffTeamView],
  },
];

// The same three roles for B2B and WhiteLabel businesses
const merchantSets: RoleSet[] = MERCHANT_LEVELS.flatMap((type) => [
  {
    name: SystemRoles.Owner,
    type,
    description: 'Full access to the business, including roles and the team.',
    default: false,
  },
  {
    name: SystemRoles.Admin,
    type,
    description:
      'Runs the business day to day: profile, KYC, the team, cards and webhooks, but not roles or API keys.',
    default: false,
    permissions: [
      P.MerchantTeamView,
      P.MerchantTeamInvite,
      P.MerchantTeamManage,
      P.MerchantRolesAssign,
      P.MerchantProfileManage,
      P.MerchantKycSubmit,
      P.MerchantCardsView,
      P.MerchantCredentialsView,
      P.MerchantWebhooksManage,
    ],
  },
  {
    name: SystemRoles.Viewer,
    type,
    description:
      'Can see the business, its team and its cards without changing anything.',
    default: true,
    permissions: [P.MerchantTeamView, P.MerchantCardsView],
  },
]);

export const RoleSets: RoleSet[] = [...staffSets, ...merchantSets];

/** The role an account of a level gets when it has none. */
export const defaultRoleSet = (level: AuthorizationLevel) =>
  RoleSets.find((set) => set.type === level && set.default);
