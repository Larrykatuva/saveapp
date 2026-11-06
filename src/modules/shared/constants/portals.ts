import {
  AuthorizationLevel,
  MERCHANT_LEVELS,
  SetPermission,
} from '../../authorization/entities/permission.entity';

export type PortalKey = 'admin' | 'merchant';
export type SectionKey = 'team' | 'integrations' | 'settings';

export interface NavItem {
  label: string;
  icon: string; // Lucide icon name, https://lucide.dev/icons
  href: string;
  // Shown only to accounts holding at least one of these permissions
  permission?: SetPermission[];
  // Merchant pages that open once the business is approved
  approvedOnly?: boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export interface Portal {
  key: PortalKey;
  levels: AuthorizationLevel[];
  name: string;
  basePath: string;
  navigation: NavSection[];
  // Menus shown beside the pages of a section (Team, Integrations, Settings)
  sections: Record<SectionKey, NavItem[]>;
}

const P = SetPermission;

const STAFF_ROLES = [
  P.StaffRolesCreate,
  P.StaffRolesUpdate,
  P.StaffRolePermissions,
];
const STAFF_TEAM = [P.StaffTeamView, P.StaffTeamManage];
const MERCHANT_ROLES = [
  P.MerchantRolesCreate,
  P.MerchantRolesUpdate,
  P.MerchantRolePermissions,
];
const MERCHANT_TEAM = [P.MerchantTeamView, P.MerchantTeamManage];
const MERCHANT_CREDENTIALS = [
  P.MerchantCredentialsView,
  P.MerchantCredentialsManage,
];

/**
 * The two web portals. Both share the same shell (layouts/portal.hbs); the
 * Team and Settings pages list their sub-pages in a menu card beside the
 * content instead of nesting them in the sidebar.
 */
export const PORTALS: Record<PortalKey, Portal> = {
  admin: {
    key: 'admin',
    levels: [AuthorizationLevel.Staff],
    name: 'Admin',
    basePath: '/admin',
    navigation: [
      {
        title: 'Insights',
        items: [
          { label: 'Overview', icon: 'layout-grid', href: '/admin' },
          {
            label: 'Analytics',
            icon: 'chart-column',
            href: '/admin/analytics',
            permission: [P.StaffMerchantsView],
          },
        ],
      },
      {
        title: 'Management',
        items: [
          {
            label: 'Merchants',
            icon: 'store',
            href: '/admin/merchants',
            permission: [P.StaffMerchantsView],
          },
        ],
      },
      {
        title: 'Workspace',
        items: [
          {
            label: 'Team',
            icon: 'users',
            href: '/admin/team',
            permission: [...STAFF_TEAM, ...STAFF_ROLES],
          },
          { label: 'Settings', icon: 'settings', href: '/admin/settings' },
        ],
      },
    ],
    sections: {
      integrations: [],
      team: [
        {
          label: 'Members',
          icon: 'users',
          href: '/admin/team/members',
          permission: STAFF_TEAM,
        },
        {
          label: 'Invitations',
          icon: 'mail-plus',
          href: '/admin/team/invites',
          permission: STAFF_TEAM,
        },
        {
          label: 'Roles & permissions',
          icon: 'shield-user',
          href: '/admin/team/roles',
          permission: STAFF_ROLES,
        },
      ],
      settings: [
        {
          label: 'Countries',
          icon: 'globe',
          href: '/admin/settings/countries',
          permission: [P.StaffCountriesManage],
        },
        {
          label: 'Onboarding requirements',
          icon: 'list-checks',
          href: '/admin/settings/requirements',
          permission: [P.StaffRequirementsManage],
        },
        {
          label: 'My account',
          icon: 'circle-user-round',
          href: '/admin/settings/account',
        },
      ],
    },
  },
  merchant: {
    key: 'merchant',
    levels: MERCHANT_LEVELS,
    name: 'Merchant',
    basePath: '/merchant',
    navigation: [
      {
        title: 'Insights',
        items: [
          { label: 'Overview', icon: 'layout-grid', href: '/merchant' },
          {
            label: 'Analytics',
            icon: 'chart-column',
            href: '/merchant/analytics',
            permission: [P.MerchantCardsView],
            approvedOnly: true,
          },
        ],
      },
      {
        title: 'Card program',
        items: [
          {
            label: 'Cards',
            icon: 'credit-card',
            href: '/merchant/cards',
            permission: [P.MerchantCardsView],
            approvedOnly: true,
          },
          {
            label: 'Transactions',
            icon: 'arrow-left-right',
            href: '/merchant/transactions',
            permission: [P.MerchantCardsView],
            approvedOnly: true,
          },
        ],
      },
      {
        title: 'Workspace',
        items: [
          {
            label: 'Team',
            icon: 'users',
            href: '/merchant/team',
            permission: [...MERCHANT_TEAM, ...MERCHANT_ROLES],
            approvedOnly: true,
          },
          {
            label: 'Integrations',
            icon: 'plug',
            href: '/merchant/integrations',
            permission: [...MERCHANT_CREDENTIALS, P.MerchantWebhooksManage],
            approvedOnly: true,
          },
          { label: 'Settings', icon: 'settings', href: '/merchant/settings' },
        ],
      },
    ],
    sections: {
      integrations: [
        {
          label: 'Credentials',
          icon: 'key-round',
          href: '/merchant/integrations/credentials',
          permission: MERCHANT_CREDENTIALS,
        },
        {
          label: 'Webhooks',
          icon: 'webhook',
          href: '/merchant/integrations/webhooks',
          permission: [P.MerchantWebhooksManage],
        },
        {
          label: 'Event logs',
          icon: 'scroll-text',
          href: '/merchant/integrations/events',
          permission: [P.MerchantWebhooksManage],
        },
      ],
      team: [
        {
          label: 'Members',
          icon: 'users',
          href: '/merchant/team/members',
          permission: MERCHANT_TEAM,
        },
        {
          label: 'Invitations',
          icon: 'mail-plus',
          href: '/merchant/team/invites',
          permission: MERCHANT_TEAM,
        },
        {
          label: 'Roles & permissions',
          icon: 'shield-user',
          href: '/merchant/team/roles',
          permission: MERCHANT_ROLES,
        },
      ],
      settings: [
        {
          label: 'Business profile',
          icon: 'building-2',
          href: '/merchant/settings/business',
        },
        {
          label: 'Onboarding',
          icon: 'file-check',
          href: '/merchant/settings/onboarding',
          permission: [P.MerchantKycSubmit],
        },
        {
          label: 'My account',
          icon: 'circle-user-round',
          href: '/merchant/settings/account',
        },
        {
          label: 'Notifications',
          icon: 'bell',
          href: '/merchant/settings/notifications',
        },
      ],
    },
  },
};

/** The portal that serves an account level, e.g. B2B -> /merchant. */
export function portalForLevel(level: AuthorizationLevel): Portal {
  const portal = Object.values(PORTALS).find((item) =>
    item.levels.includes(level),
  );
  if (!portal) throw new Error(`No portal configured for level ${level}`);
  return portal;
}

/** True when an account holds at least one of the permissions (or none are needed). */
export const allowed = (permissions: string[], required?: SetPermission[]) =>
  !required?.length || required.some((item) => permissions.includes(item));

const matches = (portal: Portal, href: string, path: string) =>
  href === portal.basePath
    ? path === href
    : path === href || path.startsWith(`${href}/`);

/**
 * The portal's navigation for an account: items it may open, with the one
 * matching the path marked active. Approval-only items are hidden until the
 * business is approved.
 */
export function navigationFor(
  portal: Portal,
  path: string,
  permissions: string[],
  approved = true,
  badges: Record<string, number | undefined> = {},
) {
  return portal.navigation
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => allowed(permissions, item.permission))
        .filter((item) => approved || !item.approvedOnly)
        .map((item) => ({
          ...item,
          badge: badges[item.href],
          active: matches(portal, item.href, path),
        })),
    }))
    .filter((section) => section.items.length > 0);
}

/** A section's menu (Team or Settings) with the current page marked. */
export function sectionNavFor(
  portal: Portal,
  section: SectionKey,
  path: string,
  permissions: string[],
  counts: Record<string, number | undefined> = {},
) {
  return portal.sections[section]
    .filter((item) => allowed(permissions, item.permission))
    .map((item) => ({
      ...item,
      count: counts[item.href],
      active: matches(portal, item.href, path),
    }));
}

/** First page of a section the account may open, or null. */
export function firstSectionPage(
  portal: Portal,
  section: SectionKey,
  permissions: string[],
): string | null {
  return (
    portal.sections[section].find((item) =>
      allowed(permissions, item.permission),
    )?.href ?? null
  );
}
