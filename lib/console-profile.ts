/**
 * Console profile.
 *
 * This product has exactly one shape: a SaaS/product team embedding an assistant
 * in their own app. `profileFor` is therefore PINNED to "saas" — it still takes a
 * business type and is still called from ~10 places, because the local-business
 * surfaces it used to select (Orders, Catalog, Redemptions, Campaigns, Diner,
 * rewards) remain in the tree and would otherwise render.
 *
 * Keeping the function rather than deleting its callers is deliberate: this fork
 * carries the whole upstream engine, and the local code paths still have to
 * compile. Pinning here makes every one of them unreachable from a single line,
 * which is far safer than excising features by hand from ~48,000 lines. When the
 * local surfaces are eventually deleted outright, this file goes with them.
 */

export type ConsoleProfile = "local" | "saas";

/** Always "saas" in this product. The parameter is retained so callers — and the
 *  upstream diff — stay unchanged. */
export function profileFor(_businessType?: string | null): ConsoleProfile {
  return "saas";
}

/** Every account opens on assistant health. */
export function homeHrefFor(_profile?: ConsoleProfile): string {
  return "/health";
}
