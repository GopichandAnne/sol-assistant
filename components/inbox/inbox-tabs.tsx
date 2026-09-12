"use client";

import { useState } from "react";
import Link from "next/link";
import { TicketsView } from "@/components/tickets/tickets-view";
import { RequestsView } from "@/components/requests/requests-view";
import type { Ticket } from "@/lib/tickets/types";
import type { CapturedRequest, RequestType } from "@/app/(app)/requests/actions";

/** One roof for the two "needs attention" surfaces: Questions (tickets the assistant
 *  couldn't answer) and Requests (structured captures). Each tab renders its own
 *  existing view; Requests is owner-only. */
export function InboxTabs({
  tickets,
  requests,
  types,
  storeName,
  storeSlug,
  isOwner,
  openTickets,
  newRequests,
}: {
  tickets: Ticket[];
  requests: CapturedRequest[];
  types: RequestType[];
  storeName: string;
  storeSlug: string;
  isOwner: boolean;
  openTickets: number;
  newRequests: number;
}) {
  const [tab, setTab] = useState<"questions" | "requests">("questions");

  function Pill({ id, label, count }: { id: "questions" | "requests"; label: string; count: number }) {
    const active = tab === id;
    return (
      <button
        onClick={() => setTab(id)}
        className={
          "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors " +
          (active ? "bg-gradient-primary text-primary-foreground shadow-primary" : "text-muted-foreground hover:bg-muted")
        }
      >
        {label}
        {count > 0 && (
          <span
            className={
              "rounded-full px-1.5 py-0 text-[10px] font-semibold " +
              (active ? "bg-white/25 text-white" : "bg-teal text-white")
            }
          >
            {count}
          </span>
        )}
      </button>
    );
  }

  return (
    <div>
      <header className="px-6 pt-5">
        <h1 className="font-display text-2xl">Inbox</h1>
        <p className="text-muted-foreground text-sm">
          {storeName} — only what needs a person: questions the assistant couldn&apos;t answer, and
          requests it captured. Everything said, answered or not, is in{" "}
          <Link href="/conversations" className="underline underline-offset-2">Conversations</Link>.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 px-6 pt-4">
        <Pill id="questions" label="Questions" count={openTickets} />
        {isOwner && <Pill id="requests" label="Requests" count={newRequests} />}
      </div>

      {tab === "questions" ? (
        <TicketsView initialTickets={tickets} storeName={storeName} storeSlug={storeSlug} />
      ) : (
        <RequestsView requests={requests} types={types} storeName={storeName} />
      )}
    </div>
  );
}
