"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";

// The assistant itself, embedded in the console as a floating bubble — exactly how
// it appears on a real website. Because you are already signed in here, the console
// minted your identity server-side (no separate chat login), so it acts AS you: it
// can read your account, reach members-only knowledge, and hold risky actions for
// approval.
//
// Same origin, because this app now serves /embed itself. It used to iframe another
// deployment, which resolved publishable keys against a different database and so
// could never find an assistant created here.

export function ConsoleAssistant({ token, publishableKey }: { token: string | null; publishableKey: string }) {
  const [open, setOpen] = useState(false);
  // Mount the iframe once (on first open) and keep it mounted — just hide it when
  // closed — so the conversation survives close/reopen instead of reloading empty.
  const [mounted, setMounted] = useState(false);
  const src = `/embed?k=${encodeURIComponent(publishableKey)}${token ? `&uid=${encodeURIComponent(token)}` : ""}`;

  function toggle() {
    setOpen((o) => {
      if (!o) setMounted(true);
      return !o;
    });
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {mounted && (
        <div className={"bg-card w-[384px] max-w-[calc(100vw-40px)] overflow-hidden rounded-2xl border shadow-2xl" + (open ? "" : " hidden")}>
          <div className="text-muted-foreground flex items-center justify-between gap-2 border-b px-3 py-2 text-xs">
            <span className="text-teal-deep font-medium">✓ Acting as you — preview your assistant</span>
            <button onClick={() => setOpen(false)} aria-label="Close" className="hover:text-foreground">✕</button>
          </div>
          <iframe title="Your assistant" src={src} allow="microphone" className="block h-[560px] max-h-[calc(100vh-160px)] w-full border-0 bg-white" />
        </div>
      )}
      <button
        onClick={toggle}
        className="bg-gradient-primary text-primary-foreground shadow-primary inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold"
        aria-label="Chat with your assistant"
      >
        {open ? "Close" : <><MessageSquare className="size-4" /> Try your assistant</>}
      </button>
    </div>
  );
}
