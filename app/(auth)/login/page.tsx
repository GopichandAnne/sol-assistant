import { Suspense } from "react";
import type { Metadata } from "next";
import { Wordmark } from "@/components/app-shell/wordmark";
import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Sign in · The Assistant" };
export const dynamic = "force-dynamic";

/**
 * Whether to offer Microsoft sign-in, decided HERE rather than in the client
 * component, and deliberately not via a NEXT_PUBLIC_ variable.
 *
 * NEXT_PUBLIC_ values are compiled into the bundle at build time, and Vercel
 * Secrets are only decrypted at runtime, so a NEXT_PUBLIC_ flag stored as a
 * Secret reads as undefined during the build and the feature silently stays off
 * with a green deployment. That combination already cost this project one
 * debugging cycle on the Supabase keys. Reading a plain server-side variable
 * here works whether it is stored as Config or Secret, and toggling it needs no
 * rebuild at all.
 *
 * The NEXT_PUBLIC_ name is still honoured so an existing setup keeps working.
 */
function microsoftEnabled(): boolean {
  const v = process.env.MICROSOFT_SSO ?? process.env.NEXT_PUBLIC_MICROSOFT_SSO ?? "";
  return v.trim().toLowerCase() === "true";
}

export default function LoginPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <Wordmark className="justify-center text-2xl" />
      </CardHeader>
      <CardContent>
        {/* The form renders its own heading — it flips between "Sign in" and
            "Create your assistant" without a navigation. */}
        <Suspense fallback={null}>
          <LoginForm microsoftEnabled={microsoftEnabled()} />
        </Suspense>
      </CardContent>
    </Card>
  );
}
