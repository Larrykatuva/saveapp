/**
 * Proxies whose X-Forwarded-For entries Express may skip to find the real
 * client IP (req.ip), on sandbox and production:
 *   client -> Cloudflare -> nginx (same host) -> app
 * nginx is loopback/private; Cloudflare's edges are listed below (from
 * https://www.cloudflare.com/ips, November 2026). Only these are trusted, so
 * a caller that reaches the server directly can't fake its IP with the
 * header: its own address is the first untrusted hop.
 *
 * Without this, req.ip was the Cloudflare edge (e.g. 162.158.x.x), so API
 * key IP whitelists and the Terraka webhook sender check saw the wrong IP.
 */
export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

export const TRUSTED_PROXIES = [
  'loopback',
  'linklocal',
  'uniquelocal',
  ...CLOUDFLARE_RANGES,
];
