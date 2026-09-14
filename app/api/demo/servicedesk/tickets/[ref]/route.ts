import { NextResponse, type NextRequest } from "next/server";
import { checkKey, getTicket, updateTicket } from "@/lib/demo/service-desk";

export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-api-key, authorization, x-assistant-identity",
  "access-control-allow-methods": "GET, PATCH, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function key(req: NextRequest): string | null {
  return req.headers.get("x-api-key") ?? req.headers.get("authorization");
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  const gate = checkKey(key(req));
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status, headers: CORS });

  const { ref } = await ctx.params;
  const ticket = await getTicket(ref);
  if (!ticket) return NextResponse.json({ error: `No ticket called ${ref}.` }, { status: 404, headers: CORS });
  return NextResponse.json(ticket, { headers: CORS });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  const gate = checkKey(key(req));
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status, headers: CORS });

  const { ref } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400, headers: CORS });
  }

  const res = await updateTicket(ref, {
    status: body.status ? String(body.status) : undefined,
    assignee: body.assignee !== undefined ? String(body.assignee) : undefined,
    priority: body.priority ? String(body.priority) : undefined,
    note: body.note ? String(body.note) : undefined,
  });
  if (!res.ok) {
    const missing = res.error.startsWith("No ticket");
    return NextResponse.json({ error: res.error }, { status: missing ? 404 : 400, headers: CORS });
  }
  return NextResponse.json(res.ticket, { headers: CORS });
}
