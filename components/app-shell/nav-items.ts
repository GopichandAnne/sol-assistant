import {
  BookOpen,
  CalendarClock,
  Bot,
  Building2,
  ClipboardList,
  Coins,
  HelpCircle,
  Home,
  Inbox,
  KeyRound,
  MessagesSquare,
  ScrollText,
  Share2,
  Store,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ConsoleProfile } from "@/lib/console-profile";

/** The four jobs an operator comes here to do, plus the two utility groups. The
 *  heading is what tells someone which half of the product they are in, so a page
 *  that doesn't obviously belong to one of these probably doesn't belong at all. */
export type NavGroup = "Watch" | "Teach" | "Connect" | "Govern" | "Help" | "Admin";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** The section it sits under. Rendered as a heading above the first item of each. */
  group: NavGroup;
  /** false = planned but not built yet (shown disabled with a "Soon" chip). */
  available: boolean;
  /** owner/platform-admin only. */
  ownerOnly?: boolean;
  /** platform-admin (super admin) only — store-agnostic tools. */
  platformAdminOnly?: boolean;
  /** when set, the label is taken from the store's vertical vocabulary. */
  vocabKey?: "catalogNav";
  /** when set, shown only for these stores.business_type values. */
  businessTypes?: string[];
  /** when set, shown only for these console profiles (local | saas). Absent = all. */
  profiles?: ConsoleProfile[];
  /** optional per-profile label override. */
  labelByProfile?: Partial<Record<ConsoleProfile, string>>;
  /** an opt-in module: shown for capability-driven profiles (saas) only when the
   *  store has this agent_config flag on. Local profiles always show it. */
  capability?: "orders" | "catalog";
};

/**
 * Information architecture for the panel.
 *
 * Grouped by what the operator is trying to DO, not by what the data model calls
 * things. Two rules hold it together, and both were learned by breaking them:
 *
 *   • One job per entry. Home and Dashboard used to show the same conversation
 *     count and the same sentiment split, so an owner had to open both to learn
 *     which was authoritative. Dashboard is gone; Home is the answer.
 *   • The label says what the page does, in the words the operator would use.
 *     "Agent" and "Copilot" both described the assistant in a product literally
 *     called The Assistant, and neither told you which one configured it.
 */
export const NAV_ITEMS: NavItem[] = [
  // ── Watch: what is happening ──
  { label: "Home", href: "/health", icon: Home, group: "Watch", available: true, profiles: ["saas"] },
  { label: "Inbox", href: "/inbox", icon: Inbox, group: "Watch", available: true },
  { label: "Conversations", href: "/conversations", icon: MessagesSquare, group: "Watch", available: true },
  { label: "What it did", href: "/activity", icon: ScrollText, group: "Watch", available: true, ownerOnly: true },

  // ── Teach: what it knows and how it behaves ──
  { label: "Knowledge", href: "/knowledge", icon: BookOpen, group: "Teach", available: true },
  { label: "How it answers", href: "/agent", icon: Bot, group: "Teach", available: true, ownerOnly: true },
  { label: "Scheduled work", href: "/scheduled", icon: CalendarClock, group: "Teach", available: true, ownerOnly: true },

  // ── Connect: where people reach it, and what it can reach ──
  { label: "Channels", href: "/link", icon: Share2, group: "Connect", available: true, ownerOnly: true },
  { label: "Tools & systems", href: "/connections", icon: Wrench, group: "Connect", available: true, ownerOnly: true },

  // ── Govern: people and money ──
  { label: "Your team", href: "/team", icon: Users, group: "Govern", available: true, ownerOnly: true },
  { label: "Who can use it", href: "/members", icon: KeyRound, group: "Govern", available: true, ownerOnly: true },
  { label: "Credits", href: "/billing", icon: Coins, group: "Govern", available: true, ownerOnly: true },

  // ── Help ──
  { label: "Help & setup", href: "/assistant", icon: HelpCircle, group: "Help", available: true },

  // ── Platform admin (super admin) — store-agnostic ──
  { label: "Accounts", href: "/admin/companies", icon: Building2, group: "Admin", available: true, platformAdminOnly: true },
  { label: "Assistants", href: "/admin/stores", icon: Store, group: "Admin", available: true, platformAdminOnly: true },
  { label: "Waitlist", href: "/admin/waitlist", icon: ClipboardList, group: "Admin", available: true, platformAdminOnly: true },
];
