import { NextResponse, type NextRequest } from "next/server";

/**
 * The spec the connector builder reads.
 *
 * Every description here says WHEN to call the operation and what the records
 * mean, not merely what shape comes back. These become the tool descriptions the
 * model sees, and a tool described by its return type is a tool that gets called
 * at random or not at all.
 *
 * Four paths for four datasets, though one handler serves them: the separation
 * is for the reader, human or model, and it is the half that matters.
 */
export const dynamic = "force-dynamic";

const KEY = { ApiKey: { type: "apiKey", in: "header", name: "x-api-key" } };

function listOp(id: string, summary: string, description: string, filters: string[]) {
  return {
    operationId: id,
    summary,
    description,
    parameters: [
      {
        name: "match",
        in: "query",
        schema: { type: "string" },
        description: "Free text matched anywhere in a record. Use for a person's name, a client or a code.",
      },
      ...filters.map((f) => ({
        name: f,
        in: "query" as const,
        schema: { type: "string" },
        description: `Exact match on the ${f} field.`,
      })),
      { name: "limit", in: "query", schema: { type: "integer", default: 60 } },
    ],
    responses: {
      "200": {
        description: "Matching records",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                dataset: { type: "string" },
                count: { type: "integer" },
                records: { type: "array", items: { type: "object", additionalProperties: true } },
              },
            },
          },
        },
      },
    },
  };
}

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;

  const spec = {
    openapi: "3.0.3",
    info: {
      title: "Sol Operations",
      version: "1.2.0",
      description:
        "Sol Consulting's own operational records: who is on the bench and when they roll off, " +
        "live engagements and their margin, what each client account requires before somebody is " +
        "client facing, and weekly timesheet status.",
    },
    servers: [{ url: `${origin}/api/demo/solops` }],
    components: { securitySchemes: KEY },
    security: [{ ApiKey: [] }],
    paths: {
      "/bench": {
        get: listOp(
          "listBench",
          "Who is available, and when",
          "Consultants, what they are working on, when they roll off, their skills, location and " +
            "any client clearances they already hold. Use this for 'who is free', 'who rolls off " +
            "soon', 'who has done Databricks', and 'who has been on the bench a while'. " +
            "Availability and Rolls Off are the fields that answer staffing questions; Clearances " +
            "matters because a cleared person can start on a public sector account in days rather " +
            "than weeks.",
          ["Practice", "Level", "Location"],
        ),
      },
      "/engagements": {
        get: listOp(
          "listEngagements",
          "Engagements and their margin",
          "Live and closed engagements with client, dates, fee type, fee, and margin target " +
            "against margin actual. Use this for 'which engagements are under target', 'what are " +
            "we running for this client', and to check a prior engagement's commercials before " +
            "reusing anything from it.",
          ["Status", "Practice", "Client"],
        ),
      },
      "/compliance": {
        get: listOp(
          "listCompliance",
          "What a client account requires",
          "Per client: the checks, training and agreements somebody needs before being client " +
            "facing, who owns each, and how long each genuinely takes. Use this for 'what does " +
            "somebody need before joining this account' and 'how long will that take'. Lead times " +
            "are the point: several run in sequence rather than in parallel.",
          ["Client", "Status", "Owner"],
        ),
        post: {
          operationId: "addComplianceRecord",
          summary: "Record a compliance item for somebody",
          description:
            "Add a requirement record, for instance starting a background check for a named " +
            "person on an account. This creates a real record that People Operations works from, " +
            "so confirm the detail with the person asking first. Pass the fields as they appear " +
            "in the existing records.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true,
                  example: {
                    Client: "Commonwealth IT",
                    Requirement: "State of Virginia background check",
                    "Applies To": "Ellie Frost",
                    "Lead Time": "15 working days",
                    Owner: "People Ops",
                    Status: "Pending",
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created" } },
        },
      },
      "/timesheets": {
        get: listOp(
          "listTimesheets",
          "Timesheet status by week",
          "Per person per week: engagement, billable and non-billable hours, whether it was " +
            "submitted and whether it was approved. Use this for 'who has not submitted', " +
            "'what is waiting for my approval', and utilisation questions.",
          ["Submitted", "Approved", "Approver"],
        ),
      },
      "/{dataset}/{ref}": {
        patch: {
          operationId: "updateRecord",
          summary: "Change one record",
          description:
            "Update a single record in any of the datasets. `dataset` is bench, engagements, " +
            "compliance or timesheets, and `ref` identifies the record: a person's name, an " +
            "engagement code, or text that matches only one row. If it matches more than one the " +
            "call is refused and the candidates are returned, so ask which one rather than " +
            "guessing. Send only the fields that change. This changes a record other people rely " +
            "on, so say what you are about to change and get agreement first.",
          parameters: [
            { name: "dataset", in: "path", required: true, schema: { type: "string" } },
            { name: "ref", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true,
                  example: { Approved: "Yes", Notes: "Approved after chasing" },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated, with the previous values" },
            "409": { description: "The reference matched more than one record" },
          },
        },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: { "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}
