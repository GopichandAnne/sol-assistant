"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getTeamsStatus, linkPendingTenant, setTeamsApprover, setTeamsTenant, type TeamsStatus } from "@/app/(app)/link/teams-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Copy, Download, Loader2, Users } from "lucide-react";
import { ChannelRouting } from "@/components/store-link/channel-routing";

export function TeamsConnect({ storeId }: { storeId: string }) {
  const [status, setStatus] = useState<TeamsStatus | null>(null);
  const [tenant, setTenant] = useState("");
  const [saving, setSaving] = useState(false);
  const [approver, setApprover] = useState("");
  const [savingApprover, setSavingApprover] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  /** Why the status couldn't be read, when that is the actual problem. Kept apart
   *  from `configured`: "we haven't set this up" and "your request failed" are
   *  different facts, and showing the first when the second happened sends
   *  whoever is setting it up to check settings that were never wrong. */
  const [problem, setProblem] = useState<string | null>(null);

  /** The whole ask, in one paste: what to install, what to approve, and why. An
   *  administrator who receives a bare URL asks what it is; one who receives this
   *  can act on it without a call. */
  function copyPack(consent: string) {
    const note = [
      "Setting up our assistant in Microsoft Teams. Two things, both one-off:",
      "",
      "1. Install the app package we sent, in Teams admin centre:",
      "   Teams apps → Manage apps → Upload new app, then allow it in your app permission policy.",
      "",
      "2. Approve it for the organisation, once:",
      `   ${consent}`,
      "",
      "The second link opens Microsoft's own consent screen. It lets the assistant",
      "identify who is talking to it, so it can reach the right person when something",
      "needs a human. No account with us is needed, and nothing is shared until then.",
    ].join("\n");
    navigator.clipboard.writeText(note).then(
      () => toast.success("Setup note copied", { description: "Paste it to whoever administers their Microsoft 365." }),
      () => toast.error("Couldn't copy"),
    );
  }

  function copyConsent(url: string) {
    navigator.clipboard.writeText(url).then(
      () => toast.success("Consent link copied", { description: "Send it to whoever administers Microsoft 365 there." }),
      () => toast.error("Couldn't copy"),
    );
  }

  useEffect(() => {
    getTeamsStatus(storeId)
      .then((s) => { setStatus(s); setTenant(s.tenantId ?? ""); setApprover(s.approvalsEmail ?? ""); })
      .catch((e: unknown) => {
        setProblem(e instanceof Error ? e.message : String(e));
        setStatus({ configured: false, connected: false });
      });
  }, [storeId]);

  async function save() {
    setSaving(true);
    const res = await setTeamsTenant(storeId, tenant);
    setSaving(false);
    if (res.ok) { toast.success(tenant.trim() ? "Teams tenant linked" : "Teams tenant cleared"); getTeamsStatus(storeId).then(setStatus).catch(() => {}); }
    else toast.error("Couldn't save", { description: res.error });
  }

  async function link(tenantId: string) {
    setLinking(tenantId);
    const res = await linkPendingTenant(storeId, tenantId);
    setLinking(null);
    if (res.ok) {
      toast.success("Connected to Teams");
      getTeamsStatus(storeId).then(setStatus).catch(() => {});
    } else toast.error("Couldn't connect", { description: res.error });
  }

  async function saveApprover() {
    setSavingApprover(true);
    const res = await setTeamsApprover(storeId, approver);
    setSavingApprover(false);
    if (res.ok) {
      toast.success(approver.trim() ? `Approvals go to ${approver.trim()}` : "Teams approvals off");
      getTeamsStatus(storeId).then(setStatus).catch(() => {});
    } else toast.error("Couldn't save", { description: res.error });
  }

  return (
    <div className="bg-card space-y-3 rounded-lg border p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold"><Users className="text-teal-deep size-4" /> Microsoft Teams</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Your team chats with it in Teams, in a normal 1:1 chat or by @mentioning it in a
          channel. It is an app, not a user account: no licence, no mailbox, no seat.
          Install it, message it once, then connect it here in a click.
        </p>
      </div>

      {status === null && <p className="text-muted-foreground text-sm">Checking…</p>}

      {problem && (
        <p className="text-destructive rounded-md border border-dashed p-3 text-xs">
          Couldn&apos;t read the Teams status: {problem}
        </p>
      )}

      {status && !status.configured && !problem && (
        <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
          Teams isn&apos;t switched on for this deployment yet. That&apos;s a one-time job on our
          side (an Azure bot and its credentials), not something you set up per organisation.
          Ask us and it applies to everyone.
        </p>
      )}

      {status?.configured && !status.connected && (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
            <li>Their Teams admin installs the app for the organisation.</li>
            <li>Their directory admin approves it once, using the link below.</li>
            <li>Anyone opens it in Teams and sends it one message. It will say it isn&apos;t
              connected yet, which is expected.</li>
            <li>Their organisation appears here. Click Connect.</li>
          </ol>

          {/* Steps 1 and 2 are the same person's job at most organisations, so the
              thing to send is both at once. Without this the approval link only
              existed AFTER a tenant had messaged us, which forced a second
              round-trip with the same administrator. */}
          <div className="space-y-1.5 border-t pt-2">
            <Label className="text-xs">The app package</Label>
            <p className="text-muted-foreground text-xs">
              The zip their Teams admin uploads. Built for this assistant, so the tile
              carries its name.
            </p>
            <Button size="sm" variant="outline" asChild>
              <a href="/api/teams-package" download>
                <Download className="size-3.5" /> Download the Teams app
              </a>
            </Button>
          </div>

          {status.setupConsentUrl && (
            <div className="space-y-1.5 border-t pt-2">
              <Label className="text-xs">Send this to their IT</Label>
              <p className="text-muted-foreground text-xs">
                One approval, for their whole organisation. It opens Microsoft&apos;s own
                consent screen — they need no account with us.
              </p>
              <Button size="sm" variant="outline" onClick={() => copyPack(status.setupConsentUrl!)}>
                <Copy className="size-3.5" /> Copy the setup note
              </Button>
            </div>
          )}
        </div>
      )}

      {status?.configured && !status.connected && (status.pending ?? []).length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <Label className="text-xs">Waiting to connect</Label>
          <p className="text-muted-foreground text-xs">
            Someone messaged the assistant in Teams from here. Connect it and they can
            carry on where they left off.
          </p>
          <ul className="space-y-2">
            {(status.pending ?? []).map((t) => (
              <li key={t.tenantId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.teamName ?? "Microsoft 365 organisation"}</span>
                  <span className="text-muted-foreground block truncate font-mono text-[11px]">
                    {t.tenantId}{t.sampleUser ? ` · ${t.sampleUser} messaged it` : ""}
                  </span>
                </span>
                {t.consentUrl && (
                  <Button size="sm" variant="ghost" onClick={() => copyConsent(t.consentUrl!)} title="Copy the admin-consent link for this organisation">
                    <Copy className="size-3.5" /> Consent link
                  </Button>
                )}
                <Button size="sm" onClick={() => link(t.tenantId)} disabled={linking === t.tenantId}>
                  {linking === t.tenantId ? <Loader2 className="size-4 animate-spin" /> : null} Connect
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Connected but anonymous: the install works, the directory lookup does not,
          and every symptom of that shows up somewhere else (no approver to send a
          card to, no personal Microsoft 365, no name on an audited action). Say it
          here, next to the link that fixes it. */}
      {status?.connected && status.consentMissing && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            It can&apos;t tell people apart yet
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300">
            The app is installed and answering, but this organisation hasn&apos;t approved it,
            so the directory lookup is refused and everyone arrives anonymous. Until it is
            approved there is nobody to send an approval to, no one&apos;s own calendar or mail,
            and no name against anything it does.
          </p>
          {status.consentUrl && (
            <Button size="sm" variant="outline" onClick={() => copyConsent(status.consentUrl!)}>
              <Copy className="size-3.5" /> Copy the approval link
            </Button>
          )}
        </div>
      )}

      {status?.configured && (
        <details className="rounded-md border p-3 [&_summary]:cursor-pointer">
          <summary className="text-xs font-medium">
            {status.connected ? "Azure tenant" : "Or paste your tenant ID manually"}
          </summary>
          <div className="mt-2 space-y-1.5">
          <Label className="text-xs">Your Azure tenant (directory) ID</Label>
          <p className="text-muted-foreground text-xs">
            {status.connected ? (
              <span className="text-teal-deep font-medium"><Check className="mr-1 inline size-3.5" />Linked</span>
            ) : "Paste your organization's Azure AD tenant id so Teams messages route to this store."}
          </p>
          <div className="flex gap-2">
            <Input value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-sm" />
            <Button size="sm" variant="outline" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </Button>
          </div>
          </div>
        </details>
      )}

      {status?.connected && status.consentUrl && (status.reachable ?? []).length === 0 && (
        <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
          <Label className="text-xs">One admin step left</Label>
          <p className="text-muted-foreground text-xs">
            Until an administrator there approves it, the assistant can chat but cannot tell
            who anyone is. Everyone shows up anonymous, so private knowledge stays hidden and
            tools that act as the signed-in person will decline. One click, once, by an admin.
          </p>
          <Button size="sm" variant="outline" onClick={() => copyConsent(status.consentUrl!)}>
            <Copy className="size-3.5" /> Copy the link to send them
          </Button>
        </div>
      )}

      {status?.connected && status.tenantId && (
        <ChannelRouting storeId={storeId} kind="teams" workspaceId={status.tenantId} />
      )}

      {status?.connected && (
        <div className="space-y-1.5 rounded-md border p-3">
          <Label className="text-xs">Who approves held actions</Label>
          <p className="text-muted-foreground text-xs">
            When the assistant is asked to do something you&apos;ve set to Hold, this person
            gets an Approve / Decline card in Teams. It goes to a person rather than a
            channel so nobody can approve their own request.
          </p>
          <div className="flex gap-2">
            <Input
              list="teams-reachable"
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
              placeholder="approver@yourcompany.com"
              className="text-sm"
            />
            <datalist id="teams-reachable">
              {(status.reachable ?? []).map((r) => (
                <option key={r.email} value={r.email}>{r.name ?? r.email}</option>
              ))}
            </datalist>
            <Button size="sm" variant="outline" onClick={saveApprover} disabled={savingApprover}>
              {savingApprover ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {(status.reachable ?? []).length === 0
              ? "Nobody has messaged the assistant in Teams yet. Whoever approves must send it one message first, so it has somewhere to reach them."
              : `${(status.reachable ?? []).length} ${(status.reachable ?? []).length === 1 ? "person has" : "people have"} messaged it and can be nominated. Anyone else must message it once first.`}
          </p>
        </div>
      )}
    </div>
  );
}
