import { NextResponse, type NextRequest } from "next/server";
import { addRow, checkKey, isDataset, listRows } from "@/lib/demo/sol-ops";

/**
 * One handler for all four datasets.
 *
 * The OpenAPI document declares /bench, /engagements, /compliance and
 * /timesheets as separate paths with their own descriptions, because those
 * descriptions are what the model reads when deciding where to look. Underneath
 * they are the same code: four near-identical route files would drift, and the
 * one that drifted would be the one nobody tested.
 */
export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-api-key, authorization, x-assistant-identity",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function key(req: NextRequest): string | null {
  return req.headers.get("x-api-key") ?? req.headers.get("authorization");
}

/** Everything that is not a known query option is treated as a field filter, so
 *  ?Practice=Operations works without the spec having to enumerate every column
 *  of every dataset. */
const RESERVED = new Set(["match", "limit"]);

export async function GET(req: NextRequest, ctx: { params: Promise<{ dataset: string }> }) {
  const gate = checkKey(key(req));
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status, headers: CORS });

  const { dataset } = await ctx.params;
  if (!isDataset(dataset)) {
    return NextResponse.json({ error: `No dataset called ${dataset}.` }, { status: 404, headers: CORS });
  }

  const p = new URL(req.url).searchParams;
  const where: Record<string, string> = {};
  for (const [k, v] of p.entries()) {
    if (!RESERVED.has(k) && v) where[k] = v;
  }

  const rows = await listRows(dataset, {
    match: p.get("match") ?? undefined,
    where,
    limit: p.get("limit") ? Number(p.get("limit")) : undefined,
  });
  return NextResponse.json({ dataset, count: rows.length, records: rows }, { headers: CORS });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ dataset: string }> }) {
  const gate = checkKey(key(req));
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status, headers: CORS });

  const { dataset } = await ctx.params;
  if (!isDataset(dataset)) {
    return NextResponse.json({ error: `No dataset called ${dataset}.` }, { status: 404, headers: CORS });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400, headers: CORS });
  }

  const res = await addRow(dataset, body);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400, headers: CORS });
  return NextResponse.json(res.row, { status: 201, headers: CORS });
}
