"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import type { Ticket, TicketStatus } from "@/lib/tickets/types";
import { TICKET_STATUSES, TICKET_STATUS_LABEL } from "@/lib/tickets/types";
import { answerTicket } from "@/app/(app)/tickets/actions";
import { TicketStatusChip } from "./ticket-status-chip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BookmarkCheck, LifeBuoy, Loader2, MessagesSquare, Search, Send } from "lucide-react";

export function TicketsView({
  initialTickets,
  storeName,
  storeSlug,
}: {
  initialTickets: Ticket[];
  storeName: string;
  /** Needed to rebuild the thread id a question came from — see TicketCard. */
  storeSlug: string;
}) {
  const [status, setStatus] = useState<TicketStatus | "all">("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c = Object.fromEntries(
      TICKET_STATUSES.map((s) => [s, 0]),
    ) as Record<TicketStatus, number>;
    for (const t of initialTickets) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [initialTickets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initialTickets.filter((t) => {
      if (status !== "all" && t.status !== status) return false;
      if (q) {
        const hay =
          `${t.ticket_id} ${t.customer_name ?? ""} ${t.customer_phone ?? ""} ${t.question ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [initialTickets, status, query]);

  const tabs: { key: TicketStatus | "all"; label: string; count: number }[] = [
    { key: "all", label: "All", count: initialTickets.length },
    ...TICKET_STATUSES.map((s) => ({
      key: s,
      label: TICKET_STATUS_LABEL[s],
      count: counts[s],
    })),
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <header>
        <h1 className="font-display text-2xl">Questions</h1>
        <p className="text-muted-foreground text-sm">
          {storeName} · questions the assistant couldn&apos;t answer. Reply here and the assistant sends your answer
          to the customer (WhatsApp or web) — no WhatsApp needed on your end.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        {tabs.map((t) => {
          const activeTab = status === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatus(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                activeTab
                  ? "border-transparent bg-gradient-primary text-white shadow-primary"
                  : "text-muted-foreground hover:border-teal/40 hover:text-foreground",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded-full px-1 text-[10px] tabular-nums",
                  activeTab ? "bg-white/20" : "bg-muted",
                )}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ticket #, person, or question"
          className="pl-8"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <LifeBuoy className="text-muted-foreground size-6" />
          <p className="text-sm font-medium">
            {initialTickets.length === 0
              ? "No tickets yet"
              : "No tickets match"}
          </p>
          <p className="text-muted-foreground max-w-sm text-sm">
            {initialTickets.length === 0
              ? `Escalation tickets for ${storeName} appear here.`
              : "Try a different status or search."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((t) => (
            <TicketCard key={t.ticket_id} ticket={t} storeSlug={storeSlug} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TicketCard({ ticket, storeSlug }: { ticket: Ticket; storeSlug: string }) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [sending, startSend] = useTransition();
  const customer =
    ticket.customer_name?.trim() || ticket.customer_phone || "Unknown";
  const isOpen = ticket.status === "created" || ticket.status === "sent_to_owner";

  function send() {
    const a = answer.trim();
    if (!a) return;
    startSend(async () => {
      const res = await answerTicket(ticket.ticket_id, a);
      if (res.ok) {
        // Say where it actually went. "Sent" reads as delivered, and for a web
        // chat that has since been closed it is picked up next time they open it.
        toast.success(res.relayed ? "Sent back to them" : "Answered", {
          description: res.relayed
            ? undefined
            : "They'll see it in the chat where they asked.",
        });
        setAnswer("");
        router.refresh();
      } else {
        toast.error("Couldn't send", { description: res.error });
      }
    });
  }

  return (
    <li className="bg-card rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-sm font-medium">
            {ticket.ticket_id}
          </span>
          {ticket.saved_to_kb && (
            <Badge
              variant="outline"
              className="text-teal-deep dark:text-teal-light gap-1"
            >
              <BookmarkCheck className="size-3" /> Saved to KB
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TicketStatusChip status={ticket.status} />
          {ticket.created_at && (
            <span className="text-muted-foreground text-xs">
              {formatRelative(ticket.created_at)}
            </span>
          )}
        </div>
      </div>

      <p className="text-muted-foreground mt-1 text-xs">{customer}</p>
      {ticket.question && (
        <p className="mt-2 whitespace-pre-wrap text-sm">{ticket.question}</p>
      )}

      {/* A question is an excerpt of a conversation, and answering it well usually
          needs what was said around it. Thread ids are `thr_<session>_<slug>`,
          which is why the slug is passed down. */}
      {ticket.session_id && (
        <Link
          href={`/conversations?thread=${encodeURIComponent(`thr_${ticket.session_id}_${storeSlug}`)}`}
          className="text-muted-foreground hover:text-foreground mt-2 inline-flex items-center gap-1 text-xs underline underline-offset-2"
        >
          <MessagesSquare className="size-3" /> Open the conversation
        </Link>
      )}

      {ticket.answer && (
        <div className="bg-muted/50 mt-3 rounded-md border-l-2 border-teal/50 p-3">
          <p className="whitespace-pre-wrap text-sm">{ticket.answer}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            answered{ticket.answered_by ? ` by ${ticket.answered_by}` : ""}
            {ticket.answered_at ? ` · ${formatDateTime(ticket.answered_at)}` : ""}
          </p>
        </div>
      )}

      {isOpen && (
        <div className="mt-3 space-y-2">
          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={2}
            placeholder="Type your answer — the assistant sends it to them as you…"
            disabled={sending}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={send} disabled={sending || !answer.trim()}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send answer
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
