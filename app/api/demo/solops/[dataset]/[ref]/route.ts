import { NextResponse, type NextRequest } from "next/server";
import { checkKey, isDataset, updateRow } from "@/lib/demo/sol-ops";

export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-api-key, authorization, x-assistant-identity",
  "access-control-allow-methods": "PATCH, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ dataset: string; ref: string }> }) {
  const gate = checkKey(req.headers.get("x-api-key") ?? req.headers.get("authorization"));
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status, headers: CORS });

  const { dataset, ref } = await ctx.params;
  if (!isDataset(dataset)) {
    return NextResponse.json({ error: `No dataset called ${dataset}.` }, { status: 404, headers: CORS });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400, headers: CORS });
  }

  const res = await updateRow(dataset, decodeURIComponent(ref), body);
  if (!res.ok) {
    // An ambiguous reference is a 409, not a 404: the record exists, more than
    // once, and the caller has to choose. Returning the candidates is what lets
    // the assistant ask a useful question instead of guessing.
    const ambiguous = Array.isArray(res.matches);
    return NextResponse.json(
      { error: res.error, ...(ambiguous ? { matches: res.matches } : {}) },
      { status: ambiguous ? 409 : 404, headers: CORS },
    );
  }
  return NextResponse.json({ updated: res.row, was: res.was }, { headers: CORS });
}
