import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { profileFor, homeHrefFor } from "@/lib/console-profile";
import { getCompanyForStore, getCredits, getLedger, getSpendByAssistant } from "./actions";
import { BillingView } from "@/components/billing/billing-view";

export const metadata: Metadata = { title: "Credits · The Assistant" };

export default async function BillingPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner && !ctx.isPlatformAdmin) redirect(homeHrefFor(profileFor(store.businessType)));

  // Credits belong to the ACCOUNT, not this assistant — resolve it first. An
  // assistant that isn't attached to one yet renders an explanatory empty state
  // rather than a zero balance that would read as "you've run out".
  const company = await getCompanyForStore(store.id);
  if (!company) {
    return <BillingView company={null} credits={null} ledger={[]} spend={[]} />;
  }

  const [credits, ledger, spend] = await Promise.all([
    getCredits(company.id),
    getLedger(company.id),
    getSpendByAssistant(company.id),
  ]);

  return <BillingView company={company} credits={credits} ledger={ledger} spend={spend} />;
}
