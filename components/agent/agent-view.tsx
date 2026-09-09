"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveAgentConfig, type Responder } from "@/app/(app)/agent/actions";
import { VoiceCard } from "@/components/agent/voice-card";
import { ModelPicker } from "@/components/agent/model-picker";
import { profileFor } from "@/lib/console-profile";
import { RespondersSection } from "./responders-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Bot, Loader2, Save } from "lucide-react";

type Section = { key: string; label: string; hint: string; essential?: boolean; saas?: { label?: string; hint?: string } };

// Big prompt areas — each maps to an agent_config key (the bot's source of truth).
const SECTIONS: Section[] = [
  { key: "personality", label: "Personality & tone", hint: "Who the assistant is and how it speaks — identity, warmth, style rules.", essential: true },
  { key: "store_prompt", label: "Store info", hint: "Address, hours, what you sell, anything about the store.", essential: true,
    saas: { label: "Product & company info", hint: "What your product does, key features, plans & pricing, and policies — anything the assistant should know to answer prospects and users." } },
  { key: "language_handling", label: "Language handling", hint: "Which languages to mirror, regional product-name mappings, how to handle mixed languages." },
  { key: "engage_info", label: "Behavior & engagement", hint: "How the assistant helps — navigation, escalation, feedback, interaction style, store layout. Tip: to trigger a connected tool, describe the situation (e.g. “when a customer asks about their order, look it up”) — not the tool name.",
    saas: { hint: "How the assistant helps — guiding users, when to escalate to a human, and interaction style. Tip: to trigger a connected tool or MCP, describe the situation (e.g. “when a customer asks about their invoice or usage, look it up and answer with their real data”) — the assistant maps it to the right tool." } },
  { key: "off_topic_handling", label: "Off-topic handling", hint: "How to gracefully redirect non-shopping questions.",
    saas: { hint: "How to gracefully redirect questions outside what your product covers." } },
];

export function AgentView({
  initialConfig,
  initialResponders,
  topics,
  storeName,
  businessType,
  initialModelProvider,
  initialModelName,
}: {
  initialConfig: Record<string, string>;
  initialResponders: Responder[];
  topics: { key: string; label: string }[];
  storeName: string;
  businessType?: string | null;
  initialModelProvider: string;
  initialModelName: string;
}) {
  const profile = profileFor(businessType);
  const [values, setValues] = useState<Record<string, string>>(initialConfig);
  const [saving, startSave] = useTransition();

  const dirty = useMemo(
    () => Object.keys(values).some((k) => (values[k] ?? "") !== (initialConfig[k] ?? "")),
    [values, initialConfig],
  );
  // Silence check-back is opt-out: absent/blank = on.
  const followupEnabled = (values.followup_enabled ?? "true") !== "false";

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function save() {
    startSave(async () => {
      const res = await saveAgentConfig(values);
      if (res.ok) toast.success("Agent settings saved");
      else toast.error("Couldn't save", { description: res.error });
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bot className="text-muted-foreground size-5" />
          <div>
            <h1 className="font-display text-2xl">Agent</h1>
            <p className="text-muted-foreground text-sm">{storeName}</p>
          </div>
        </div>
        <Button onClick={save} disabled={saving || !dirty} size="sm">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save changes
        </Button>
      </header>

      <p className="text-muted-foreground text-sm">
        This is the assistant&apos;s setup for {storeName}. Everything here is the source of
        truth for how the bot behaves — no code changes needed. Core safety rules
        (never invent a price, always confirm before placing an order) are always
        enforced on top of what you write.
      </p>

      <ModelPicker initialProvider={initialModelProvider} initialModel={initialModelName} />

      {/* Premium diner voice — self-contained (loads + saves on its own). */}
      <VoiceCard />

      {/* Silence check-back */}
      <div className="bg-card flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-0.5">
          <Label htmlFor="followup-toggle" className="text-sm font-medium">Check back if a chat goes quiet</Label>
          <p className="text-muted-foreground text-sm">
            If a customer stops replying mid-chat, the assistant sends one gentle check-back
            after a few minutes. It skips it when the chat already wrapped up (a
            goodbye or a finished request).
          </p>
        </div>
        <Switch
          id="followup-toggle"
          checked={followupEnabled}
          onCheckedChange={(c) => set("followup_enabled", c ? "true" : "false")}
        />
      </div>

      {/* Prompt sections — essentials first, then optional fine-tuning. */}
      {(() => {
        const renderSection = (s: Section, rows: number) => {
          const label = (profile === "saas" && s.saas?.label) || s.label;
          const hint = (profile === "saas" && s.saas?.hint) || s.hint;
          return (
            <div key={s.key} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor={`sec-${s.key}`} className="text-sm font-medium">{label}</Label>
                {!s.essential && (
                  <span className="text-muted-foreground text-[10px] uppercase tracking-wide">optional</span>
                )}
              </div>
              <p className="text-muted-foreground text-xs">{hint}</p>
              <Textarea
                id={`sec-${s.key}`}
                value={values[s.key] ?? ""}
                onChange={(e) => set(s.key, e.target.value)}
                rows={rows}
                className="font-mono text-sm"
                placeholder={`Write ${label.toLowerCase()} instructions…`}
              />
            </div>
          );
        };
        return (
          <>
            <div>
              <h2 className="text-sm font-medium">The essentials</h2>
              <p className="text-muted-foreground text-xs">
                The assistant needs these to represent {storeName} well. Everything below is optional fine-tuning.
              </p>
            </div>
            <div className="space-y-5">{SECTIONS.filter((s) => s.essential).map((s) => renderSection(s, 8))}</div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Fine-tuning</span>
              <span className="bg-border h-px flex-1" />
            </div>
            <div className="space-y-5">{SECTIONS.filter((s) => !s.essential).map((s) => renderSection(s, 6))}</div>
          </>
        );
      })()}

      {/* Settings */}
      <div className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">Settings</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="history_turns">History turns</Label>
            <Input
              id="history_turns"
              value={values.history_turns ?? ""}
              onChange={(e) => set("history_turns", e.target.value)}
              placeholder="10"
              inputMode="numeric"
            />
            <p className="text-muted-foreground text-xs">How many prior turns the assistant remembers in a chat.</p>
          </div>
          {followupEnabled && (
            <div className="space-y-1.5">
              <Label htmlFor="followup_minutes">Check-back delay (minutes)</Label>
              <Input
                id="followup_minutes"
                value={values.followup_minutes ?? ""}
                onChange={(e) => set("followup_minutes", e.target.value)}
                placeholder="5"
                inputMode="numeric"
              />
              <p className="text-muted-foreground text-xs">How long to wait after silence before checking back (1–180).</p>
            </div>
          )}
        </div>
      </div>


      <RespondersSection initial={initialResponders} topics={topics} />
    </div>
  );
}
