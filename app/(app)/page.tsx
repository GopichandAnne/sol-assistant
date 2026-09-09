import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import HealthPage from "./health/page";

/**
 * Home → the assistant's health.
 *
 * We render that surface INLINE rather than redirect()-ing to /health or /orders.
 * A page-level redirect on the initial post-login load turned into a client-side
 * navigation during hydration, which tripped React error #310 inside Next's own
 * App Router (`useMemo` over the URL) — the "Application error" flash that showed
 * only on login. Rendering here keeps the URL at "/" and avoids that transition
 * entirely; /health still exists as its own route for the nav link.
 */
export default async function AppHome() {
  const ctx = await getActiveStore();
  if (!ctx?.active) redirect("/login");
  return <HealthPage />;
}
