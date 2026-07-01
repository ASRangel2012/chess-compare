/**
 * Resolve the CORS allow-list from a comma-separated env value.
 *
 * Kept dependency-free (no express/cors import) so the fail-closed policy can be
 * unit-tested directly. The returned shape is a structural subset of
 * `cors.CorsOptions`, so it drops straight into `createApp`.
 */
export interface ResolvedCorsOptions {
  origin: string[];
}

export function resolveCorsOptions(
  corsOriginEnv: string | undefined,
  isProduction: boolean
): ResolvedCorsOptions | undefined {
  const origins = corsOriginEnv
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const options = origins && origins.length > 0 ? { origin: origins } : undefined;

  // Fail closed: for a money-spending proxy, refusing to boot is safer than
  // silently emitting `Access-Control-Allow-Origin: *` to the whole internet.
  if (isProduction && !options) {
    throw new Error(
      "CORS_ORIGIN must be set in production (comma-separated list of allowed origins)."
    );
  }
  return options;
}
