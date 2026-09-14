import { NextResponse, type NextRequest } from "next/server";

/**
 * The spec a client would hand us.
 *
 * Served rather than written by hand into the console, because the demo's claim
 * is that connecting a system takes a URL and a sentence. Pasting this address
 * into the connector builder is the whole setup, and it has to be a real,
 * fetchable, valid OpenAPI document for that to be true rather than staged.
 *
 * Deliberately plain: an apiKey security scheme in a header, four operations,
 * and descriptions written for a reader who has to decide when to call each one.
 * Those descriptions become the tool descriptions the model reads, which is why
 * they say when to use an operation and not merely what it returns.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;

  const spec = {
    openapi: "3.0.3",
    info: {
      title: "Northwind Service Desk",
      version: "2.4.0",
      description:
        "Tickets raised by Northwind colleagues: IT faults, access requests, facilities and finance queries.",
    },
    servers: [{ url: `${origin}/api/demo/servicedesk` }],
    components: {
      securitySchemes: {
        ApiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        Ticket: {
          type: "object",
          properties: {
            ref: { type: "string", example: "INC-1039" },
            title: { type: "string" },
            description: { type: "string", nullable: true },
            requester: { type: "string", nullable: true },
            assignee: { type: "string", nullable: true },
            category: { type: "string", example: "IT" },
            priority: { type: "string", enum: ["Low", "Normal", "High", "Urgent"] },
            status: { type: "string", enum: ["Open", "In progress", "Waiting", "Resolved", "Closed"] },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
      },
    },
    security: [{ ApiKey: [] }],
    paths: {
      "/tickets": {
        get: {
          operationId: "listTickets",
          summary: "List tickets",
          description:
            "Find tickets in the service desk. Use `requester` to answer 'what have I raised', " +
            "`assignee` for 'what is assigned to me', `status` to narrow to open work, and `q` to " +
            "search the title and description. Returns newest first.",
          parameters: [
            { name: "status", in: "query", schema: { type: "string" }, description: "Open, In progress, Waiting, Resolved or Closed." },
            { name: "requester", in: "query", schema: { type: "string" }, description: "Email of the person who raised it." },
            { name: "assignee", in: "query", schema: { type: "string" }, description: "Email of the person it is assigned to." },
            { name: "q", in: "query", schema: { type: "string" }, description: "Free text searched in the title and description." },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          ],
          responses: {
            "200": {
              description: "Matching tickets",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      count: { type: "integer" },
                      tickets: { type: "array", items: { $ref: "#/components/schemas/Ticket" } },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "createTicket",
          summary: "Raise a ticket",
          description:
            "Raise a new ticket on somebody's behalf. This creates a real record that the service " +
            "desk will work, so confirm the summary with the person first. Returns the reference " +
            "to quote back to them.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    title: { type: "string", description: "One line saying what is wrong or what is needed." },
                    description: { type: "string", description: "The detail, in the person's own words." },
                    requester: { type: "string", description: "Email of the person it is for." },
                    category: { type: "string", description: "IT, Access, Facilities, Finance or General." },
                    priority: { type: "string", enum: ["Low", "Normal", "High", "Urgent"] },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/Ticket" } } } },
          },
        },
      },
      "/tickets/{ref}": {
        get: {
          operationId: "getTicket",
          summary: "Get one ticket",
          description: "Look up a single ticket by its reference, for example INC-1039.",
          parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "The ticket", content: { "application/json": { schema: { $ref: "#/components/schemas/Ticket" } } } },
            "404": { description: "No such ticket" },
          },
        },
        patch: {
          operationId: "updateTicket",
          summary: "Update a ticket",
          description:
            "Change a ticket's status, assignee or priority, or add a note to its history. " +
            "This changes a record other people rely on, so say what you are about to change and " +
            "get agreement first.",
          parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["Open", "In progress", "Waiting", "Resolved", "Closed"] },
                    assignee: { type: "string", description: "Email, or empty to unassign." },
                    priority: { type: "string", enum: ["Low", "Normal", "High", "Urgent"] },
                    note: { type: "string", description: "Appended to the ticket's history with a timestamp." },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Ticket" } } } },
            "404": { description: "No such ticket" },
          },
        },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: { "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}
