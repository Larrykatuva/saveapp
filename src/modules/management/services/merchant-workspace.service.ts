import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Business } from '../../onboarding/entities/business.entity';
import { businessStatusMeta } from '../../onboarding/services/account.service';
import { PORTALS } from '../../shared/constants/portals';
import {
  imageUrl,
  initials,
  portalView,
} from '../../shared/utils/portal-view.util';
import { MerchantAdminService } from './merchant-admin.service';

export const MERCHANTS_BASE = '/admin/merchants';

export type WorkspaceTab =
  | 'overview'
  | 'analytics'
  | 'cards'
  | 'transactions'
  | 'team'
  | 'integrations'
  | 'kyc';

/** The merchant portal's own sections, as the SaveApp team sees them. */
const NAV: {
  title: string;
  items: { tab: WorkspaceTab; label: string; icon: string; path: string }[];
}[] = [
  {
    title: 'Insights',
    items: [
      { tab: 'overview', label: 'Overview', icon: 'layout-grid', path: '' },
      {
        tab: 'analytics',
        label: 'Analytics',
        icon: 'chart-column',
        path: '/analytics',
      },
    ],
  },
  {
    title: 'Card program',
    items: [
      { tab: 'cards', label: 'Cards', icon: 'credit-card', path: '/cards' },
      {
        tab: 'transactions',
        label: 'Transactions',
        icon: 'arrow-left-right',
        path: '/transactions',
      },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { tab: 'team', label: 'Team', icon: 'users', path: '/team' },
      {
        tab: 'integrations',
        label: 'Integrations',
        icon: 'plug',
        path: '/integrations',
      },
      { tab: 'kyc', label: 'KYC documents', icon: 'file-check', path: '/kyc' },
    ],
  },
];

/**
 * The admin's view of one merchant: the record card and a menu that mirrors
 * the merchant portal (Insights, Card program, Workspace) beside the page.
 * Used by every module that adds a section to it.
 */
@Injectable()
export class MerchantWorkspaceService {
  constructor(private readonly merchantAdmin: MerchantAdminService) {}

  base(business: Pick<Business, 'id'>) {
    return `${MERCHANTS_BASE}/${business.id}`;
  }

  /** The merchant, or a 404 page (answers null) when there is none. */
  async load(res: Response, id: number): Promise<Business | null> {
    const business = await this.merchantAdmin.find(id);
    if (!business) {
      res.status(404).render('pages/errors/forbidden', {
        layout: 'layouts/main',
        title: 'Not found',
        notFound: true,
        homePath: MERCHANTS_BASE,
      });
      return null;
    }
    return business;
  }

  /** Record card shown above the menu (and in the merchants list). */
  card(business: Business) {
    return {
      id: business.id,
      name: business.name,
      email: business.email,
      status: business.status,
      ...businessStatusMeta(business.status),
      logo: imageUrl(business.logo),
      initials: initials(business.name),
      country: business.country?.name,
      flag: business.country?.logo,
    };
  }

  /** Renders pages/merchants/<view> inside the workspace. */
  render(
    req: Request,
    res: Response,
    business: Business,
    tab: WorkspaceTab,
    title: string,
    context: Record<string, unknown>,
    view: string = tab,
  ) {
    const base = this.base(business);
    return res.render(
      `pages/merchants/${view}`,
      portalView(
        PORTALS.admin,
        req,
        title,
        {
          merchant: this.card(business),
          base,
          // Section urls, e.g. links.cards (templates have no string helpers)
          links: Object.fromEntries(
            NAV.flatMap((group) => group.items).map((item) => [
              item.tab,
              `${base}${item.path}`,
            ]),
          ),
          workspaceNav: NAV.map((group) => ({
            title: group.title,
            items: group.items.map((item) => ({
              label: item.label,
              icon: item.icon,
              href: `${base}${item.path}`,
              active: item.tab === tab,
            })),
          })),
          ...context,
        },
        [
          { label: 'Merchants', href: MERCHANTS_BASE },
          { label: business.name, href: base },
        ],
        MERCHANTS_BASE,
      ),
    );
  }
}
