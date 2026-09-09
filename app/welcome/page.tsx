import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth/session";
import { WelcomeChat } from "./welcome-chat";
import { Wordmark } from "@/components/app-shell/wordmark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Set up your store · The Assistant" };
export const dynamic = "force-dynamic";

/**
 * First-run store creation. The app layout routes any signed-in user with no store
 * here (phone or email signup). Anyone who already has a store is sent into it.
 */
export default async function WelcomePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.stores.length > 0) redirect("/");

  const cookieStore = await cookies();
  const initialSite = cookieStore.get("ar_intent_site")?.value || undefined;
  // Every account here is a SaaS/product team, so the interview always skips the
  // "what kind of business are you?" question rather than asking a question with
  // one possible answer. (Upstream this came from a signup-door cookie.)
  const initialType = "saas";

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-3 text-center">
          <Wordmark className="justify-center text-2xl" />
          <div className="space-y-1">
            <CardTitle className="text-lg">Let&apos;s set up your the assistant</CardTitle>
            <CardDescription>Just chat with me about your business — type or tap the mic. No forms.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <WelcomeChat email={ctx.user.email} initialSite={initialSite} initialType={initialType} />
        </CardContent>
      </Card>
    </div>
  );
}
