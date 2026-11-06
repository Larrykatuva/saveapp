import type { Request, Response } from 'express';
import {
  Portal,
  SectionKey,
  navigationFor,
  sectionNavFor,
} from '../constants/portals';

export interface Breadcrumb {
  label: string;
  href?: string;
}

export const PAGE_SIZE = 10;

/** Two-letter initials for avatars and tiles, e.g. "Jane Wanjiku" -> "JW". */
export const initials = (name: string) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

export const formatDate = (value?: string | Date | null) =>
  value
    ? new Date(value).toLocaleDateString('en-KE', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

/** A stored or external image url, or null for empty values. */
export const imageUrl = (value?: string | null) =>
  value && /^https?:\/\//.test(value) ? value : null;

/**
 * Common context for a page rendered inside the portal shell
 * (layouts/portal.hbs): navigation state, title and breadcrumbs.
 */
export function portalView(
  portal: Portal,
  req: Request,
  title: string,
  context: Record<string, unknown> = {},
  breadcrumbs: Breadcrumb[] = [],
  // Path used to highlight the navigation (defaults to the request path)
  navPath?: string,
) {
  return {
    layout: 'layouts/portal',
    portal,
    title,
    navigation: navigationFor(
      portal,
      navPath ?? req.path,
      (req['permissions'] as string[] | undefined) ?? [],
      req['approved'] !== false,
      context.navBadges as Record<string, number | undefined> | undefined,
    ),
    breadcrumbs: [
      { label: portal.name, href: portal.basePath },
      ...breadcrumbs,
      { label: title },
    ],
    ...context,
  };
}

/**
 * A page of the Team or Settings section: the portal shell plus the
 * section's menu card beside the content (partials/portal/section).
 */
export function sectionView(
  portal: Portal,
  req: Request,
  section: SectionKey,
  title: string,
  context: Record<string, unknown> = {},
  counts: Record<string, number | undefined> = {},
) {
  const label = {
    team: 'Team',
    integrations: 'Integrations',
    settings: 'Settings',
  }[section];
  return portalView(
    portal,
    req,
    title,
    {
      sectionLabel: label,
      sectionNav: sectionNavFor(
        portal,
        section,
        req.path,
        (req['permissions'] as string[] | undefined) ?? [],
        counts,
      ),
      ...context,
    },
    [{ label, href: `${portal.basePath}/${section}` }],
  );
}

/** Renders a partial without the layout (drawers, tables, list fragments). */
export const fragment = (
  res: Response,
  view: string,
  context: Record<string, unknown>,
  status = 200,
) =>
  res.status(status).render(`partials/${view}`, { layout: false, ...context });

/** Pagination links for a fragment table that reloads itself from `base`. */
export const pager = (
  result: { total: number; page: number; pages: number },
  base: string,
  params: Record<string, string | number | undefined>,
) => {
  const query = (page: number) =>
    `${base}?${new URLSearchParams(
      Object.entries({ ...params, page } as Record<string, unknown>)
        .filter(([, value]) => value !== undefined && value !== '')
        .map(([key, value]) => [key, String(value)]),
    ).toString()}`;
  return {
    total: result.total,
    page: result.page,
    pages: result.pages,
    from: result.total ? (result.page - 1) * PAGE_SIZE + 1 : 0,
    to: Math.min(result.page * PAGE_SIZE, result.total),
    hasPrev: result.page > 1,
    hasNext: result.page < result.pages,
    prevUrl: query(result.page - 1),
    nextUrl: query(result.page + 1),
  };
};

/** Clamps a page number and works out skip/take for PAGE_SIZE rows. */
export const pageWindow = (page: number) => {
  const safe = Math.max(1, Math.floor(page) || 1);
  return { page: safe, skip: (safe - 1) * PAGE_SIZE, take: PAGE_SIZE };
};

export const pageCount = (total: number) =>
  Math.max(1, Math.ceil(total / PAGE_SIZE));
