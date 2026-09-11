// Which assistant answers, in a chat channel.
//
// One organisation installs the bot once and can then run several assistants
// behind that single presence: an HR one in the HR channel, an IT one in the IT
// channel. The routing signal is the CHANNEL, never the content of the question.
//
// That choice is the whole design. Reading the question to pick an assistant puts
// a classifier between a person and their answer, and makes that classifier the
// only thing standing between private HR knowledge and an IT answer. Keying on the
// channel makes the assistant boundary and the knowledge boundary the same object.
// People already ask HR questions in the HR channel; there is nothing left to
// misjudge.
//
// Resolution: an explicit route for this channel, else the workspace default that
// was set when the org connected. A direct message always takes the default, since
// a DM is between one person and the organisation, not a place anyone would route.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { untyped } from "./untyped.ts";

export type ChannelKind = "teams" | "slack";

/** The assistant that should answer here, or null when the workspace is unknown. */
export async function resolveStoreForChannel(
  db: SupabaseClient,
  kind: ChannelKind,
  workspaceId: string,
  channelId: string,
  workspaceDefault: string | null,
): Promise<string | null> {
  if (!workspaceId) return workspaceDefault;
  try {
    const from = untyped(db);
    const { data } = await from("channel_route")
      .select("store_id")
      .eq("channel_kind", kind)
      .eq("workspace_id", workspaceId)
      .eq("channel_id", channelId)
      .maybeSingle();
    if (data?.store_id) return data.store_id as string;
  } catch (e) {
    // A routing lookup must never take the assistant down. Falling back to the
    // workspace default answers with the wrong assistant at worst, which is
    // recoverable; failing to answer at all is not.
    console.warn(`[routing] lookup failed, using workspace default: ${(e as Error)?.message ?? e}`);
  }
  return workspaceDefault;
}

/**
 * Remember a group channel we have seen, so the console can offer its real name
 * to route rather than asking someone to paste an opaque id.
 *
 * Group conversations only. Recording every direct message would fill the picker
 * with one entry per employee, none of which anyone would ever route.
 */
export async function rememberChannel(
  db: SupabaseClient,
  kind: ChannelKind,
  workspaceId: string,
  channelId: string,
  name: string | null,
  isGroup: boolean,
): Promise<void> {
  if (!isGroup || !workspaceId || !channelId) return;
  try {
    const from = untyped(db);
    await from("channel_seen").upsert({
      channel_kind: kind,
      workspace_id: workspaceId,
      channel_id: channelId,
      name,
      last_seen: new Date().toISOString(),
    }, { onConflict: "channel_kind,workspace_id,channel_id" });
  } catch (e) {
    console.warn(`[routing] remember channel: ${(e as Error)?.message ?? e}`);
  }
}
