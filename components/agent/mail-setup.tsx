"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Loader2, Mail, Send } from "lucide-react";
import { getMailSetup, saveMailSetup, testMailSetup, type MailSetup } from "@/app/(app)/agent/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Where the assistant's email comes from.
 *
 * Without this an account's notifications leave from ours, which is fine while we
 * are the only account and wrong as soon as a client wants their people to get
 * mail from their own domain — the version that also survives their spam filter.
 *
 * Two deliberate choices. The password is never read back, only replaced: a field
 * that shows a stored secret is a secret in a screenshot. And "saved" is not the
 * same claim as "working", so the panel only says it works after a test message
 * has actually gone out.
 */
export function MailSetup() {
  const [state, setState] = useState<MailSetup | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [fromName, setFromName] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [, start] = useTransition();

  useEffect(() => {
    getMailSetup().then((s) => {
      if (!s) return;
      setState(s);
      setHost(s.host); setPort(String(s.port || 587)); setUsername(s.username);
      setFromAddress(s.fromAddress ?? ""); setFromName(s.fromName ?? "");
    }).catch(() => {});
  }, []);

  function save() {
    setBusy(true);
    start(async () => {
      const res = await saveMailSetup({
        host, port: Number(port) || 587, username,
        password: password || undefined,
        fromAddress, fromName,
      });
      setBusy(false);
      if (!res.ok) { toast.error("Couldn't save", { description: res.error }); return; }
      setPassword("");
      toast.success("Saved", { description: "Send a test to confirm it works." });
      getMailSetup().then((s) => s && setState(s)).catch(() => {});
    });
  }

  function test() {
    setTesting(true);
    start(async () => {
      const res = await testMailSetup();
      setTesting(false);
      if (!res.ok) { toast.error("It didn't go out", { description: res.error }); return; }
      toast.success("Sent", { description: `Check ${res.to}.` });
      getMailSetup().then((s) => s && setState(s)).catch(() => {});
    });
  }

  return (
    <section className="bg-card space-y-3 rounded-lg border p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Mail className="size-4" style={{ color: "var(--sol-orange-dark)" }} /> Where its email comes from
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Escalations and approvals reach people in Teams or Slack where it can, and by email
          otherwise. Set your own mail server so that email arrives from your domain rather than
          ours.
        </p>
      </div>

      {state?.configured && state.verifiedAt && (
        <p className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--sol-teal-dark)" }}>
          <Check className="size-4" /> Working — a test message went out
        </p>
      )}
      {state?.configured && !state.verifiedAt && (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          Saved, but not yet proven. Send a test so you know it works before something depends on it.
        </p>
      )}
      {state?.lastError && (
        <p className="text-destructive text-xs">{state.lastError}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="m-host" className="text-xs">Server</Label>
          <Input id="m-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.resend.com" disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-port" className="text-xs">Port</Label>
          <Input id="m-port" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-user" className="text-xs">Username</Label>
          <Input id="m-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-pass" className="text-xs">
            Password {state?.configured ? <span className="text-muted-foreground">(leave blank to keep)</span> : null}
          </Label>
          <Input id="m-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-from" className="text-xs">Send from</Label>
          <Input id="m-from" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="assistant@yourcompany.com" disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-fromname" className="text-xs">Shown as</Label>
          <Input id="m-fromname" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Northwind Assistant" disabled={busy} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy || !host.trim() || !username.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save
        </Button>
        {state?.configured && (
          <Button size="sm" variant="outline" onClick={test} disabled={testing}>
            {testing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-3.5" />} Send a test to me
          </Button>
        )}
      </div>

      <p className="text-muted-foreground text-[11px]">
        Any SMTP server works. A transactional provider is a better fit than a mailbox —
        Microsoft 365 and Google both rate-limit application mail and are retiring basic
        authentication for it.
      </p>
    </section>
  );
}
