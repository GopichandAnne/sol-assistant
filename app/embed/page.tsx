import type { Metadata } from "next";
import { createAnonClient } from "@/lib/supabase/anon";
import { EmbedChat } from "@/components/embed/embed-chat";

/**
 * The web channel.
 *
 * Teams and Slack both need an app registered in someone's tenant before a single
 * person can ask a question. The web is the one channel with no gate: an assistant
 * is reachable the moment it exists, which makes it where an org tries the thing
 * before committing, and where anyone outside Teams and Slack reaches it at all.
 *
 * One value identifies the assistant — its publishable key. That key is public by
 * design: it rides in the host page's HTML exactly like any widget key, grants
 * nothing but the ability to start a conversation, and is validated server-side on
 * every turn regardless.
 *
 * `uid` optionally carries a signed identity token from the host site, which is
 * what lets a tool act as the signed-in person rather than as the account. It is
 * verified in the edge function against the org's own key — never trusted here.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Assistant",
  // A widget in someone else's page has no business in search results.
  robots: { index: false, follow: false },
};

type PublicStore = {
  slug: string;
  display_name: string;
  paused?: boolean;
  logo_url?: string | null;
  chips?: string | null;
};

export default async function EmbedPage({
  searchParams,
}: {
  searchParams: Promise<{ k?: string; uid?: string }>;
}) {
  const { k = "", uid = "" } = await searchParams;
  const key = k.trim();

  if (!key) return <Unavailable line="This chat needs a key to know which assistant to open." />;

  const db = createAnonClient();
  const { data, error } = await db.rpc("resolve_store_by_key", { p_token: key });
  const store = (data ?? null) as PublicStore | null;

  if (error || !store) {
    return <Unavailable line="That key doesn't match an assistant. Whoever installed this can check it in the console." />;
  }
  if (store.paused) {
    return <Unavailable line={`${store.display_name} has paused this assistant.`} />;
  }

  const chips = (store.chips ?? "")
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 4);

  return (
    <EmbedChat
      publishableKey={key}
      identityToken={uid || null}
      slug={store.slug}
      name={store.display_name}
      logoUrl={store.logo_url ?? null}
      chips={chips}
    />
  );
}

/** Every failure here is someone else's page showing a broken widget, so it says
 *  what is wrong in one line and never renders a dead input box. */
function Unavailable({ line }: { line: string }) {
  return (
    <div className="flex h-dvh items-center justify-center p-6">
      <p className="text-muted-foreground max-w-xs text-center text-sm">{line}</p>
    </div>
  );
}
