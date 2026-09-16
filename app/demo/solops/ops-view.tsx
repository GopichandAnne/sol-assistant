"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type OpsDataset = {
  key: "bench" | "engagements" | "compliance" | "timesheets";
  label: string;
  columns: string[];
  rows: { ref: string; cells: string[]; changedAt: string }[];
};

/** How often the page asks the server for the current rows. Short enough that an
 *  approved change appears while the room is still looking; long enough not to
 *  matter to anything else. */
const REFRESH_MS = 4000;
/** How long a changed row stays lit after it is first seen. */
const FLASH_MS = 9000;
/** A row touched this recently says so, even after a reload or a tab switch. */
const RECENT_MS = 20 * 60 * 1000;

const NUMERIC = new Set(["Fee", "Margin Target", "Margin Actual", "Hours Billable", "Hours Non Billable"]);

function pillTone(column: string, value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (column === "Submitted" || column === "Approved") return v === "yes" ? "good" : "attention";
  if (column === "Status") {
    if (v === "in place" || v === "closed") return v === "closed" ? "quiet" : "good";
    if (v === "pending") return "attention";
    return "info";
  }
  return null;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} hr ago`;
}

function display(column: string, value: string): string {
  if (column === "Fee" && /^\d+$/.test(value)) return Number(value).toLocaleString("en-US");
  return value;
}

export function OpsView({ datasets, renderedAt }: { datasets: OpsDataset[]; renderedAt: string }) {
  const router = useRouter();
  const [active, setActive] = useState<OpsDataset["key"]>("bench");
  const [now, setNow] = useState(() => Date.now());
  const [flash, setFlash] = useState<Record<string, number>>({});
  const seen = useRef<Map<string, string> | null>(null);

  // Remember the tab across reloads, so a presenter who refreshes lands where
  // they were rather than back on the bench.
  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    if (datasets.some((d) => d.key === h)) setActive(h as OpsDataset["key"]);
  }, [datasets]);

  function choose(key: OpsDataset["key"]) {
    setActive(key);
    window.history.replaceState(null, "", `#${key}`);
  }

  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [router]);

  // Compare every refresh with the last one. Anything new or different lights up.
  // The first render sets the baseline and lights nothing, otherwise opening the
  // page would flash every row.
  useEffect(() => {
    const next = new Map<string, string>();
    for (const d of datasets) for (const r of d.rows) next.set(`${d.key}:${r.ref}`, r.cells.join("␟"));
    const before = seen.current;
    if (before) {
      const changed = [...next.entries()].filter(([k, sig]) => before.get(k) !== sig).map(([k]) => k);
      if (changed.length > 0) {
        const at = Date.now();
        setFlash((f) => ({ ...f, ...Object.fromEntries(changed.map((k) => [k, at])) }));
      }
    }
    seen.current = next;
  }, [datasets]);

  const lit = useMemo(
    () => new Set(Object.entries(flash).filter(([, at]) => now - at < FLASH_MS).map(([k]) => k)),
    [flash, now],
  );

  const current = datasets.find((d) => d.key === active) ?? datasets[0];
  const sinceRender = now - new Date(renderedAt).getTime();

  return (
    <main className="ops">
      <style>{CSS}</style>

      <header className="ops-bar">
        <span className="ops-mark" aria-hidden="true" />
        <strong>Sol Operations</strong>
        <span className="ops-live" title="This page refreshes itself">
          <span className="ops-dot" aria-hidden="true" /> Live &middot; {ago(Math.max(sinceRender, 0))}
        </span>
      </header>

      <div className="ops-wrap">
        <div className="ops-toolbar">
          <div className="ops-tabs" role="tablist" aria-label="Records">
            {datasets.map((d) => {
              const pending = d.rows.filter((r) => lit.has(`${d.key}:${r.ref}`)).length;
              return (
                <button
                  key={d.key}
                  type="button"
                  role="tab"
                  aria-selected={d.key === current.key}
                  className={`ops-tab${d.key === current.key ? " is-on" : ""}`}
                  onClick={() => choose(d.key)}
                >
                  {d.label}
                  <span className="ops-count">{d.rows.length}</span>
                  {pending > 0 && d.key !== current.key && (
                    <span className="ops-new">{pending} changed</span>
                  )}
                </button>
              );
            })}
          </div>
          <a className="ops-download" href={`/demo/solops/export/${current.key}`}>
            Download as Excel
          </a>
        </div>

        <div className="ops-card">
          <div className="ops-scroll">
            <table className="ops-table">
              <thead>
                <tr>
                  <th scope="col" className="ops-num">#</th>
                  <th scope="col">Ref</th>
                  {current.columns.map((c) => (
                    <th key={c} scope="col" className={NUMERIC.has(c) ? "is-num" : undefined}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {current.rows.map((r, i) => {
                  const key = `${current.key}:${r.ref}`;
                  const recent = now - new Date(r.changedAt).getTime() < RECENT_MS;
                  const target = Number(r.cells[current.columns.indexOf("Margin Target")]);
                  const actual = Number(r.cells[current.columns.indexOf("Margin Actual")]);
                  const underTarget = current.key === "engagements" && target - actual > 5;
                  return (
                    <tr key={key} className={`${lit.has(key) ? "is-lit" : ""}${recent ? " is-recent" : ""}`}>
                      <td className="ops-num">{i + 1}</td>
                      <td className="ops-ref">
                        {r.ref}
                        {recent && <span className="ops-changed">changed {ago(now - new Date(r.changedAt).getTime())}</span>}
                      </td>
                      {current.columns.map((c, ci) => {
                        const v = r.cells[ci] ?? "";
                        const tone = pillTone(c, v);
                        const warn = underTarget && c === "Margin Actual";
                        return (
                          <td key={c} className={`${NUMERIC.has(c) ? "is-num" : ""}${warn ? " is-warn" : ""}`}>
                            {tone ? <span className={`ops-pill t-${tone}`}>{v}</span> : display(c, v)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="ops-foot">
          Demonstration records. People and clients here are invented; the shapes, lead times and
          commercials are Sol&apos;s. This page updates on its own every few seconds.
        </p>
      </div>
    </main>
  );
}

const CSS = `
.ops {
  --ink: #1C2326; --muted: #667075; --ground: #F3F4F2; --surface: #FFFFFF;
  --rule: #E2E4E1; --head: #1F2A2E; --accent: #0E7C74; --lit: #FFE9A3;
  --good-bg: #E2F1EA; --good-fg: #1D6048; --att-bg: #FCE9DD; --att-fg: #9A3B12;
  --info-bg: #E4ECF8; --info-fg: #234C86; --quiet-bg: #ECEDEE; --quiet-fg: #5A6066;
  min-height: 100vh; background: var(--ground); color: var(--ink);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 14px;
}
.ops-bar {
  background: var(--head); color: #fff; display: flex; align-items: center; gap: 10px;
  padding-block: 13px; padding-inline: 20px; font-size: 15px; letter-spacing: -0.01em;
}
.ops-mark { width: 22px; height: 22px; border-radius: 5px; background: linear-gradient(135deg, #14A098, #0E7C74); }
.ops-live { margin-left: auto; font-size: 12px; opacity: .78; display: inline-flex; align-items: center; gap: 7px; font-variant-numeric: tabular-nums; }
.ops-dot { width: 8px; height: 8px; border-radius: 50%; background: #3DDC97; box-shadow: 0 0 0 0 rgba(61,220,151,.6); animation: ops-pulse 2s infinite; }
@keyframes ops-pulse { 0% { box-shadow: 0 0 0 0 rgba(61,220,151,.55); } 70% { box-shadow: 0 0 0 7px rgba(61,220,151,0); } 100% { box-shadow: 0 0 0 0 rgba(61,220,151,0); } }

.ops-wrap { max-width: 1320px; margin: 0 auto; padding-block: 20px 56px; padding-inline: 16px; display: flex; flex-direction: column; gap: 14px; }
.ops-toolbar { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px; }
.ops-tabs { display: flex; flex-wrap: wrap; gap: 4px; }
.ops-tab {
  font: inherit; font-weight: 500; color: var(--muted); background: transparent; border: 1px solid transparent;
  border-radius: 7px; padding: 8px 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px;
}
.ops-tab:hover { color: var(--ink); background: #E9EBE8; }
.ops-tab.is-on { color: var(--ink); background: var(--surface); border-color: var(--rule); box-shadow: 0 1px 2px rgba(0,0,0,.05); }
.ops-tab:focus-visible, .ops-download:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ops-count { font-size: 11.5px; color: var(--muted); background: #E9EBE8; border-radius: 999px; padding: 1px 7px; font-variant-numeric: tabular-nums; }
.ops-tab.is-on .ops-count { background: #EEF6F5; color: var(--accent); }
.ops-new { font-size: 11px; font-weight: 600; color: #7A4B00; background: var(--lit); border-radius: 999px; padding: 1px 7px; }
.ops-download {
  font-weight: 600; font-size: 13px; color: #fff; background: var(--accent); text-decoration: none;
  border-radius: 7px; padding: 8px 13px;
}
.ops-download:hover { background: #0B6962; }

.ops-card { background: var(--surface); border: 1px solid var(--rule); border-radius: 9px; overflow: hidden; }
.ops-scroll { overflow-x: auto; max-height: calc(100vh - 190px); overflow-y: auto; }
.ops-table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13.5px; }
.ops-table th {
  position: sticky; top: 0; z-index: 1; background: #F7F8F6; text-align: left; font-size: 11.5px;
  font-weight: 600; letter-spacing: .03em; color: var(--muted); padding: 9px 12px; border-bottom: 1px solid var(--rule); white-space: nowrap;
}
.ops-table td { padding: 9px 12px; border-bottom: 1px solid #EEF0ED; vertical-align: top; white-space: nowrap; }
.ops-table tbody tr:hover td { background: #FAFBF9; }
.ops-table .is-num { text-align: right; font-variant-numeric: tabular-nums; }
.ops-num { width: 1%; color: #9AA1A5; font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
.ops-ref { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12.5px; color: #3B5E7A; }
.ops-changed { display: block; font-family: system-ui, sans-serif; font-size: 10.5px; font-weight: 600; color: #8A5A00; margin-top: 2px; }
.is-recent td:first-child { box-shadow: inset 3px 0 0 #D98E04; }
.is-warn { color: #B42318; font-weight: 600; }

.ops-pill { display: inline-block; font-size: 11.5px; font-weight: 600; border-radius: 999px; padding: 2px 9px; }
.t-good { background: var(--good-bg); color: var(--good-fg); }
.t-attention { background: var(--att-bg); color: var(--att-fg); }
.t-info { background: var(--info-bg); color: var(--info-fg); }
.t-quiet { background: var(--quiet-bg); color: var(--quiet-fg); }

.ops-table tr.is-lit td { animation: ops-lit ${FLASH_MS}ms ease-out forwards; }
@keyframes ops-lit { 0% { background: var(--lit); } 60% { background: var(--lit); } 100% { background: transparent; } }

.ops-foot { color: #8A9095; font-size: 12px; margin: 0; }

@media (max-width: 640px) {
  .ops-toolbar { align-items: stretch; }
  .ops-download { text-align: center; }
  .ops-scroll { max-height: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ops-dot { animation: none; }
  .ops-table tr.is-lit td { animation: none; background: var(--lit); }
}
`;
