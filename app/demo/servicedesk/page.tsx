import type { Metadata } from "next";
import { listTickets } from "@/lib/demo/service-desk";

/**
 * The client's service desk, on a screen.
 *
 * The demo's strongest beat is a ticket raised in Teams appearing in the system
 * it belongs to. That needs somewhere to look, and "trust me, it is in the
 * database" is not somewhere to look. Deliberately styled as somebody else's
 * product rather than ours: it is standing in for their ServiceNow, and if it
 * carries Sol's branding the illusion does the opposite of its job.
 *
 * Read-only and unauthenticated by design. It shows a queue of invented tickets
 * for fictional people at northwind.example; there is nothing here to protect,
 * and a login screen in the middle of a demo is a fumble waiting to happen.
 */
export const metadata: Metadata = { title: "Service Desk — Northwind" };
export const dynamic = "force-dynamic";

const TONE: Record<string, { bg: string; fg: string }> = {
  Open: { bg: "#FDEBE3", fg: "#9C3F13" },
  "In progress": { bg: "#E3EEFD", fg: "#1B4C8C" },
  Waiting: { bg: "#FBF1D8", fg: "#7A5B11" },
  Resolved: { bg: "#E1F0EA", fg: "#1F6250" },
  Closed: { bg: "#ECEDEE", fg: "#5A6066" },
};

function ago(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default async function ServiceDeskPage() {
  const tickets = await listTickets({ limit: 40 });
  const open = tickets.filter((t) => t.status === "Open").length;
  const active = tickets.filter((t) => t.status === "In progress").length;

  return (
    <main style={{ minHeight: "100vh", background: "#F4F5F7", color: "#1E2226", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
      <div style={{ background: "#1E2A38", color: "#fff", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 24, height: 24, borderRadius: 5, background: "#3E9BD6", display: "inline-block" }} />
        <strong style={{ fontSize: 15, letterSpacing: "-0.01em" }}>Northwind Service Desk</strong>
        <span style={{ fontSize: 12, opacity: 0.65, marginLeft: "auto" }}>Incident queue</span>
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "26px 20px 64px" }}>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 22, fontSize: 13, color: "#5A6066" }}>
          <span><strong style={{ color: "#1E2226", fontSize: 20, fontVariantNumeric: "tabular-nums" }}>{open}</strong> open</span>
          <span><strong style={{ color: "#1E2226", fontSize: 20, fontVariantNumeric: "tabular-nums" }}>{active}</strong> in progress</span>
          <span><strong style={{ color: "#1E2226", fontSize: 20, fontVariantNumeric: "tabular-nums" }}>{tickets.length}</strong> total</span>
        </div>

        <div style={{ background: "#fff", border: "1px solid #E1E3E6", borderRadius: 8, overflow: "hidden" }}>
          {tickets.length === 0 && (
            <p style={{ padding: 24, margin: 0, color: "#5A6066", fontSize: 14 }}>
              The queue is empty. Apply the demo migration to seed it.
            </p>
          )}
          {tickets.map((t, i) => {
            const tone = TONE[t.status] ?? TONE.Closed;
            return (
              <div
                key={t.ref}
                style={{
                  display: "grid",
                  gridTemplateColumns: "96px 1fr auto",
                  gap: 14,
                  alignItems: "start",
                  padding: "14px 18px",
                  borderTop: i === 0 ? "none" : "1px solid #EDEEF0",
                }}
              >
                <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, color: "#3E6FA8", paddingTop: 2 }}>{t.ref}</code>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 500 }}>{t.title}</div>
                  <div style={{ fontSize: 12.5, color: "#6B7176", marginTop: 3 }}>
                    {t.category} &middot; {t.priority}
                    {t.requester ? ` · raised by ${t.requester.split("@")[0].replace(".", " ")}` : ""}
                    {t.assignee ? ` · with ${t.assignee.split("@")[0].replace(".", " ")}` : " · unassigned"}
                  </div>
                  {t.description && (
                    <div style={{ fontSize: 12.5, color: "#7A8085", marginTop: 5, whiteSpace: "pre-wrap" }}>
                      {t.description.length > 220 ? `${t.description.slice(0, 220)}…` : t.description}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <span style={{ background: tone.bg, color: tone.fg, fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 999 }}>
                    {t.status}
                  </span>
                  <div style={{ fontSize: 11.5, color: "#8A9095", marginTop: 5 }}>{ago(t.created_at)}</div>
                </div>
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: 12, color: "#8A9095", marginTop: 18 }}>
          Demonstration system. Tickets and people here are invented.
        </p>
      </div>
    </main>
  );
}
