import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { profileFor, homeHrefFor } from "@/lib/console-profile";
import { StoreSettings } from "@/components/settings/store-settings";

export const metadata: Metadata = { title: "Console type · Admin" };

export default async function SettingsPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  // Platform admins only, and no longer in the nav. The single control here sets
  // stores.business_type, which since profileFor was pinned to "saas" no longer
  // reshapes anything an owner can see — leaving it in their menu offered a
  // settings page that could not change a setting. A super-admin can still reach
  // it from Admin → Assistants to correct a mis-set type.
  if (!ctx.isPlatformAdmin) redirect(homeHrefFor(profileFor(store.businessType)));

  return (
    <StoreSettings
      key={store.slug}
      storeId={store.id}
      storeName={store.name}
      businessType={store.businessType}
      canChangeType={ctx.isPlatformAdmin}
    />
  );
}
