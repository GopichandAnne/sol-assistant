import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { profileFor, homeHrefFor } from "@/lib/console-profile";
import { listTriggers } from "./actions";
import { ScheduledView } from "@/components/scheduled/scheduled-view";

export const metadata: Metadata = { title: "Scheduled work · The Assistant" };
export const dynamic = "force-dynamic";

export default async function ScheduledPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;
  const isOwner = ctx.isPlatformAdmin || store.role === "owner";
  if (!isOwner) redirect(homeHrefFor(profileFor(store.businessType)));

  return <ScheduledView key={store.slug} initial={await listTriggers()} storeName={store.name} />;
}
