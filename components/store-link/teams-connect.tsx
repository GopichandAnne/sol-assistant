"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getTeamsStatus, setTeamsApprover, setTeamsTenant, type TeamsStatus } from "@/app/(app)/link/teams-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Loader2, Users } from "lucide-react";

export function TeamsConnect({ storeId }: { storeId: string }) {
  const [status, setStatus] = useState<TeamsStatus | null>(null);
  const [tenant, setTenant] = useState("");
  const [saving, setSaving] = useState(false);
  const [approver, setApprover] = useState("");
  const [savingApprover, setSavingApprover] = useState(false);

  useEffect(() => {
    getTeamsStatus(storeId)
      .then((s) => { setStatus(s); setTenant(s.tenantId ?? ""); setApprover(s.approvalsEmail ?? ""); })
      .catch(() => setStatus({ configured: false, connected: false }));
  }, [storeId]);

  async function save() {
    setSaving(true);
    const res = await setTeamsTenant(storeId, tenant);
    setSaving(false);
    if (res.ok) { toast.success(tenant.trim() ? "Teams tenant linked" : "Teams tenant cleared"); getTeamsStatus(storeId).then(setStatus).catch(() => {}); }
    else toast.error("Couldn't save", { description: res.error });
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
          Add the assistant to Teams as a teammate — it answers DMs and @mentions and recognizes each person by
          their Microsoft (Azure AD) identity.
        </p>
      </div>

      {status === null && <p className="text-muted-foreground text-sm">Checking…</p>}

      {status && !status.configured && (
        <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
          Teams isn&apos;t set up on this deployment yet. It needs an Azure Bot + app registration and{" "}
          <code className="bg-muted rounded px-1">MICROSOFT_APP_ID</code> /{" "}
          <code className="bg-muted rounded px-1">MICROSOFT_APP_PASSWORD</code> on the function.
        </p>
      )}

      {status?.configured && (
        <div className="space-y-1.5 rounded-md border p-3">
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
