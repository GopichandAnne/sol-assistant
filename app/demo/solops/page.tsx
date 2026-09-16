import type { Metadata } from "next";
import { allRowsForView, COLUMNS, DATASET_META, DATASETS } from "@/lib/demo/sol-ops";
import { OpsView, type OpsDataset } from "./ops-view";

/**
 * Sol's operational records, on a screen.
 *
 * The assistant reads and writes these through an API. This page is where a
 * person looks at the same records: the demo's strongest moments are a change
 * made in Teams appearing here, and "it is in the database, trust me" is not
 * somewhere to look. It refreshes itself and marks what changed, so the presenter
 * never has to touch it after an approval.
 *
 * Read-only and unauthenticated, like the service desk: invented people, nothing
 * to protect.
 */
export const metadata: Metadata = {
  title: "Sol Operations",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function SolOpsPage() {
  const all = await allRowsForView();
  const datasets: OpsDataset[] = DATASETS.map((key) => ({
    key,
    label: DATASET_META[key].label,
    columns: COLUMNS[key],
    rows: all[key].map((r) => ({
      ref: r.ref,
      cells: COLUMNS[key].map((c) => String(r.data[c] ?? "")),
      changedAt: r.updated_at > r.created_at ? r.updated_at : r.created_at,
    })),
  }));

  return <OpsView datasets={datasets} renderedAt={new Date().toISOString()} />;
}
