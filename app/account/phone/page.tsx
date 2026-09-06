import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth/session";
import { PhoneCaptureForm } from "./phone-capture-form";
import { Wordmark } from "@/components/app-shell/wordmark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Add your phone · Ask Rani" };
export const dynamic = "force-dynamic";

/**
 * Account phone capture. The app layout routes any signed-in owner without a phone
 * here — both a brand-new account (right after store creation) and an existing one
 * (backfill). Lives outside the (app) layout group so the gate can't loop. Anyone
 * who already has a phone is sent straight into the console.
 */
export default async function AccountPhonePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.user.phone || ctx.user.phoneCaptured) redirect("/");

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <Wordmark className="justify-center text-2xl" />
          <div className="space-y-1">
            <CardTitle className="text-lg">Add your phone number</CardTitle>
            <CardDescription>
              So Rani recognizes you on WhatsApp — your questions and answers stay in one thread across WhatsApp and the console.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <PhoneCaptureForm />
        </CardContent>
      </Card>
    </div>
  );
}
