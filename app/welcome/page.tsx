import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth/session";
import { WelcomeStart } from "./welcome-start";
import { Wordmark } from "@/components/app-shell/wordmark";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Set up your assistant · The Assistant" };
export const dynamic = "force-dynamic";

/**
 * First run. The app layout sends any signed-in user with no assistant here, and
 * anyone who already has one straight into it.
 */
export default async function WelcomePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.stores.length > 0) redirect("/");

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-3 text-center">
          <Wordmark className="justify-center text-2xl" />
        </CardHeader>
        <CardContent>
          <WelcomeStart email={ctx.user.email} />
        </CardContent>
      </Card>
    </div>
  );
}
