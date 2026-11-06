import type { Request, Response } from 'express';
import {
  REMEMBER_ME_TTL_MS,
  SESSION_TTL_MS,
} from '../../../configs/session.config';
import { AuthorizationLevel } from '../../authorization/entities/permission.entity';
import { AccountService } from '../../onboarding/services/account.service';
import { portalForLevel } from '../../shared/constants/portals';
import { FieldErrors, FormError } from '../../shared/utils/form.util';
import { User } from '../entities/user.entity';

// Fields never echoed back into a form after a failed submit
const SECRET_FIELDS = [
  'password',
  'confirmPassword',
  'currentPassword',
  '_csrf',
  'code',
];

export const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(name.length - 2, 1))}@${domain}`;
};

/** Starts a fresh session for the user (prevents session fixation). */
export async function signIn(req: Request, user: User, remember: boolean) {
  const returnTo = req.session.returnTo;
  const flash = req.session.flash;
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((error?: Error) =>
      error ? reject(error) : resolve(),
    ),
  );
  req.session.userId = user.id;
  req.session.returnTo = returnTo;
  req.session.flash = flash;
  req.session.cookie.maxAge = remember ? REMEMBER_ME_TTL_MS : SESSION_TTL_MS;
}

/** The page the user was heading to, if it belongs to this portal. */
export function destination(req: Request, level: AuthorizationLevel) {
  const portal = portalForLevel(level);
  const returnTo = req.session.returnTo;
  delete req.session.returnTo;
  return returnTo &&
    (returnTo === portal.basePath || returnTo.startsWith(`${portal.basePath}/`))
    ? returnTo
    : portal.basePath;
}

/**
 * One active account goes straight to its portal; several get the picker;
 * none means the user still has to create their business.
 */
export async function routeAfterSignIn(
  req: Request,
  res: Response,
  accountService: AccountService,
) {
  const accounts = await accountService.portalAccounts(
    req.session.userId as number,
  );
  if (!accounts.length) return res.redirect(303, '/onboarding');
  const current = accounts.find((item) => item.id === req.session.accountId);
  const account = current ?? (accounts.length === 1 ? accounts[0] : undefined);
  if (!account) return res.redirect(303, '/auth/accounts');

  req.session.accountId = account.id;
  return res.redirect(303, destination(req, account.type));
}

/** Sends the user back to a form with their input and field errors. */
export function back(
  req: Request,
  res: Response,
  url: string,
  body: unknown,
  errors: FieldErrors,
  message?: string,
) {
  const values = Object.fromEntries(
    Object.entries((body ?? {}) as Record<string, unknown>).filter(
      ([key]) => !SECRET_FIELDS.includes(key),
    ),
  );
  req.session.form = { values, errors };
  if (message) req.session.flash = { type: 'error', message };
  return res.redirect(303, url);
}

/** Business-rule failures go back to the form; anything else is rethrown. */
export function fail(
  req: Request,
  res: Response,
  url: string,
  body: unknown,
  error: unknown,
) {
  if (error instanceof FormError)
    return back(req, res, url, body, error.errors, error.message);
  throw error;
}

export const TWO_FACTOR_MINUTES = 10;

/**
 * Password accepted: remember who is signing in and send them to the second
 * step (authenticator code, or an emailed code) instead of signing in.
 */
export function startTwoFactor(
  req: Request,
  res: Response,
  user: User,
  method: 'app' | 'email',
  remember: boolean,
  inviteToken?: string,
) {
  req.session.twoFactor = {
    userId: user.id,
    method,
    remember,
    inviteToken,
    expires: Date.now() + TWO_FACTOR_MINUTES * 60_000,
  };
  return res.redirect(303, '/auth/two-factor');
}

/** Values and errors carried over from a failed POST (see back()). */
export function formState(res: Response) {
  const form = res.locals.form as
    { values: Record<string, unknown>; errors: FieldErrors } | undefined;
  return { values: form?.values ?? {}, errors: form?.errors ?? {} };
}
