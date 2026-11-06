import {
  AuthorizationLevel,
  SetPermission,
} from '../entities/permission.entity';

export interface PermissionDefinition {
  name: SetPermission;
  label: string;
  level: AuthorizationLevel;
  group: string;
  internal?: boolean;
}

const { B2B, Staff } = AuthorizationLevel;
const P = SetPermission;

/**
 * Source of truth for permissions. Synced into the `permission` table on
 * startup (labels, groups and levels are updated in place), so adding a
 * permission is a code change plus a restart. Merchant permissions are kept
 * at B2B and shared by WhiteLabel businesses (see permissionLevels).
 */
export const PERMISSION_CATALOG: PermissionDefinition[] = [
  // ---- Staff
  {
    name: P.StaffTeamView,
    label: 'View team members',
    level: Staff,
    group: 'Team & access',
  },
  {
    name: P.StaffTeamInvite,
    label: 'Invite team members',
    level: Staff,
    group: 'Team & access',
  },
  {
    name: P.StaffTeamManage,
    label: 'Manage team members and invites',
    level: Staff,
    group: 'Team & access',
  },
  {
    name: P.StaffRolesAssign,
    label: 'Assign and revoke roles',
    level: Staff,
    group: 'Team & access',
  },
  {
    name: P.StaffRolesCreate,
    label: 'Create roles',
    level: Staff,
    group: 'Roles & policy',
  },
  {
    name: P.StaffRolesUpdate,
    label: 'Update roles',
    level: Staff,
    group: 'Roles & policy',
  },
  {
    name: P.StaffRolePermissions,
    label: 'Manage role permissions',
    level: Staff,
    group: 'Roles & policy',
  },
  {
    name: P.StaffMerchantsView,
    label: 'View merchants',
    level: Staff,
    group: 'Merchants',
  },
  {
    name: P.StaffMerchantsKycReview,
    label: 'Review merchant KYC documents',
    level: Staff,
    group: 'Merchants',
  },
  {
    name: P.StaffMerchantsApprove,
    label: 'Approve, reject and suspend merchants',
    level: Staff,
    group: 'Merchants',
    internal: true,
  },
  {
    name: P.StaffCountriesManage,
    label: 'Manage countries',
    level: Staff,
    group: 'Settings',
  },
  {
    name: P.StaffRequirementsManage,
    label: 'Manage onboarding requirements',
    level: Staff,
    group: 'Settings',
  },

  // ---- Merchant (B2B and WhiteLabel)
  {
    name: P.MerchantTeamView,
    label: 'View team members',
    level: B2B,
    group: 'Team & access',
  },
  {
    name: P.MerchantTeamInvite,
    label: 'Invite team members',
    level: B2B,
    group: 'Team & access',
  },
  {
    name: P.MerchantTeamManage,
    label: 'Manage team members and invites',
    level: B2B,
    group: 'Team & access',
  },
  {
    name: P.MerchantRolesAssign,
    label: 'Assign and revoke roles',
    level: B2B,
    group: 'Team & access',
  },
  {
    name: P.MerchantRolesCreate,
    label: 'Create roles',
    level: B2B,
    group: 'Roles & policy',
  },
  {
    name: P.MerchantRolesUpdate,
    label: 'Update roles',
    level: B2B,
    group: 'Roles & policy',
  },
  {
    name: P.MerchantRolePermissions,
    label: 'Manage role permissions',
    level: B2B,
    group: 'Roles & policy',
  },
  {
    name: P.MerchantProfileManage,
    label: 'Edit the business profile',
    level: B2B,
    group: 'Business',
  },
  {
    name: P.MerchantKycSubmit,
    label: 'Upload and submit KYC documents',
    level: B2B,
    group: 'Business',
  },
  {
    name: P.MerchantCardsView,
    label: 'View cards and their details',
    level: B2B,
    group: 'Cards',
  },
  {
    name: P.MerchantCardsReveal,
    label: 'See full card numbers, expiry and CVV (with a one-time code)',
    level: B2B,
    group: 'Cards',
  },
  {
    name: P.MerchantCredentialsView,
    label: 'View API credentials',
    level: B2B,
    group: 'Integrations',
  },
  {
    name: P.MerchantCredentialsManage,
    label: 'Create and manage API credentials',
    level: B2B,
    group: 'Integrations',
    internal: true,
  },
  {
    name: P.MerchantWebhooksManage,
    label: 'Manage webhooks',
    level: B2B,
    group: 'Integrations',
  },
];

/** Display order of groups. */
export const PERMISSION_GROUPS = [
  'Team & access',
  'Roles & policy',
  'Merchants',
  'Business',
  'Cards',
  'Integrations',
  'Settings',
];

export interface RolePermissionSet {
  create: SetPermission;
  update: SetPermission;
  permissions: SetPermission;
}

export interface TeamPermissionSet {
  view: SetPermission[];
  invite: SetPermission;
  assign: SetPermission;
  manage: SetPermission;
}

/** The three role-management permissions of each portal. */
export const ROLE_PERMISSIONS: Record<'admin' | 'merchant', RolePermissionSet> =
  {
    admin: {
      create: P.StaffRolesCreate,
      update: P.StaffRolesUpdate,
      permissions: P.StaffRolePermissions,
    },
    merchant: {
      create: P.MerchantRolesCreate,
      update: P.MerchantRolesUpdate,
      permissions: P.MerchantRolePermissions,
    },
  };

/**
 * Team permissions of each portal: who can see the team, invite people,
 * assign or revoke roles, and manage accounts and invites.
 */
export const TEAM_PERMISSIONS: Record<'admin' | 'merchant', TeamPermissionSet> =
  {
    admin: {
      view: [P.StaffTeamView, P.StaffTeamManage],
      invite: P.StaffTeamInvite,
      assign: P.StaffRolesAssign,
      manage: P.StaffTeamManage,
    },
    merchant: {
      view: [P.MerchantTeamView, P.MerchantTeamManage],
      invite: P.MerchantTeamInvite,
      assign: P.MerchantRolesAssign,
      manage: P.MerchantTeamManage,
    },
  };
