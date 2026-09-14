import { NextResponse, type NextRequest } from "next/server";
import { checkKey, createTicket, listTickets } from "@/lib/demo/service-desk";

/**
 * The service desk's ticket collection.
 *
 * A mock of a client system, reached exactly as a real one would be: an API key
 * in a header, JSON in and out, and no knowledge of who is calling beyond what
 * the caller says. The assistant's own identity assertion travels separately, in
 * its own header, which the connector adds.
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

export async function GET(req: NextRequest) {
  const gate = checkKey(key(req));
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status, headers: CORS });

  const p = new URL(req.url).searchParams;
  const tickets = await listTickets({
    status: p.get("status") ?? undefined,
    requester: p.get("requester") ?? undefined,
    assignee: p.get("assignee") ?? undefined,
    q: p.get("q") ?? undefined,
    limit: p.get("limit") ? Number(p.get("limit")) : undefined,
  });
  return NextResponse.json({ count: tickets.length, tickets }, { headers: CORS });
}

export async function POST(req: NextRequest) {
  const gate = checkKey(key(req));
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status, headers: CORS });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400, headers: CORS });
  }

  const res = await createTicket({
    title: String(body.title ?? ""),
    description: body.description ? String(body.description) : undefined,
    requester: body.requester ? String(body.requester) : undefined,
    category: body.category ? String(body.category) : undefined,
    priority: body.priority ? String(body.priority) : undefined,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400, headers: CORS });
  return NextResponse.json(res.ticket, { status: 201, headers: CORS });
}
