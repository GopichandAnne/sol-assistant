"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, FolderSync, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import {
  addSharePointSource,
  listSharePointSources,
  previewSharePointFolder,
  removeSharePointSource,
  syncSharePointSource,
  type PreviewResult,
  type SharePointSource,
} from "@/app/(app)/knowledge/sharepoint-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A SharePoint folder as a knowledge source.
 *
 * The preview step is not decoration. Files.Read.All reads everything the
 * connecting person can reach, so the one thing an owner must see before any
 * indexing happens is the actual list of files about to be read — that is what
 * stops a folder that turned out to contain payroll becoming answerable by
 * everyone who chats to the assistant.
 */
function fmt(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function SharePointPanel() {
  const [sources, setSources] = useState<SharePointSource[]>([]);
  const [url, setUrl] = useState("");
  const [who, setWho] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    listSharePointSources().then(setSources).catch(() => {});
  }, []);

  function look() {
    setBusy(true);
    setPreview(null);
    start(async () => {
      const res = await previewSharePointFolder(url, who);
      setBusy(false);
      setPreview(res);
      if (!res.ok) toast.error("Couldn't open that folder", { description: res.error });
    });
  }

  function connect() {
    setBusy(true);
    start(async () => {
      const added = await addSharePointSource(url, who);
      if (!added.ok || !added.id) {
        setBusy(false);
        toast.error("Couldn't connect", { description: added.error });
        return;
      }
      const synced = await syncSharePointSource(added.id);
      setBusy(false);
      if (!synced.ok) {
        toast.error("Connected, but the first sync failed", { description: synced.error });
      } else {
        toast.success("Indexed", { description: synced.summary });
      }
      setUrl("");
      setPreview(null);
      listSharePointSources().then(setSources).catch(() => {});
    });
  }

  function resync(s: SharePointSource) {
    setSyncing(s.id);
    start(async () => {
      const res = await syncSharePointSource(s.id);
      setSyncing(null);
      if (!res.ok) toast.error("Sync failed", { description: res.error });
      else toast.success("Synced", { description: res.summary });
      listSharePointSources().then(setSources).catch(() => {});
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

  const readable = preview?.ok ? preview.files.filter((f) => f.readable) : [];
  const unreadable = preview?.ok ? preview.files.filter((f) => !f.readable) : [];

  return (
    <section className="bg-card space-y-3 rounded-lg border p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FolderSync className="size-4" style={{ color: "var(--sol-orange-dark)" }} />
          From SharePoint
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Point at a folder and its documents become answers, cited by filename. Sync again after
          a policy changes and the answer changes with it.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sp-url" className="text-xs">Folder link</Label>
          <Input
            id="sp-url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setPreview(null); }}
            placeholder="https://contoso.sharepoint.com/sites/HR/Shared%20Documents/Policies"
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sp-who" className="text-xs">Read as</Label>
          <Input
            id="sp-who"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            placeholder="you@yourcompany.com"
            disabled={busy}
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">
            Whoever this is must have connected Microsoft 365. The folder is read with their access,
            so it reaches exactly what they can reach.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={look} disabled={busy || !url.trim()}>
          {busy && !preview ? <Loader2 className="size-4 animate-spin" /> : null} Show me what&apos;s in it
        </Button>
        {preview?.ok && readable.length > 0 && (
          <Button size="sm" onClick={connect} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-3.5" />}{" "}
            Index these {readable.length}
          </Button>
        )}
      </div>

      {preview?.ok && (
        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">{preview.label}</p>
          {readable.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-sm">
              Nothing readable in here. Word, PowerPoint, PDF, text, Markdown and spreadsheets work.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {readable.map((f) => (
                <li key={f.name} className="text-sm">{f.name}</li>
              ))}
            </ul>
          )}
          {unreadable.length > 0 && (
            <p className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              {unreadable.length} file{unreadable.length === 1 ? "" : "s"} will be skipped:{" "}
              {unreadable.slice(0, 4).map((f) => f.name).join(", ")}
              {unreadable.length > 4 ? "…" : ""}
            </p>
          )}
          {preview.folders > 0 && (
            <p className="text-muted-foreground mt-1 text-xs">
              {preview.folders} sub-folder{preview.folders === 1 ? "" : "s"} inside are not read.
            </p>
          )}
        </div>
      )}

      {sources.length > 0 && (
        <ul className="space-y-2 border-t pt-3">
          {sources.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{s.label || s.folderUrl}</p>
                <p className="text-muted-foreground text-xs">
                  {s.lastResult ?? "not synced yet"} &middot; last synced {fmt(s.lastSyncedAt)}
                  {s.connectedBy ? ` · as ${s.connectedBy}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => resync(s)} disabled={syncing === s.id}>
                  {syncing === s.id ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  Sync
                </Button>
                <Button size="icon" variant="ghost" onClick={() => remove(s)} aria-label="Disconnect">
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
