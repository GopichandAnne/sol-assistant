import { NextResponse, type NextRequest } from "next/server";
import { checkKey, createTicket, getTicket, listTickets, updateTicket } from "@/lib/demo/service-desk";

/**
 * The same service desk, as an MCP server.
 *
 * Two front doors onto one implementation, because a client arrives with
 * whichever they have and the demo should not care. Connecting this way is a URL
 * and a key in the console; connecting the REST way is a spec URL and the same
 * key. Showing both, back to back, is what makes "setting up an integration is
 * easy" a demonstration rather than a claim.
 *
 * Speaks the subset our client actually uses: initialize, the initialized
 * notification, tools/list and tools/call over JSON-RPC 2.0. No session header
 * is issued — this server keeps no per-connection state, and inventing one would
 * be ceremony rather than fidelity.
 */
export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-api-key, authorization, mcp-session-id, mcp-protocol-version",
  "access-control-allow-methods": "POST, OPTIONS",
};

const TOOLS = [
  {
    name: "list_tickets",
    description:
      "Find tickets in the Northwind service desk. Use requester for 'what have I raised', " +
      "assignee for 'what is assigned to me', status to narrow to open work, and q to search the " +
      "title and description. Newest first.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Open, In progress, Waiting, Resolved or Closed." },
        requester: { type: "string", description: "Email of the person who raised it." },
        assignee: { type: "string", description: "Email of the person it is assigned to." },
        q: { type: "string", description: "Free text searched in the title and description." },
        limit: { type: "integer", description: "How many to return. Default 20." },
      },
    },
  },
  {
    name: "get_ticket",
    description: "Look up one ticket by its reference, for example INC-1039.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string", description: "The ticket reference." } },
      required: ["ref"],
    },
  },
  {
    name: "raise_ticket",
    description:
      "Raise a new ticket on somebody's behalf. This creates a real record the service desk will " +
      "work, so confirm the summary with the person first. Returns the reference to quote back.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "One line saying what is wrong or what is needed." },
        description: { type: "string", description: "The detail, in the person's own words." },
        requester: { type: "string", description: "Email of the person it is for." },
        category: { type: "string", description: "IT, Access, Facilities, Finance or General." },
        priority: { type: "string", description: "Low, Normal, High or Urgent." },
      },
      required: ["title"],
    },
  },
  {
    name: "update_ticket",
    description:
      "Change a ticket's status, assignee or priority, or add a note to its history. This changes " +
      "a record other people rely on, so say what you are about to change and get agreement first.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "The ticket reference." },
        status: { type: "string", description: "Open, In progress, Waiting, Resolved or Closed." },
        assignee: { type: "string", description: "Email, or empty to unassign." },
        priority: { type: "string", description: "Low, Normal, High or Urgent." },
        note: { type: "string", description: "Appended to the ticket's history with a timestamp." },
      },
      required: ["ref"],
    },
  },
];

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const ok = (id: unknown, result: unknown) =>
  NextResponse.json({ jsonrpc: "2.0", id, result }, { headers: CORS });
const fail = (id: unknown, code: number, message: string) =>
  NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: CORS });

/** MCP returns tool output as content blocks; text is what every client reads. */
const text = (payload: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

export async function POST(req: NextRequest) {
  const gate = checkKey(req.headers.get("x-api-key") ?? req.headers.get("authorization"));
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status, headers: CORS });

  let msg: Record<string, unknown>;
  try {
    msg = await req.json();
  } catch {
    return fail(null, -32700, "Parse error");
  }

  const id = msg.id ?? null;
  const method = String(msg.method ?? "");
  const params = (msg.params ?? {}) as Record<string, unknown>;

  // Notifications carry no id and expect no result. Answering one with a JSON-RPC
  // response is technically wrong and confuses stricter clients.
  if (method.startsWith("notifications/")) return new NextResponse(null, { status: 202, headers: CORS });

  if (method === "initialize") {
    return ok(id, {
      // Echo the client's protocol version when it sends one: this server has no
      // version-specific behaviour, and disagreeing about it only creates work.
      protocolVersion: String(params.protocolVersion ?? "2025-06-18"),
      capabilities: { tools: {} },
      serverInfo: { name: "Northwind Service Desk", version: "2.4.0" },
    });
  }

  if (method === "tools/list") return ok(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name === "list_tickets") {
        const tickets = await listTickets({
          status: args.status ? String(args.status) : undefined,
          requester: args.requester ? String(args.requester) : undefined,
          assignee: args.assignee ? String(args.assignee) : undefined,
          q: args.q ? String(args.q) : undefined,
          limit: args.limit ? Number(args.limit) : undefined,
        });
        return ok(id, text({ count: tickets.length, tickets }));
      }
      if (name === "get_ticket") {
        const t = await getTicket(String(args.ref ?? ""));
        return ok(id, t ? text(t) : { ...text({ error: `No ticket called ${args.ref}.` }), isError: true });
      }
      if (name === "raise_ticket") {
        const res = await createTicket({
          title: String(args.title ?? ""),
          description: args.description ? String(args.description) : undefined,
          requester: args.requester ? String(args.requester) : undefined,
          category: args.category ? String(args.category) : undefined,
          priority: args.priority ? String(args.priority) : undefined,
        });
        return ok(id, res.ok ? text(res.ticket) : { ...text({ error: res.error }), isError: true });
      }
      if (name === "update_ticket") {
        const res = await updateTicket(String(args.ref ?? ""), {
          status: args.status ? String(args.status) : undefined,
          assignee: args.assignee !== undefined ? String(args.assignee) : undefined,
          priority: args.priority ? String(args.priority) : undefined,
          note: args.note ? String(args.note) : undefined,
        });
        return ok(id, res.ok ? text(res.ticket) : { ...text({ error: res.error }), isError: true });
      }
      return fail(id, -32602, `Unknown tool: ${name}`);
    } catch (e) {
      return ok(id, { ...text({ error: e instanceof Error ? e.message : String(e) }), isError: true });
    }
  }

  return fail(id, -32601, `Method not found: ${method}`);
}
