"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { createMyStore } from "./actions";
import { useVoiceInput } from "@/lib/useVoiceInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mic, Send } from "lucide-react";

type Msg = { role: "owner" | "rani"; text: string };
interface Config {
  assistantName?: string;
  job?: string;
  channel?: "teams" | "slack" | "web";
  systems?: { name?: string; why?: string }[];
  approvals?: string[];
  serves?: string;
  personality?: string;
  assistantPrompt?: string;
  greeting?: string;
  suggestionChips?: string[];
}

/**
 * The setup conversation. It agrees a PLAN rather than finishing setup: what this
 * assistant is for, where it lives, which systems that implies, and what must never
 * happen without a person. Most of that cannot be completed in a chat anyway, since
 * connecting a system usually needs credentials or an admin. The console turns the
 * plan into a checklist the owner works through afterwards, in any order.
 */
export function WelcomeChat({ email }: { email: string | null }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chips, setChips] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const supabase = createClient();

  async function turn(next: Msg[]) {
    setBusy(true);
    setChips([]);
    const { data, error } = await supabase.functions.invoke("setup-interview", { body: { messages: next, email } });
    if (error || !data?.reply) {
      setBusy(false);
      toast.error("The assistant had trouble responding", { description: "Please try again." });
      return;
    }
    const withReply: Msg[] = [...next, { role: "rani", text: data.reply as string }];
    setMessages(withReply);

    if (data.done && data.config) {
      await provision(data.config as Config);
    } else {
      setChips(Array.isArray(data.chips) ? data.chips : []);
      setBusy(false);
    }
  }

  async function provision(config: Config) {
    setProvisioning(true);
    const res = await createMyStore({
      businessName: String(config.assistantName ?? "My assistant"),
      email: email || undefined,
      agent: {
        personality: config.personality || undefined,
        storePrompt: config.assistantPrompt || undefined,
        greeting: config.greeting || undefined,
        suggestionChips: Array.isArray(config.suggestionChips) ? config.suggestionChips : undefined,
      },
      // The plan the conversation agreed. Drives the checklist, not the engine.
      setup: {
        job: config.job || undefined,
        channel: config.channel || undefined,
        systems: Array.isArray(config.systems)
          ? config.systems.map((x) => ({ name: String(x?.name ?? ""), why: String(x?.why ?? "") })).filter((x) => x.name)
          : undefined,
        approvals: Array.isArray(config.approvals) ? config.approvals.map(String).filter(Boolean) : undefined,
        serves: config.serves || undefined,
      },
    });
    if (!res.ok) {
      setProvisioning(false);
      setBusy(false);
      toast.error("Couldn't finish setup", { description: res.error });
      return;
    }
    window.location.assign("/"); // full nav so the new active-store cookie + staff link are read
  }

  // Kick off the interview (first question) once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void turn([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, chips, busy]);

  function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    void turn([...messages, { role: "owner", text: t }]);
  }

  // Voice input: on-device Web Speech API where available, else record + Whisper
  // (the transcribe edge function) so voice works on every device.
  const { listening, busy: transcribing, toggle: startVoice } = useVoiceInput(
    async (blob) => {
      const fd = new FormData();
      fd.append("file", blob, (blob as File).name || "speech.webm");
      const { data } = await supabase.functions.invoke("transcribe", { body: fd });
      return (data as { text?: string } | null)?.text ?? "";
    },
    (t) => setInput((prev) => (prev ? `${prev} ${t}` : t)),
  );

  return (
    <div className="flex h-[460px] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-1 py-2">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "owner" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "owner"
                  ? "bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm"
                  : "bg-muted text-foreground max-w-[85%] rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm"
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        {(busy || provisioning) && (
          <div className="flex justify-start">
            <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm">
              <Loader2 className="size-3.5 animate-spin" />
              {provisioning ? "Setting up your assistant…" : "Typing…"}
            </div>
          </div>
        )}
      </div>

      {chips.length > 0 && !busy && (
        <div className="flex flex-wrap gap-2 px-1 pb-2">
          {chips.map((c, i) => (
            <button
              key={i}
              onClick={() => send(c)}
              className="border-input hover:bg-accent rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="flex items-center gap-2 border-t pt-3"
      >
        <Button
          type="button"
          size="icon"
          variant={listening ? "default" : "outline"}
          onClick={startVoice}
          disabled={busy || provisioning || transcribing}
          title={listening ? "Tap to stop" : "Speak your answer"}
        >
          {transcribing ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
        </Button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "Listening… tap the mic to stop" : transcribing ? "Transcribing…" : "Type or tap the mic to speak…"}
          disabled={busy || provisioning}
        />
        <Button type="submit" size="icon" disabled={busy || provisioning || !input.trim()}>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
