/**
 * Parse the TRUST_PROXY env var into an Express `trust proxy` setting.
 *
 * Defaults to `false` so the app matches direct-exposure deployments (see
 * docker-compose.yml): trusting a proxy that isn't there lets any client spoof
 * X-Forwarded-For and mint a fresh rate-limit bucket per request. Set it to the
 * real hop count (e.g. `1` behind a single LB/CDN) or an express-recognized
 * string (`loopback`, a subnet) to match your topology.
 */
export function parseTrustProxy(
  value: string | undefined
): boolean | number | string {
  const v = value?.trim();
  if (!v || v.toLowerCase() === "false") return false;
  if (v.toLowerCase() === "true") return true;
  const n = Number(v);
  if (Number.isInteger(n) && n >= 0) return n;
  return v;
}
