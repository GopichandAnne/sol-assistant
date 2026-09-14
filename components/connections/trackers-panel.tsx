"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, Plus, Table2, Trash2 } from "lucide-react";
import {
  addTracker,
  listTrackers,
  removeTracker,
  setTrackerThreshold,
  setTrackerWritable,
  type Tracker,
} from "@/app/(app)/connections/workbook-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Spreadsheets the assistant treats as systems of record.
 *
 * Registered rather than discovered, so a question about leave opens a known
 * table with known columns instead of whichever file looked promising. The
 * "what it's for" line is not a description for people — it is what the model
 * reads when deciding which tracker to open, which is why it is required.
 */
export function TrackersPanel() {
  const [items, setItems] = useState<Tracker[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [tableName, setTableName] = useState("Table1");
  const [who, setWho] = useState("");
  const [writable, setWritable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [limit, setLimit] = useState("");
  const [amountCol, setAmountCol] = useState("");
  const [, start] = useTransition();

  useEffect(() => {
    listTrackers().then(setItems).catch(() => {});
  }, []);

  function add() {
    setBusy(true);
    start(async () => {
      const res = await addTracker({ name, purpose, fileUrl, tableName, connectedBy: who, writable });
      setBusy(false);
      if (!res.ok) { toast.error("Couldn't add it", { description: res.error }); return; }
      toast.success("Connected", { description: `The assistant can now read the ${name}.` });
      setName(""); setPurpose(""); setFileUrl(""); setTableName("Table1"); setWritable(false);
      setOpen(false);
      listTrackers().then(setItems).catch(() => {});
    });
  }

  function toggleWrite(t: Tracker, next: boolean) {
    setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, writable: next } : x)));
    start(async () => {
      const res = await setTrackerWritable(t.id, next);
      if (!res.ok) {
        setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, writable: !next } : x)));
        toast.error("Couldn't change that", { description: res.error });
      } else if (next) {
        toast.success("Writing allowed", { description: "Changes still wait for a person to approve them." });
      }
    });
  }

  function openThreshold(t: Tracker) {
    setEditing(t.id === editing ? null : t.id);
    setLimit(t.autoBelow == null ? "" : String(t.autoBelow));
    setAmountCol(t.amountField ?? "");
  }

  function saveThreshold(t: Tracker) {
    const n = limit.trim() === "" ? null : Number(limit.trim());
    start(async () => {
      const res = await setTrackerThreshold(t.id, n, amountCol);
      if (!res.ok) { toast.error("Couldn't save that", { description: res.error }); return; }
      setEditing(null);
      toast.success(n == null ? "Every change waits for approval" : `Changes under ${n} run on their own`);
      listTrackers().then(setItems).catch(() => {});
    });
  }

  function remove(t: Tracker) {
    start(async () => {
      const res = await removeTracker(t.id);
      if (!res.ok) { toast.error("Couldn't remove", { description: res.error }); return; }
      setItems((prev) => prev.filter((x) => x.id !== t.id));
      toast.success("Disconnected");
    });
  }

  return (
    <section className="bg-card space-y-3 rounded-lg border p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Table2 className="size-4" style={{ color: "var(--sol-orange-dark)" }} />
            Trackers
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Spreadsheets the assistant can look things up in, and &mdash; where you allow it &mdash;
            add to. Point it at a table in a workbook on SharePoint or OneDrive.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
          <Plus className="size-3.5" /> Add
        </Button>
      </div>

      {open && (
        <div className="space-y-3 rounded-md border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tr-name" className="text-xs">Name</Label>
              <Input id="tr-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Leave tracker" disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-table" className="text-xs">Table inside the file</Label>
              <Input id="tr-table" value={tableName} onChange={(e) => setTableName(e.target.value)}
                placeholder="Table1" disabled={busy} />
              <p className="text-muted-foreground text-xs">
                In Excel: select your data, Insert &rarr; Table, then read the name from Table Design.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tr-purpose" className="text-xs">What it&apos;s for</Label>
            <Input id="tr-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}
              placeholder="Who is off, when, and whether it was approved" disabled={busy} />
            <p className="text-muted-foreground text-xs">
              One line. This is what the assistant reads when deciding whether this is the right
              table to open, so describe the questions it answers.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tr-url" className="text-xs">Link to the spreadsheet</Label>
            <Input id="tr-url" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://contoso.sharepoint.com/sites/HR/Shared Documents/Leave.xlsx" disabled={busy} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tr-who" className="text-xs">Read as</Label>
            <Input id="tr-who" value={who} onChange={(e) => setWho(e.target.value)}
              placeholder="you@yourcompany.com" disabled={busy} autoComplete="off" />
            <p className="text-muted-foreground text-xs">
              Opened with this person&apos;s Microsoft 365 access, so it reaches what they can reach.
            </p>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Switch checked={writable} onCheckedChange={setWritable} disabled={busy} />
            <span>
              Let it add and change rows
              <span className="text-muted-foreground block text-xs">
                Off by default. Even on, every change waits for a person to approve it.
              </span>
            </span>
          </label>

          <Button size="sm" onClick={add} disabled={busy || !name.trim() || !purpose.trim() || !fileUrl.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Connect it
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
          No trackers connected. Until one is, the assistant can answer from documents but can&apos;t
          look anything up in a record.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {t.name}
                  <a href={t.fileUrl} target="_blank" rel="noreferrer" aria-label="Open the spreadsheet">
                    <ExternalLink className="text-muted-foreground size-3" />
                  </a>
                </p>
                <p className="text-muted-foreground text-xs">{t.purpose}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  table {t.tableName}{t.connectedBy ? ` · as ${t.connectedBy}` : ""}
                </p>
                {t.writable && (
                  <button
                    type="button"
                    onClick={() => openThreshold(t)}
                    className="mt-1 text-xs underline underline-offset-2"
                    style={{ color: "var(--sol-orange-dark)" }}
                  >
                    {t.autoBelow == null
                      ? "Every change waits for approval"
                      : `Changes under ${t.autoBelow} run on their own`}
                  </button>
                )}
                {editing === t.id && (
                  <div className="mt-2 space-y-2 rounded-md border p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`lim-${t.id}`} className="text-xs">Run without approval below</Label>
                        <Input id={`lim-${t.id}`} value={limit} inputMode="decimal"
                          onChange={(e) => setLimit(e.target.value)} placeholder="Leave empty to hold everything" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`col-${t.id}`} className="text-xs">Column holding the amount</Label>
                        <Input id={`col-${t.id}`} value={amountCol}
                          onChange={(e) => setAmountCol(e.target.value)} placeholder="Amount" />
                      </div>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Anything at or above the limit still waits, and so does any change where that
                      column is missing or unreadable.
                    </p>
                    <Button size="sm" onClick={() => saveThreshold(t)}>Save</Button>
                  </div>
                )}
                {t.lastError && <p className="text-destructive mt-1 text-xs">{t.lastError}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs">
                  <Switch checked={t.writable} onCheckedChange={(v) => toggleWrite(t, v)} aria-label="Allow writing" />
                  write
                </label>
                <Button size="icon" variant="ghost" onClick={() => remove(t)} aria-label="Disconnect">
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
