import { randomBytes, timingSafeEqual } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
import { isDeployed } from './environment';
import { TRUSTED_PROXIES } from './proxy';

// Own cookie name so a water-solution session on the same host never collides
export const SESSION_COOKIE = 'sa.sid';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
export const REMEMBER_ME_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * Signed-in pages (portal and onboarding layouts) warn after this much
 * inactivity and sign the user out when the countdown runs out
 * (public/js/main.js, views/partials/shared/idle_dialog.hbs).
 */
export const IDLE_SIGN_OUT = { minutes: 5, countdownSeconds: 60 };

export interface Flash {
  type: 'success' | 'error' | 'info';
  message: string;
}

declare module 'express-session' {
  interface SessionData {
    // Signed-in user and the account they are acting as
    userId?: number;
    accountId?: number;
    // User who registered or signed in but still has to verify their email
    pendingUserId?: number;
    // Email a password reset code was requested for
    resetEmail?: string;
    // Where to send the user after sign in
    returnTo?: string;
    oauthState?: string;
    csrfToken?: string;
    flash?: Flash;
    // Form input and errors carried across a redirect after a failed POST
    form?: { values: Record<string, unknown>; errors: Record<string, string> };
    // Signed in with a password, still waiting for the authenticator code
    twoFactor?: {
      userId: number;
      // Authenticator app code, or a code we emailed (accounts without an app)
      method: 'app' | 'email';
      remember: boolean;
      expires: number;
      // Invitation to come back to once the code is accepted
      inviteToken?: string;
    };
    // Authenticator recovery codes shown once after setup or regeneration
    recoveryCodes?: string[];
    // Card whose full details the user asked a one-time code for
    cardReveal?: { cardId: number; expires: number };
    // API key shown once after it is created or its secret rotated
    revealed?: {
      credentialId: number;
      clientId?: string;
      clientSecret: string;
    };
  }
}

/**
 * Session-based auth for the server-rendered portals (controllers/views).
 * Sessions live in Redis; the mobile API uses bearer tokens instead.
 *
 * Also installs:
 * - CSRF protection for every form POST outside /api (synchronizer token in
 *   the session, rendered as {{csrfToken}} and sent back as `_csrf`)
 * - One-shot flash messages and form state, exposed to templates
 */
export default async function configureSession(
  app: NestExpressApplication,
): Promise<void> {
  const deployed = isDeployed();
  const secret = process.env.SESSION_SECRET ?? process.env.PRIVATE_KEY;
  if (!secret) throw new Error('SESSION_SECRET (or PRIVATE_KEY) must be set');

  const redis = createClient({ url: process.env.REDIS_URL });
  redis.on('error', (error) => console.error('Session store error', error));
  await redis.connect();

  // Behind Cloudflare and nginx: the real client IP in req.ip and https in
  // req.protocol (see proxy.ts for why it's a list, not a hop count)
  if (deployed) app.set('trust proxy', TRUSTED_PROXIES);

  // Terraka documents its webhooks as `"application/json; charset=utf8` (a
  // stray quote, and "utf8" without the hyphen). body-parser answers 415 to
  // that charset and skips a quoted type, so tidy the header before parsing.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const type = req.headers['content-type'];
    if (type)
      req.headers['content-type'] = type
        .replace(/"/g, '')
        .replace(/charset=utf8\b/i, 'charset=utf-8');
    next();
  });

  // Nest normally adds body parsers at init, after these middlewares; register
  // them now so the CSRF check can read form fields.
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });

  app.use(
    session({
      name: SESSION_COOKIE,
      store: new RedisStore({ client: redis, prefix: 'sa:sess:' }),
      secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: deployed,
        maxAge: SESSION_TTL_MS,
      },
    }),
  );

  app.use(csrfProtection);
  app.use(exposeFlash);
}

function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith('/api') || req.path.startsWith('/static')) {
    return next();
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.idle = IDLE_SIGN_OUT;

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // Multipart forms (file uploads) are parsed after this middleware, so they
  // carry the token in the form action's query string instead of the body
  const field =
    (req.body as Record<string, unknown> | undefined)?._csrf ?? req.query._csrf;
  const sent =
    typeof field === 'string' ? field : (req.get('x-csrf-token') ?? '');
  const expected = req.session.csrfToken;
  const valid =
    sent.length === expected.length &&
    timingSafeEqual(Buffer.from(sent), Buffer.from(expected));

  if (!valid) {
    req.session.flash = {
      type: 'error',
      message: 'Your session expired. Please try again.',
    };
    return res.redirect(303, req.get('referer') ?? '/auth/login');
  }
  next();
}

function exposeFlash(req: Request, res: Response, next: NextFunction) {
  if (req.session.flash) {
    res.locals.flash = req.session.flash;
    delete req.session.flash;
  }
  if (req.session.form) {
    res.locals.form = req.session.form;
    delete req.session.form;
  }
  next();
}
