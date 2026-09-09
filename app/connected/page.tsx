import type { Metadata } from "next";

/**
 * Where someone lands after connecting their OWN account from a chat.
 *
 * They followed a link the assistant gave them in Teams, Slack or a web chat.
 * They are not an administrator, they may have no console account at all, and
 * they are one step into a task they were already doing — so this page says the
 * one thing they need and gets out of the way. Sending them to the admin console
 * would be sending most people to a page they cannot open.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connected",
  robots: { index: false, follow: false },
};

export default async function ConnectedPage({
  searchParams,
}: {
  searchParams: Promise<{ personal?: string; label?: string; error?: string }>;
}) {
  const { personal, label, error } = await searchParams;

  const provider =
    personal === "microsoft" ? "Microsoft 365"
    : personal === "google" ? "Google Workspace"
    : personal ? personal.replace(/\b\w/g, (c) => c.toUpperCase())
    : "your account";

  const ok = !!personal && !error;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div
          aria-hidden
          className="mx-auto grid size-12 place-items-center rounded-full"
          style={{ background: ok ? "var(--sol-teal-pale, #e0faf8)" : "var(--sol-orange-pale, #ffe1d1)" }}
        >
          <span className="text-xl">{ok ? "✓" : "!"}</span>
        </div>

        {ok ? (
          <>
            <h1 className="font-display text-xl font-bold">{provider} is connected</h1>
            <p className="text-muted-foreground text-sm">
              {label ? (
                <>
                  Connected as <span className="text-foreground font-medium">{label}</span>. The assistant
                  can now see your own calendar, mail and tasks — yours only, and only when you ask.
                </>
              ) : (
                <>
                  The assistant can now see your own calendar, mail and tasks — yours only, and only
                  when you ask.
                </>
              )}
            </p>
            <p className="text-muted-foreground text-sm">
              Go back to your chat and ask again.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl font-bold">That didn&apos;t connect</h1>
            <p className="text-muted-foreground text-sm">
              Nothing was linked. Ask the assistant for a fresh link — they expire after fifteen
              minutes.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
