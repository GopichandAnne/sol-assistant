"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Rocket } from "lucide-react";
import { ASSISTANT_TEMPLATES } from "@/lib/assistant-templates";
import { provisionClient } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Stand a client up in one form.
 *
 * This used to be four screens: make the account here, make the assistant on the
 * stores page (seeded from a retail business-type preset), come back to attach
 * it, invite an owner, then switch in and configure everything by hand. Somebody
 * doing that for the fifth client would get it subtly wrong on at least one.
 *
 * So: pick what the assistant is for, and it arrives with its brief, its
 * personality, its opening line and the approvals that blueprint says should
 * never happen without a person — plus its credit pool and its own administrator.
 * The client then has a checklist to finish rather than a blank assistant.
 */
export function ProvisionClient() {
  const router = useRouter();
  const [company, setCompany] = useState("");
  const [assistant, setAssistant] = useState("");
  const [template, setTemplate] = useState(ASSISTANT_TEMPLATES[0]?.key ?? "");
  const [email, setEmail] = useState("");
  const [credits, setCredits] = useState("2000");
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();

  function submit() {
    const name = company.trim();
    if (!name) {
      toast.error("Enter the client's name");
      return;
    }
    setBusy(true);
    start(async () => {
      const res = await provisionClient({
        companyName: name,
        assistantName: assistant.trim() || undefined,
        templateKey: template,
        adminEmail: email.trim() || undefined,
        credits: Number(credits) || 0,
      });
      setBusy(false);
      if (!res.ok) {
        toast.error("Couldn't set that up", { description: res.error });
        return;
      }
      // Warnings are the parts that did not land. The client still exists, so
      // this is information rather than a failure — but it must not pass silently.
      if (res.warnings.length > 0) {
        toast.warning("Set up, with gaps", { description: res.warnings.join(" · ") });
      } else {
        toast.success(`${name} is set up`, {
          description: res.invited ? "Their administrator has been emailed an invitation." : undefined,
        });
      }
      setCompany(""); setAssistant(""); setEmail("");
      router.refresh();
    });
  }

  return (
    <section className="bg-card rounded-xl border p-5">
      <h2 className="font-display mb-1 flex items-center gap-2 font-bold">
        <Rocket className="size-4" /> Set up a client
      </h2>
      <p className="text-muted-foreground mb-4 text-sm">
        Creates the account, an assistant already briefed for the job, its opening credits,
        and invites their administrator.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="p-company" className="text-xs">Client</Label>
          <Input
            id="p-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Northwind Logistics"
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-assistant" className="text-xs">Assistant name (optional)</Label>
          <Input
            id="p-assistant"
            value={assistant}
            onChange={(e) => setAssistant(e.target.value)}
            placeholder="Defaults to the client's name"
            disabled={busy}
          />
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="text-xs font-medium">What is it for?</legend>
        <p className="text-muted-foreground mb-2 text-xs">
          Decides its brief, its tone, and what it holds for approval. All editable afterwards.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {ASSISTANT_TEMPLATES.map((t) => (
            <label
              key={t.key}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-left transition-colors ${
                template === t.key ? "border-[var(--sol-orange)] bg-[var(--sol-orange-pale)]/40" : "hover:border-[var(--sol-orange)]"
              }`}
            >
              <input
                type="radio"
                name="template"
                className="mt-1"
                checked={template === t.key}
                onChange={() => setTemplate(t.key)}
                disabled={busy}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t.name}</span>
                <span className="text-muted-foreground block text-xs">{t.tagline}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="p-email" className="text-xs">Their administrator (optional)</Label>
          <Input
            id="p-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@client.com"
            disabled={busy}
          />
          <p className="text-muted-foreground text-[11px]">
            Invited by email, and made owner of both the account and the assistant.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-credits" className="text-xs">Opening credits</Label>
          <Input
            id="p-credits"
            type="number"
            min={0}
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            disabled={busy}
          />
          <p className="text-muted-foreground text-[11px]">
            So it can answer before anyone has to talk about billing.
          </p>
        </div>
      </div>

      <Button className="mt-4" onClick={submit} disabled={busy || !company.trim()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
        Set up client
      </Button>
    </section>
  );
}
