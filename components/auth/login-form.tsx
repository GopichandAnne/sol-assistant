"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail } from "lucide-react";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">(
    searchParams.get("mode") === "signup" ? "signup" : "signin",
  );
  // New owners land in the setup interview; returning staff go where they asked.
  const next = mode === "signup" ? "/welcome" : (searchParams.get("next") ?? "/");
  const isSignup = mode === "signup";
  const [email, setEmail] = useState("");
  const [magicLoading, setMagicLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const callbackUrl = (path: string) =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(path)}`;

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setPwLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setPwLoading(false);
    if (error) {
      toast.error("Sign-in failed", { description: error.message });
      return;
    }
    // Full navigation so the server re-reads the freshly-set auth cookies.
    window.location.assign(next.startsWith("/") ? next : "/");
  }

  async function signInWithMagicLink() {
    if (!email.trim()) return;
    setMagicLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl(next) },
    });
    setMagicLoading(false);
    if (error) {
      toast.error("Couldn't send the link", { description: error.message });
      return;
    }
    setSent(true);
    toast.success("Check your email", {
      description: `We sent a sign-in link to ${email.trim()}.`,
    });
  }

  if (sent) {
    return (
      <div className="space-y-3 text-center">
        <div className="bg-secondary text-secondary-foreground mx-auto flex size-12 items-center justify-center rounded-full">
          <Mail className="size-5" />
        </div>
        <p className="font-medium">Check your email</p>
        <p className="text-muted-foreground text-sm">
          We sent a one-time sign-in link to{" "}
          <span className="text-foreground font-medium">{email.trim()}</span>.
          Open it on this device to continue.
        </p>
        <Button variant="ghost" className="w-full" onClick={() => setSent(false)}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-semibold">
          {isSignup ? "Create your assistant" : "Sign in"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {isSignup
            ? "Set up your AI assistant in a couple of minutes — just chat, no forms."
            : "For the people who run your assistant."}
        </p>
      </div>

      {isSignup ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={signInWithMagicLink}
            disabled={magicLoading}
          >
            {magicLoading && <Loader2 className="size-4 animate-spin" />}
            Email me a sign-up link
          </Button>
        </div>
      ) : (
        <form onSubmit={signInWithPassword} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={pwLoading || magicLoading}>
            {pwLoading && <Loader2 className="size-4 animate-spin" />}
            Sign in
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={signInWithMagicLink}
            disabled={magicLoading || pwLoading}
          >
            {magicLoading && <Loader2 className="size-4 animate-spin" />}
            Email me a magic link instead
          </Button>
        </form>
      )}

      <p className="text-muted-foreground text-center text-sm">
        {isSignup ? "Already have an account? " : "New here? "}
        <button
          type="button"
          onClick={() => setMode(isSignup ? "signin" : "signup")}
          className="text-foreground font-medium hover:underline"
        >
          {isSignup ? "Sign in" : "Create your assistant"}
        </button>
      </p>
    </div>
  );
}
