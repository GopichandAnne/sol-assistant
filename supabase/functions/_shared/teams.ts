// Microsoft Teams front door — the pure, testable core (Bot Framework activity shape).
// The edge function (teams-messages) is a thin shell: verify the BF token, classify,
// resolve identity, run the core, post the reply.
import type { RawIdentity } from "./identity.ts";

export interface TeamsInbound {
  text: string;
  aadObjectId: string; // the user's Azure AD object id (stable) — the identity anchor
  userId: string; // Bot Framework from.id
  name: string;
  serviceUrl: string;
  conversationId: string;
  tenantId: string;
  activityId?: string;
  /** True for a channel or group chat, false for a 1:1. Only group conversations
   *  are routable: a DM is between one person and the organisation. */
  isGroup: boolean;
  /** The channel's display name when Teams provides one, for the routing picker. */
  channelName: string | null;
}

/** Decide whether a Bot Framework activity is a user message we should answer, and
 *  extract the normalized inbound. (Bot Framework doesn't echo the bot's own
 *  messages, so no loop guard is needed — unlike Slack.) */
// deno-lint-ignore no-explicit-any
export function classifyActivity(a: any): { act: boolean; reason: string; event?: TeamsInbound } {
  if (!a || typeof a !== "object") return { act: false, reason: "no activity" };
  if (a.type !== "message") return { act: false, reason: `type=${a.type}` };
  const text = String(a.text ?? "").replace(/<at>.*?<\/at>/g, "").trim(); // strip @mention chips
  const from = a.from ?? {};
  const aadObjectId = String(from.aadObjectId ?? "");
  const userId = String(from.id ?? "");
  const conversationId = String(a.conversation?.id ?? "");
  const serviceUrl = String(a.serviceUrl ?? "");
  if (!text || !userId || !conversationId || !serviceUrl) return { act: false, reason: "missing text/from/conversation/serviceUrl" };
  return {
    act: true,
    reason: "ok",
    event: {
      text,
      aadObjectId,
      userId,
      name: String(from.name ?? ""),
      serviceUrl,
      conversationId,
      tenantId: String(a.channelData?.tenant?.id ?? a.conversation?.tenantId ?? ""),
      activityId: a.id ? String(a.id) : undefined,
      // conversationType is "personal" for a 1:1, "channel"/"groupChat" otherwise.
      isGroup: String(a.conversation?.conversationType ?? "personal") !== "personal",
      channelName: a.channelData?.team?.name
        ? String(a.channelData.team.name) + (a.channelData?.channel?.name ? ` / ${a.channelData.channel.name}` : "")
        : (a.channelData?.channel?.name ? String(a.channelData.channel.name) : null),
    },
  };
}

/** Stable per-user session key for a Teams tenant (aadObjectId is stable across chats). */
export function teamsSessionId(tenantId: string, aadObjectId: string, userId: string): string {
  return `teams_${tenantId}_${aadObjectId || userId}`;
}

/** Azure AD already authenticated this user — email (via Graph) is the join key, the
 *  aadObjectId is the stable sub. */
export function buildTeamsRawIdentity(aadObjectId: string, userId: string, name?: string | null, email?: string | null): RawIdentity {
  return { email: email ?? null, phone: null, name: name ?? null, sub: aadObjectId || userId, rawToken: null };
}

/** Approve / Decline as an Adaptive Card. Mirrors slack.ts buildApprovalBlocks so
 *  both channels say the same thing: what was asked, who it was acting as, and
 *  that nothing has happened yet. Action.Submit posts `data` straight back to the
 *  bot as activity.value, which teams-messages routes to the approval handler. */
export function buildApprovalCard(req: { id: string; detail: string; orgName: string; actedAs: string | null }) {
  const facts = [{ title: "Account", value: req.orgName }];
  if (req.actedAs) facts.push({ title: "Acting as", value: req.actedAs });
  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        body: [
          { type: "TextBlock", text: "Approval needed", weight: "Bolder", size: "Medium", wrap: true },
          { type: "TextBlock", text: req.detail, wrap: true },
          { type: "FactSet", facts },
          { type: "TextBlock", text: "Nothing has happened yet. Approving records your decision; complete the action in your systems as usual.", wrap: true, isSubtle: true, size: "Small" },
        ],
        actions: [
          { type: "Action.Submit", title: "Approve", data: { kind: "approval", id: req.id, decision: "approved" } },
          { type: "Action.Submit", title: "Decline", data: { kind: "approval", id: req.id, decision: "declined" } },
        ],
      },
    }],
  };
}
