import { redirect } from "next/navigation";
import { getActiveStore, getStoreCapabilities } from "@/lib/store/active-store";
import { StoreProvider } from "@/components/store/store-provider";
import { Sidebar } from "@/components/app-shell/sidebar";
import { StoreSwitcher } from "@/components/app-shell/store-switcher";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { UserMenu } from "@/components/app-shell/user-menu";
import { ConsoleAssistant } from "@/components/app-shell/console-assistant";
import { getOwnAssistant } from "@/lib/preview/own-assistant";
import { mintTourToken } from "@/lib/tour/token";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getActiveStore();
  if (!ctx) redirect("/login");

  // Authenticated but linked to no store → first-run self-serve store creation.
  if (!ctx.active || ctx.stores.length === 0) {
    redirect("/welcome");
  }

  // No phone gate here. Upstream, every account had to capture a phone number,
  // because that number was what tied a person's WhatsApp identity to their console
  // identity. This product has no WhatsApp channel: people arrive by email, and
  // later by Microsoft sign-in. Demanding a phone would have bounced every new
  // owner to /account/phone immediately after creating their assistant, in service
  // of a link that does not exist here. The route itself stays on disk, unreachable.

  const capabilities = await getStoreCapabilities(ctx.active.id);

  // Preview bubble: the owner's OWN assistant, floating in the console exactly as it
  // appears on a website. Where the assistant has an SSO secret the chat runs AS the
  // signed-in owner — minted here, server-side, from the session we already have, so
  // there is no second login — which is what makes an identity-forwarding tool
  // testable without leaving the console.
  let preview: { key: string; token: string | null } | null = null;
  try {
    const own = await getOwnAssistant(ctx.active.id);
    if (own) {
      preview = {
        key: own.publishableKey,
        token: own.identitySecret && ctx.user.email
          ? mintTourToken(own.identitySecret, { email: ctx.user.email, sub: ctx.user.id, ttlSec: 3600 })
          : null,
      };
    }
  } catch {
    /* never break the console for the preview bubble */
  }

  return (
    <StoreProvider
      value={{
        stores: ctx.stores,
        active: ctx.active,
        isPlatformAdmin: ctx.isPlatformAdmin,
        capabilities,
      }}
    >
      <div className="bg-background fixed inset-0 flex overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-background/80 sticky top-0 z-10 flex h-14 items-center gap-3 border-b px-4 backdrop-blur">
            <StoreSwitcher />
            <div className="flex-1" />
            <ThemeToggle />
            <UserMenu email={ctx.user.email} />
          </header>
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
      {preview ? <ConsoleAssistant token={preview.token} publishableKey={preview.key} /> : null}
    </StoreProvider>
  );
}
