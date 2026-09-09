"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { getAssertionKey, rotateAssertionKey } from "@/app/(app)/link/routing-actions";
import { Button } from "@/components/ui/button";

/**
 * The key a downstream API uses to check that an identity claim really came from
 * this assistant.
 *
 * Hidden until asked for. It is not needed to run an assistant, only to build a
 * tool that acts as the signed-in person, and showing a secret to everyone who
 * opens this page is how secrets end up in screenshots.
 */
export function AssertionKey({ storeId }: { storeId: string }) {
  const [key, setKey] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reveal() {
    start(async () => {
      const res = await getAssertionKey(storeId);
      if ("key" in res) setKey(res.key);
      else toast.error("Couldn't fetch the key", { description: res.error });
    });
  }

  function rotate() {
    start(async () => {
      const res = await rotateAssertionKey(storeId);
      if ("key" in res) {
        setKey(res.key);
        toast.success("New key generated", { description: "Update it anywhere you verify assertions." });
      } else toast.error("Couldn't rotate", { description: res.error });
    });
  }

  function copy(value: string) {
    navigator.clipboard.writeText(value).then(
      () => toast.success("Copied"),
      () => toast.error("Couldn't copy"),
    );
  }

  return (
    <details className="rounded-md border p-3 [&_summary]:cursor-pointer">
      <summary className="flex items-center gap-2 text-xs font-medium">
        <KeyRound className="size-3.5" /> Verifying who is asking
      </summary>
      <div className="mt-3 space-y-2">
        <p className="text-muted-foreground text-xs">
          When a tool is set to act as the signed-in person, we send your API a
          short-lived signed statement of who they are, which channel confirmed it,
          and which assistant is calling. Your API checks the signature with this key,
          so it can trust the person rather than trusting whoever called it. Each
          statement is valid for sixty seconds.
        </p>

        {key ? (
          <>
            <div className="flex gap-2">
              <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1.5 font-mono text-xs">{key}</code>
              <Button size="sm" variant="outline" onClick={() => copy(key)}>
                <Copy className="size-3.5" /> Copy
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Verify it as a standard HS256 JWT. In Node:
            </p>
            <pre className="bg-muted overflow-x-auto rounded p-2 text-[11px] leading-relaxed">
{`const { email, channel, assistant } =
  jwt.verify(bearerToken, process.env.ASSISTANT_KEY);
// email    who is asking
// channel  "teams" | "slack" | "web", how it was confirmed
// assistant which assistant called you`}
            </pre>
            <Button size="sm" variant="ghost" onClick={rotate} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Generate a new key
            </Button>
            <p className="text-muted-foreground text-xs">
              Rotating breaks anything still verifying with the old key, so change it
              on your side first.
            </p>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={reveal} disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Show the key
          </Button>
        )}
      </div>
    </details>
  );
}
