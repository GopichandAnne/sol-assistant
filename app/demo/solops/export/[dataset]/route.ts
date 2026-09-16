import { NextResponse, type NextRequest } from "next/server";
import { allRowsForView, COLUMNS, DATASET_META, isDataset } from "@/lib/demo/sol-ops";
import { buildXlsx } from "@/lib/demo/xlsx";

/**
 * The live record, as an Excel file.
 *
 * Generated from the rows at the moment of download, so a change the assistant
 * made thirty seconds ago is in the file. Unauthenticated for the same reason the
 * operations page is: invented people, nothing to protect, and a sign-in prompt
 * in front of a room is a fumble.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await ctx.params;
  if (!isDataset(dataset)) {
    return NextResponse.json({ error: `No dataset called ${dataset}.` }, { status: 404 });
  }

  const meta = DATASET_META[dataset];
  const columns = COLUMNS[dataset];
  const rows = (await allRowsForView())[dataset].map((r) => columns.map((c) => String(r.data[c] ?? "")));
  const bytes = await buildXlsx({ sheetName: meta.sheet, tableName: meta.table, columns, rows });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${meta.file}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
