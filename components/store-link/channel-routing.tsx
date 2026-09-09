"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Hash } from "lucide-react";
import {
  listRoutableAssistants,
  listSeenChannels,
  routeChannel,
  type ChannelKind,
  type RoutableAssistant,
  type SeenChannel,
} from "@/app/(app)/link/routing-actions";

/**
 * Send a channel to a different assistant.
 *
 * Only appears once the workspace has channels we have actually seen, and only
 * when the account has more than one assistant to choose between. An org running
 * a single assistant never needs this and is never shown it.
 */
export function ChannelRouting({
  storeId,
  kind,
  workspaceId,
}: {
  storeId: string;
  kind: ChannelKind;
  workspaceId: string;
}) {
  const [channels, setChannels] = useState<SeenChannel[] | null>(null);
  const [assistants, setAssistants] = useState<RoutableAssistant[]>([]);
  const [, start] = useTransition();

  useEffect(() => {
    if (!workspaceId) return;
    Promise.all([listSeenChannels(storeId, kind, workspaceId), listRoutableAssistants(storeId)])
      .then(([c, a]) => { setChannels(c); setAssistants(a); })
      .catch(() => setChannels([]));
  }, [storeId, kind, workspaceId]);

  // Nothing to decide with one assistant, and nothing to route before any channel
  // has been used. Either way this is noise, so it stays hidden.
  if (!channels || channels.length === 0 || assistants.length < 2) return null;

  function set(channelId: string, value: string) {
    const target = value === "__default__" ? null : value;
    setChannels((prev) => prev?.map((c) => (c.channelId === channelId ? { ...c, routedStoreId: target } : c)) ?? null);
    start(async () => {
      const res = await routeChannel(storeId, kind, workspaceId, channelId, target);
      if (res.ok) toast.success(target ? "Channel routed" : "Back to the default assistant");
      else {
        toast.error("Couldn't change that", { description: res.error });
        listSeenChannels(storeId, kind, workspaceId).then(setChannels).catch(() => {});
      }
    });
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-xs font-medium">Which assistant answers where</p>
      <p className="text-muted-foreground text-xs">
        Every channel uses your default assistant unless you change it here. Direct
        messages always use the default.
      </p>
      <ul className="space-y-2">
        {channels.map((c) => (
          <li key={c.channelId} className="flex items-center gap-2">
            <Hash className="text-muted-foreground size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm">
              {c.name ?? <span className="font-mono text-xs">{c.channelId}</span>}
            </span>
            <select
              className="bg-background h-8 max-w-48 rounded-md border px-2 text-sm"
              value={c.routedStoreId ?? "__default__"}
              onChange={(e) => set(c.channelId, e.target.value)}
              aria-label={`Assistant for ${c.name ?? c.channelId}`}
            >
              <option value="__default__">Default assistant</option>
              {assistants.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}
