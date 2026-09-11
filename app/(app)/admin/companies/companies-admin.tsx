"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Coins, Bot, Plus, TriangleAlert, UserPlus } from "lucide-react";
import { AssistantReadiness } from "./assistant-readiness";
import { ProvisionClient } from "./provision-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createCompany,
  grantCredits,
  assignStore,
  addMemberByEmail,
  type CompanyRow,
} from "./actions";

/**
 * Platform-admin view of accounts. Credits are granted here — there is no
 * checkout in this product — so this screen is the only way a balance goes up.
 */
export function CompaniesAdmin({
  companies,
  unassigned,
}: {
  companies: CompanyRow[];
  unassigned: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [pending, start] = useTransition();

  function create() {
    start(async () => {
      const res = await createCompany(newName);
      if (res.ok) {
        toast.success(`Created ${newName.trim()}`);
        setNewName("");
        router.refresh();
      } else toast.error("Couldn't create", { description: res.error });
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl">Accounts</h1>
        <p className="text-muted-foreground text-sm">
          Each account holds one credit pool shared by its assistants.
        </p>
      </header>

      <ProvisionClient />

      <section className="bg-card rounded-xl border p-5">
        <h2 className="font-display mb-1 font-bold">Empty account</h2>
        <p className="text-muted-foreground mb-3 text-xs">
          Just the credit pool, for attaching an assistant that already exists.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="Company name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) create(); }}
          />
          <Button disabled={pending || !newName.trim()} onClick={create}>
            <Plus className="size-4" /> Create
          </Button>
        </div>
      </section>

      {unassigned.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-amber-600 dark:text-amber-500" />
            <h2 className="font-display font-bold">
              {unassigned.length} assistant{unassigned.length === 1 ? "" : "s"} not on an account
            </h2>
          </div>
          <p className="text-muted-foreground mt-1 mb-3 text-sm">
            Their usage is recorded but billed to nobody. Attach each one to an account.
          </p>
          <ul className="space-y-2">
            {unassigned.map((s) => (
              <AssignRow key={s.id} store={s} companies={companies} />
            ))}
          </ul>
        </section>
      )}

      {companies.length === 0 ? (
        <p className="text-muted-foreground text-sm">No accounts yet.</p>
      ) : (
        companies.map((c) => <CompanyCard key={c.id} company={c} />)
      )}
    </div>
  );
}

function AssignRow({
  store,
  companies,
}: {
  store: { id: string; name: string };
  companies: CompanyRow[];
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState("");
  const [pending, start] = useTransition();

  function assign() {
    start(async () => {
      const res = await assignStore(store.id, companyId);
      if (res.ok) {
        toast.success(`${store.name} attached`);
        router.refresh();
      } else toast.error("Couldn't attach", { description: res.error });
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <Bot className="text-muted-foreground size-3.5 shrink-0" />
      <span className="min-w-32 flex-1 truncate font-medium">{store.name}</span>
      <select
        className="bg-background h-9 rounded-md border px-2 text-sm"
        value={companyId}
        onChange={(e) => setCompanyId(e.target.value)}
        aria-label={`Account for ${store.name}`}
      >
        <option value="">Choose an account…</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <Button size="sm" variant="outline" disabled={pending || !companyId} onClick={assign}>
        Attach
      </Button>
    </li>
  );
}

function CompanyCard({ company: c }: { company: CompanyRow }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [pending, start] = useTransition();
  const low = c.remaining <= c.threshold;

  function grant() {
    const n = parseInt(amount, 10);
    start(async () => {
      const res = await grantCredits(c.id, n, reason);
      if (res.ok) {
        toast.success(`Granted ${n.toLocaleString()} — now ${res.remaining.toLocaleString()} remaining`);
        setAmount(""); setReason("");
        router.refresh();
      } else toast.error("Couldn't grant", { description: res.error });
    });
  }

  function addMember() {
    start(async () => {
      const res = await addMemberByEmail(c.id, memberEmail, "admin");
      if (res.ok) {
        toast.success(`${memberEmail.trim()} added`);
        setMemberEmail("");
        router.refresh();
      } else toast.error("Couldn't add", { description: res.error });
    });
  }

  return (
    <section className="bg-card rounded-xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display flex items-center gap-2 font-bold">
            <Building2 className="size-4" /> {c.name}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {c.assistants.length === 0
              ? "No assistants yet"
              : `${c.assistants.length} assistant${c.assistants.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="text-right">
          <div className={`font-display text-2xl font-extrabold tabular-nums ${low ? "text-amber-600 dark:text-amber-500" : ""}`}>
            {c.remaining.toLocaleString()}
          </div>
          <div className="text-muted-foreground text-xs">
            granted {c.granted.toLocaleString()} · used {c.spent.toLocaleString()}
          </div>
        </div>
      </div>

      {low && (
        <p className="mt-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-3.5 shrink-0" />
          At or below its {c.threshold.toLocaleString()}-credit warning level
          {c.warned ? " — warning sent" : ""}.
        </p>
      )}

      <AssistantReadiness assistants={c.assistants} />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-muted-foreground mb-1.5 block text-xs font-medium">Grant credits</label>
          <div className="flex gap-2">
            <Input
              type="number" min={1} placeholder="Credits" value={amount}
              onChange={(e) => setAmount(e.target.value)} className="max-w-28"
            />
            <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button size="sm" disabled={pending || !amount} onClick={grant}>
              <Coins className="size-4" /> Grant
            </Button>
          </div>
        </div>
        <div>
          <label className="text-muted-foreground mb-1.5 block text-xs font-medium">Add an admin</label>
          <div className="flex gap-2">
            <Input
              type="email" placeholder="their@email.com" value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
            />
            <Button size="sm" variant="outline" disabled={pending || !memberEmail.trim()} onClick={addMember}>
              <UserPlus className="size-4" /> Add
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
