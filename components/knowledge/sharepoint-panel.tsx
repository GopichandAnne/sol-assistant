"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, FolderSync, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import {
  addSharePointSource,
  listMicrosoftConnections,
  listSharePointSources,
  previewSharePointFolder,
  removeSharePointSource,
  replanSharePointSource,
  syncSharePointStep,
  type PreviewResult,
  type SharePointSource,
} from "@/app/(app)/knowledge/sharepoint-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * A SharePoint folder as a knowledge source.
 *
 * Two parts of this are load-bearing rather than decorative.
 *
 * The preview: Files.Read.All reaches everything the connecting person can
 * reach, so an owner sees the real file list before anything is read. It is what
 * stops a folder that turned out to hold compensation bands quietly becoming
 * answerable by everyone who can chat to the assistant.
 *
 * The progress loop: syncing is batched server-side, so the browser keeps asking
 * for another pass until the work is finished and shows the count as it goes. A
 * folder of scanned PDFs takes minutes, and a spinner with no number is how
 * somebody decides it has hung and presses the button again.
 */
function fmt(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function SharePointPanel() {
  const [sources, setSources] = useState<SharePointSource[]>([]);
  const [conns, setConns] = useState<{ userKey: string; label: string }[]>([]);
  const [url, setUrl] = useState("");
  const [who, setWho] = useState("");
  const [subfolders, setSubfolders] = useState(true);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ id: string; indexed: number; pending: number } | null>(null);
  const [, start] = useTransition();

  const reload = useCallback(() => {
    listSharePointSources().then(setSources).catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    listMicrosoftConnections().then((c) => {
      setConns(c);
      // Default to a person who has actually connected, so the common case needs
      // no typing and the uncommon one is still possible.
      const person = c.find((x) => x.userKey);
      if (person) setWho(person.userKey);
    }).catch(() => {});
  }, [reload]);

  /** Keep asking for another pass until the server says it is finished. */
  const drain = useCallback(async (id: string) => {
    let indexed = 0;
    for (let pass = 0; pass < 200; pass++) {
      const step = await syncSharePointStep(id);
      if (!step.ok) {
        setProgress(null);
        toast.error("Sync stopped", {
          description: step.error,
          action: step.approveUrl
            ? { label: "Get approval", onClick: () => window.open(step.approveUrl!, "_blank") }
            : undefined,
        });
        return;
      }
      indexed += step.indexed;
      setProgress({ id, indexed, pending: step.pending });
      if (step.done) {
        setProgress(null);
        toast.success("Indexed", { description: step.summary ?? `${indexed} documents.` });
        reload();
        return;
      }
    }
    setProgress(null);
    toast.error("That folder is taking longer than expected", {
      description: "Press Sync again to carry on where it stopped.",
    });
    reload();
  }, [reload]);

  function look() {
    setBusy(true);
    setPreview(null);
    start(async () => {
      const res = await previewSharePointFolder(url, who, subfolders);
      setBusy(false);
      setPreview(res);
      if (!res.ok) {
        toast.error("Couldn't open that folder", {
          description: res.error,
          action: res.approveUrl
            ? { label: "Get approval", onClick: () => window.open(res.approveUrl!, "_blank") }
            : undefined,
        });
      }
    });
  }

  function connect() {
    setBusy(true);
    start(async () => {
      const added = await addSharePointSource(url, who, subfolders);
      setBusy(false);
      if (!added.ok || !added.id) {
        toast.error("Couldn't connect", { description: added.error });
        return;
      }
      setUrl("");
      setPreview(null);
      reload();
      await drain(added.id);
    });
  }

  function resync(s: SharePointSource) {
    start(async () => {
      setProgress({ id: s.id, indexed: 0, pending: 0 });
      const planned = await replanSharePointSource(s.id);
      if (!planned.ok) {
        setProgress(null);
        toast.error("Couldn't check that folder", { description: planned.error });
        return;
      }
      await drain(s.id);
    });
  }

  function remove(s: SharePointSource) {
    start(async () => {
      const res = await removeSharePointSource(s.id);
      if (!res.ok) { toast.error("Couldn't remove", { description: res.error }); return; }
      setSources((prev) => prev.filter((x) => x.id !== s.id));
      toast.success("Disconnected", { description: "The documents it indexed are still here." });
    });
  }

  return (
    <section className="bg-card space-y-3 rounded-lg border p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FolderSync className="size-4" style={{ color: "var(--sol-orange-dark)" }} />
          From SharePoint
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Point at a folder and its documents become answers. Sync again after a policy changes and
          the answer changes with it.
        </p>
      </div>

      {conns.length === 0 && (
        <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
          Nobody has connected Microsoft 365 for this assistant yet. Connect it under Tools &amp;
          systems first &mdash; a folder is read with a person&apos;s own access, so there has to be
          a person.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sp-url" className="text-xs">Folder link</Label>
          <Input
            id="sp-url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setPreview(null); }}
            placeholder="https://contoso.sharepoint.com/sites/HR/Shared Documents/Policies"
            disabled={busy}
          />
          <p className="text-muted-foreground text-xs">
            Open the folder in SharePoint and copy the address bar.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sp-who" className="text-xs">Read as</Label>
          {conns.length > 1 ? (
            <select
              id="sp-who"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              disabled={busy}
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              {conns.map((c) => (
                <option key={c.userKey || "org"} value={c.userKey}>{c.label}</option>
              ))}
            </select>
          ) : (
            <Input
              id="sp-who"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder="you@yourcompany.com"
              disabled={busy}
              autoComplete="off"
            />
          )}
          <p className="text-muted-foreground text-xs">
            The folder is read with this person&apos;s access, so it reaches exactly what they can
            reach &mdash; and nothing they can&apos;t.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Switch checked={subfolders} onCheckedChange={setSubfolders} disabled={busy} />
        Include sub-folders
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={look} disabled={busy || !url.trim()}>
          {busy && !preview ? <Loader2 className="size-4 animate-spin" /> : null} Show me what&apos;s in it
        </Button>
        {preview?.ok && preview.files.length > 0 && (
          <Button size="sm" onClick={connect} disabled={busy || !!progress}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-3.5" />}{" "}
            Index these {preview.files.length}
          </Button>
        )}
      </div>

      {preview?.ok && (
        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">{preview.label}</p>
          {preview.files.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-sm">
              Nothing readable in here. Word, PowerPoint, PDF, text, Markdown and spreadsheets work.
            </p>
          ) : (
            <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
              {preview.files.map((f) => (
                <li key={f.name} className="text-sm">{f.name}</li>
              ))}
            </ul>
          )}
          {preview.skipped.length > 0 && (
            <p className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              Skipping {preview.skipped.length} file{preview.skipped.length === 1 ? "" : "s"} of a
              type that can&apos;t be read: {preview.skipped.slice(0, 4).join(", ")}
              {preview.skipped.length > 4 ? "…" : ""}
            </p>
          )}
          {preview.truncated && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
              That folder holds more files than this reads in one go. The first 400 are listed.
            </p>
          )}
        </div>
      )}

      {sources.length > 0 && (
        <ul className="space-y-2 border-t pt-3">
          {sources.map((s) => {
            const p = progress?.id === s.id ? progress : null;
            return (
              <li key={s.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {s.label || s.folderUrl}
                    <a href={s.folderUrl} target="_blank" rel="noreferrer" aria-label="Open in SharePoint">
                      <ExternalLink className="text-muted-foreground size-3" />
                    </a>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {p
                      ? `Indexing — ${p.indexed} done${p.pending ? `, ${p.pending} to go` : ""}`
                      : `${s.lastResult ?? "not synced yet"} · last synced ${fmt(s.lastSyncedAt)}`}
                    {s.connectedBy ? ` · as ${s.connectedBy}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => resync(s)} disabled={!!progress}>
                    {p ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    Sync
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(s)} disabled={!!progress} aria-label="Disconnect">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
