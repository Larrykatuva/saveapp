/**
 * Where the app runs, from ENV in .env:
 * - DEV: a developer's machine. Codes are printed in the log and partials
 *   are re-read on every page.
 * - SANDBOX: the deployed test server behind HTTPS (Cloudflare). Hosted like
 *   production (secure cookies, trusts the proxy, partials read once), but
 *   the merchant API rules stay relaxed for testing (IP whitelist optional,
 *   any http(s) webhook URL). STAGING is accepted as another name for it.
 * - PROD: production. Everything strict.
 * Anything else (or nothing) counts as DEV.
 */
export enum AppEnv {
  Dev = 'DEV',
  Sandbox = 'SANDBOX',
  Prod = 'PROD',
}

export function appEnv(value = process.env.ENV): AppEnv {
  const env = (value ?? '').trim().toUpperCase();
  if (env === 'PROD' || env === 'PRODUCTION') return AppEnv.Prod;
  if (env === 'SANDBOX' || env === 'STAGING') return AppEnv.Sandbox;
  return AppEnv.Dev;
}

/** Production only: strict merchant API rules. */
export const isProduction = (value?: string) => appEnv(value) === AppEnv.Prod;

/** A developer's machine: debug conveniences (codes in the log). */
export const isDev = (value?: string) => appEnv(value) === AppEnv.Dev;

/** Sandbox or production: served over HTTPS behind a proxy. */
export const isDeployed = (value?: string) => appEnv(value) !== AppEnv.Dev;
