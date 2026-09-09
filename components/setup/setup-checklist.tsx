import Link from "next/link";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CheckCircle2, Circle } from "lucide-react";

type Step = { done: boolean; label: string; desc: string; href: string };

/**
 * "Get your assistant ready" — the other half of the setup conversation.
 *
 * The conversation agrees a plan; this turns it into work. Most of that work
 * cannot happen during a chat: connecting a system usually needs credentials or
 * an admin, and deploying to Teams needs someone with tenant rights. So the steps
 * below are DERIVED from what the owner said they wanted, and each one is checked
 * against real state rather than being ticked off by hand.
 *
 * Owner-only, and renders nothing once every step is done.
 */
export async function SetupChecklist() {
  const ctx = await getActiveStore();
  if (!ctx?.active) return null;
  const store = ctx.active;

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner) return null;

  const db = createAdminClient();
  const [cfg, know, tools, mcp, held, embedSeen, setupRow, slack, teams, responders] = await Promise.all([
    supabase.from("agent_config").select("key,value").eq("store_id", store.id).in("key", ["personality", "store_prompt"]),
    supabase.from("knowledge_index").select("id", { count: "exact", head: true }).eq("store_id", store.id),
    db.from("http_tool").select("id", { count: "exact", head: true }).eq("store_id", store.id),
    db.from("mcp_server").select("id", { count: "exact", head: true }).eq("store_id", store.id),
    db.from("http_tool").select("id", { count: "exact", head: true }).eq("store_id", store.id).eq("action_policy", "hold"),
    supabase.from("stores").select("last_embed_at").eq("id", store.id).maybeSingle(),
    db.from("assistant_setup").select("job, channel, systems, approvals").eq("store_id", store.id).maybeSingle(),
    db.from("slack_installs").select("team_id", { count: "exact", head: true }).eq("store_id", store.id),
    db.from("teams_installs").select("tenant_id", { count: "exact", head: true }).eq("store_id", store.id),
    db.from("store_responders").select("email", { count: "exact", head: true }).eq("store_slug", store.slug).eq("active", true),
  ]);

  const described = (cfg.data ?? []).some((r) => (r.value ?? "").trim().length > 20);
  const hasKnowledge = (know.count ?? 0) > 0;
  const toolCount = (tools.count ?? 0) + (mcp.count ?? 0);
  const plan = setupRow.data as
    | { job: string | null; channel: string | null; systems: { name?: string }[] | null; approvals: string[] | null }
    | null;

  const systems = (plan?.systems ?? []).map((s) => s?.name).filter(Boolean) as string[];
  const approvals = plan?.approvals ?? [];
  const channel = plan?.channel ?? "web";

  const hasResponder = (responders.count ?? 0) > 0;

  const steps: Step[] = [
    {
      done: described,
      label: "Tell it what it's for",
      desc: "Its brief: what it handles, who it serves, and how it should sound.",
      href: "/agent",
    },
    {
      done: hasKnowledge,
      label: "Give it something to answer from",
      desc: "Point it at the documents and policies your team asks about.",
      href: "/knowledge",
    },
  ];

  // The half of the loop that is easy to forget until it matters. An assistant that
  // cannot answer something opens a request — and with nobody named, that request
  // waits in the console for whoever happens to look. It says so honestly in the
  // chat rather than pretending, which is right but not a substitute for naming a
  // person.
  steps.push({
    done: hasResponder,
    label: "Say who picks up what it can't answer",
    desc: "It reaches them in Teams, Slack or by email \u2014 whichever they use. Until then, questions and approvals wait here for someone to notice.",
    href: "/inbox",
  });

  // Derived from the plan: the systems the owner said this job touches. Named, so
  // the step is a real errand ("connect Jira") rather than an abstract prompt.
  if (systems.length) {
    steps.push({
      done: toolCount > 0,
      label: `Connect ${listOf(systems)}`,
      desc: "You said the job needs these. Connecting one often needs whoever administers it, so this can wait.",
      href: "/connections",
    });
  } else {
    steps.push({
      done: toolCount > 0,
      label: "Connect a system",
      desc: "Answering is table stakes. It earns its place when it can act in the systems you already run.",
      href: "/connections",
    });
  }

  // Only ask about approvals if the owner actually named something that needs one.
  if (approvals.length) {
    steps.push({
      done: (held.count ?? 0) > 0,
      label: "Hold what needs a person",
      desc: `You said ${listOf(approvals)} should never happen on its own. Set those tools to Hold once they exist.`,
      href: "/connections",
    });
  }

  steps.push(
    channel === "slack"
      ? { done: (slack.count ?? 0) > 0, label: "Put it in Slack", desc: "Connect your workspace so your team can talk to it where they already work.", href: "/link" }
      : channel === "teams"
        ? { done: (teams.count ?? 0) > 0, label: "Put it in Microsoft Teams", desc: "Add it to your tenant so your team can talk to it where they already work.", href: "/link" }
        : { done: !!embedSeen.data?.last_embed_at, label: "Put it on a page", desc: "Copy the snippet onto an internal page. This ticks once it loads there.", href: "/link" },
  );

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <div className="mx-auto max-w-6xl px-6 pt-6">
      <div className="bg-card rounded-lg border p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg">Get {store.name} ready</h2>
          <span className="text-muted-foreground text-sm">{doneCount} of {steps.length} done</span>
        </div>
        <p className="text-muted-foreground mb-3 mt-0.5 text-sm">
          {plan?.job
            ? `You said you want it to handle ${plan.job.replace(/\.$/, "")}. Here's what's left, in any order.`
            : "A few steps and it's ready for your team. Do them in any order."}
        </p>
        <ul className="space-y-1">
          {steps.map((s) => (
            <li key={s.label}>
              <Link
                href={s.href}
                className="hover:bg-muted -mx-2 flex items-start gap-3 rounded-md px-2 py-2 transition-colors"
              >
                {s.done ? (
                  <CheckCircle2 className="text-teal-deep mt-0.5 size-4 shrink-0" />
                ) : (
                  <Circle className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                )}
                <span className="min-w-0">
                  <span className={`text-sm font-medium ${s.done ? "text-muted-foreground line-through" : ""}`}>
                    {s.label}
                  </span>
                  {!s.done && <span className="text-muted-foreground block text-xs">{s.desc}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** "Jira", "Jira and Okta", "Jira, Okta and Workday". */
function listOf(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
