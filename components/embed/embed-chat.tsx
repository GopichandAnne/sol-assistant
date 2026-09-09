"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";

/**
 * The chat a colleague actually talks to on the web.
 *
 * Deliberately thin: every decision that matters — which tools exist, whether an
 * action needs approval, what counts as knowledge, what a credit costs — belongs
 * to the edge function, which is the same core Teams and Slack call. A second
 * implementation of any of that here is a second thing to get wrong.
 *
 * Two details are load-bearing:
 *  • The session id is generated here and kept in localStorage, so closing the
 *    widget and coming back continues the same conversation rather than starting
 *    a stranger's.
 *  • Replies arrive already split into bubbles by the server (splitBubbles), so
 *    the rhythm is identical in every channel.
 */

type Msg = { role: "them" | "assistant"; text: string };

const FN = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/web-chat`;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function sessionFor(key: string): string {
  const storeKey = `assistant_session_${key.slice(-8)}`;
  try {
    const existing = localStorage.getItem(storeKey);
    if (existing) return existing;
    const fresh = `web_${crypto.randomUUID()}`;
    localStorage.setItem(storeKey, fresh);
    return fresh;
  } catch {
    // Private mode, or storage blocked. A per-load session still works; it just
    // does not survive a reload.
    return `web_${crypto.randomUUID()}`;
  }
}

export function EmbedChat({
  publishableKey,
  identityToken,
  slug,
  name,
  logoUrl,
  chips,
}: {
  publishableKey: string;
  identityToken: string | null;
  slug: string;
  name: string;
  logoUrl: string | null;
  chips: string[];
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const session = useRef<string>("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    session.current = sessionFor(publishableKey);
  }, [publishableKey]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    setFailed(false);
    setMessages((m) => [...m, { role: "them", text: t }]);
    setBusy(true);
    try {
      const res = await fetch(FN, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ANON}`, apikey: ANON },
        body: JSON.stringify({
          slug,
          token: publishableKey,
          session_id: session.current,
          message: t,
          ...(identityToken ? { identity_token: identityToken } : {}),
        }),
      });
      const data = (await res.json()) as { replies?: { text: string }[]; reply?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      const bubbles = data.replies?.length ? data.replies.map((b) => b.text) : data.reply ? [data.reply] : [];
      if (bubbles.length === 0) throw new Error("empty reply");
      setMessages((m) => [...m, ...bubbles.map((text) => ({ role: "assistant" as const, text }))]);
    } catch {
      // Say it plainly rather than leaving them looking at a spinner that stopped.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="bg-background flex h-dvh flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="size-6 rounded" />
        ) : (
          <span className="bg-teal-deep size-6 rounded" aria-hidden />
        )}
        <span className="truncate text-sm font-medium">{name}</span>
      </header>

      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-4">
        {empty && (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Ask me anything. If I can&apos;t answer it, I&apos;ll pass it to someone who can.
            </p>
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {chips.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => send(c)}
                    className="hover:border-teal-deep rounded-full border px-3 py-1.5 text-xs transition-colors"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "them" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "them"
                  ? "bg-teal-deep max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-sm text-white"
                  : "bg-muted max-w-[85%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap"
              }
            >
              {m.text}
            </div>
          </div>
        ))}

        {busy && (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" /> thinking
          </div>
        )}
        {failed && (
          <p className="text-destructive text-xs">
            That didn&apos;t go through. Try sending it again.
          </p>
        )}
      </div>

      <form
        className="flex items-center gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          // Enter sends. Relying on the form's implicit submit alone is one
          // browser quirk away from a chat box that swallows what you typed.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Type your question"
          className="focus-visible:ring-ring min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="bg-teal-deep grid size-9 shrink-0 place-items-center rounded-md text-white disabled:opacity-50"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
