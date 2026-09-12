"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarClock, Loader2, Play, Trash2, UserCheck } from "lucide-react";
import {
  createTrigger,
  deleteTrigger,
  setTriggerActive,
  type Schedule,
  type Trigger,
} from "@/app/(app)/scheduled/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

/**
 * Work the assistant does without being asked.
 *
 * The two fields that matter are the instruction and who it acts as. The
 * instruction is written the way you would ask a colleague, deliberately: it is
 * handed to the assistant as an ordinary turn, so anything it cannot do when
 * asked in chat it also cannot do here, and a separate syntax would only hide
 * that. "Acts as" is the one that keeps this honest — a scheduled job with no
 * named person behind it is an action nobody can be asked about afterwards.
 */
const SCHEDULE_LABEL: Record<Schedule, string> = {
  hourly: "Every hour",
  daily: "Every day",
  weekdays: "Weekdays only",
};

function when(t: Trigger): string {
  if (t.schedule === "hourly") return "Every hour";
  const h = `${String(t.atHour).padStart(2, "0")}:00`;
  return t.schedule === "weekdays" ? `Weekdays at ${h}` : `Every day at ${h}`;
}

function fmt(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ScheduledView({ initial, storeName }: { initial: Trigger[]; storeName: string }) {
  const [items, setItems] = useState(initial);
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [schedule, setSchedule] = useState<Schedule>("weekdays");
  const [atHour, setAtHour] = useState("9");
  const [runsAs, setRunsAs] = useState("");
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();

  function add() {
    setBusy(true);
    start(async () => {
      const res = await createTrigger({
        name,
        instruction,
        schedule,
        atHour: Number(atHour) || 9,
        runsAs,
      });
      setBusy(false);
      if (!res.ok) {
        toast.error("Couldn't save", { description: res.error });
        return;
      }
      toast.success("Scheduled", { description: "It runs once shortly, then keeps to the schedule." });
      setName("");
      setInstruction("");
      setRunsAs("");
      location.reload();
    });
  }

  function toggle(t: Trigger, next: boolean) {
    setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, active: next } : x)));
    start(async () => {
      const res = await setTriggerActive(t.id, next);
      if (!res.ok) {
        setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, active: !next } : x)));
        toast.error("Couldn't change that", { description: res.error });
      }
    });
  }

  function remove(t: Trigger) {
    start(async () => {
      const res = await deleteTrigger(t.id);
      if (!res.ok) {
        toast.error("Couldn't delete", { description: res.error });
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== t.id));
      toast.success("Removed", { description: "Its past runs are kept." });
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <header>
        <h1 className="font-display text-2xl">Scheduled work</h1>
        <p className="text-muted-foreground text-sm">
          {storeName} &mdash; things it does without being asked. Each one runs on its own, as a
          named person, with the same knowledge, tools and approvals as when somebody asks in chat.
        </p>
      </header>

      <section className="bg-card space-y-3 rounded-lg border p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CalendarClock className="size-4" style={{ color: "var(--sol-orange-dark)" }} />
          Add something
        </h2>

        <div className="space-y-1.5">
          <Label htmlFor="t-name" className="text-xs">Name</Label>
          <Input
            id="t-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Morning handover"
            disabled={busy}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="t-instruction" className="text-xs">What it should do</Label>
          <Textarea
            id="t-instruction"
            value={instruction}
            rows={3}
            disabled={busy}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Check for questions nobody has answered in over a day, and tell the IT responders about them."
          />
          <p className="text-muted-foreground text-xs">
            Write it the way you&apos;d ask a colleague. It reaches the same knowledge and tools it
            has in a chat &mdash; so if it can&apos;t do this when asked, scheduling it won&apos;t
            help.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="t-sched" className="text-xs">How often</Label>
            <select
              id="t-sched"
              value={schedule}
              disabled={busy}
              onChange={(e) => setSchedule(e.target.value as Schedule)}
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              {(Object.keys(SCHEDULE_LABEL) as Schedule[]).map((s) => (
                <option key={s} value={s}>{SCHEDULE_LABEL[s]}</option>
              ))}
            </select>
          </div>
          {schedule !== "hourly" && (
            <div className="space-y-1.5">
              <Label htmlFor="t-hour" className="text-xs">At (the assistant&apos;s timezone)</Label>
              <Input
                id="t-hour"
                value={atHour}
                inputMode="numeric"
                disabled={busy}
                onChange={(e) => setAtHour(e.target.value)}
                placeholder="9"
              />
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="t-as" className="text-xs">Acts as</Label>
          <Input
            id="t-as"
            value={runsAs}
            onChange={(e) => setRunsAs(e.target.value)}
            placeholder="ops.lead@yourcompany.com"
            disabled={busy}
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">
            Whose authority it borrows. Everything it does is recorded against this person, and
            anything consequential still waits for an approver &mdash; exactly as if they had asked.
          </p>
        </div>

        <Button size="sm" onClick={add} disabled={busy || !name.trim() || !instruction.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-3.5" />} Schedule it
        </Button>
      </section>

      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
          Nothing scheduled yet. Until something is, the assistant only acts when a person messages
          it.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li key={t.id} className="bg-card rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{t.name}</p>
                  <p className="text-muted-foreground mt-0.5 text-sm">{t.instruction}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={t.active}
                    onCheckedChange={(v) => toggle(t, v)}
                    aria-label={t.active ? "Turn off" : "Turn on"}
                  />
                  <Button size="icon" variant="ghost" onClick={() => remove(t)} aria-label="Delete">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="flex items-center gap-1">
                  <CalendarClock className="size-3" /> {when(t)}
                </span>
                <span className="flex items-center gap-1">
                  <UserCheck className="size-3" /> as {t.runsAs}
                </span>
                <span>last run {fmt(t.lastRunAt)}</span>
                {t.active && <span>next {fmt(t.nextRunAt)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
