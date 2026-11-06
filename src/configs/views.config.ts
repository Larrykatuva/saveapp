import { readFileSync } from 'fs';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import hbs from 'hbs';
import { isDev } from './environment';

const ROOT_DIR = join(__dirname, '..', '..');
const VIEWS_DIR = join(ROOT_DIR, 'views');
const PUBLIC_DIR = join(ROOT_DIR, 'public');
const ICONS_DIR = join(ROOT_DIR, 'node_modules', 'lucide-static', 'icons');

const iconCache = new Map<string, string>();

/**
 * Returns a Lucide icon (https://lucide.dev/icons) as inline SVG, sized and
 * classed for the design system. Unknown names render nothing.
 */
function renderIcon(name: string, size = 20, className = ''): string {
  if (!iconCache.has(name)) {
    try {
      const svg = readFileSync(join(ICONS_DIR, `${name}.svg`), 'utf8')
        .replace(/<!--[\s\S]*?-->/, '')
        .trim();
      iconCache.set(name, svg);
    } catch {
      iconCache.set(name, '');
    }
  }
  const classes = ['icon', className].filter(Boolean).join(' ');
  return (iconCache.get(name) ?? '')
    .replace(/class="[^"]*"/, `class="${classes}" aria-hidden="true"`)
    .replace(/width="24"/, `width="${size}"`)
    .replace(/height="24"/, `height="${size}"`);
}

/**
 * Configures server-rendered Handlebars views and static file serving.
 * - Views: views/pages/**, rendered inside views/layouts/main.hbs by default;
 *   portal pages pass `layout: 'layouts/portal'`
 * - Partials: views/partials/**, usable as {{> folder/name}} (hyphens in file
 *   names become underscores)
 * - Static: public/ served under /static (e.g. /static/css/style.css)
 * - Helpers: {{icon "name" size=20 class="..."}}, {{eq a b}}, {{gt a b}}, {{and a b}}, {{not a}}, {{lower s}}, {{can "perm"}}, {{year}}
 */
export default function configureViews(app: NestExpressApplication): void {
  app.useStaticAssets(PUBLIC_DIR, { prefix: '/static/' });
  // Lucide icon files, for places that need an icon as a URL (select options)
  app.useStaticAssets(ICONS_DIR, { prefix: '/static/icons/', maxAge: '7d' });
  app.setBaseViewsDir(VIEWS_DIR);
  app.setViewEngine('hbs');
  app.set('view options', { layout: 'layouts/main' });

  const partialsDir = join(VIEWS_DIR, 'partials');
  hbs.registerPartials(partialsDir);
  // hbs reads partials once; on a developer's machine read them again before
  // each page so new or edited partials show without restarting the server
  if (isDev())
    app.use((req: { path: string }, _res: unknown, next: () => void) =>
      req.path.startsWith('/static') || req.path.startsWith('/api')
        ? next()
        : hbs.registerPartials(partialsDir, () => next()),
    );
  hbs.registerHelper('year', () => new Date().getFullYear());
  hbs.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  // {{{json value}}}: safe to embed in <script type="application/json">
  hbs.registerHelper(
    'json',
    (value: unknown) =>
      new hbs.handlebars.SafeString(
        JSON.stringify(value ?? null).replace(/</g, '\\u003c'),
      ),
  );
  hbs.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));
  // {{#if (and a b)}} / {{#if (not a)}}; the trailing argument is Handlebars' options
  hbs.registerHelper('and', (...args: unknown[]) =>
    args.slice(0, -1).every(Boolean),
  );
  hbs.registerHelper('not', (value: unknown) => !value);
  // {{#if (can "org.roles.create")}}: permission check against the account's
  // permissions exposed by PortalGuard
  hbs.registerHelper(
    'can',
    (
      permission: string,
      options: { data?: { root?: { permissions?: string[] } } },
    ) => Boolean(options.data?.root?.permissions?.includes(permission)),
  );
  hbs.registerHelper('lower', (value: unknown) =>
    typeof value === 'string' ? value.toLowerCase() : '',
  );
  hbs.registerHelper(
    'icon',
    (name: string, options: { hash: { size?: number; class?: string } }) =>
      new hbs.handlebars.SafeString(
        renderIcon(name, options.hash.size, options.hash.class),
      ),
  );
}
