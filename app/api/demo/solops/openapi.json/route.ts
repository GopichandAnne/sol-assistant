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
 *
 * Every write declares its fields. An earlier version took "any object", and the
 * connector builder, which can only map fields it can see, produced tools that
 * sent no body at all: a write that was held, approved, and then failed.
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
      version: "2.0.0",
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
          "Live and closed engagements with client, dates, fee type, fee in USD, and margin target " +
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
            "facing, who owns each, how long each genuinely takes, and any items already started " +
            "for a named person. Use this for 'what does somebody need before joining this " +
            "account' and 'how long will that take'. Lead times are the point: several run in " +
            "sequence rather than in parallel. Every record carries a ref such as compliance-004.",
          ["Client", "Status", "Owner"],
        ),
        post: {
          operationId: "addComplianceRecord",
          summary: "Start a compliance item for a named person",
          description:
            "Add a requirement record, for instance starting a background check for a named " +
            "person on an account. People Operations works from these records, so show the " +
            "person asking exactly what will be added and get their agreement before calling.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["client", "requirement", "applies_to", "status"],
                  properties: {
                    client: { type: "string", description: "Client account, as it appears in existing records. e.g. Commonwealth IT" },
                    engagement_code: { type: "string", description: "Engagement code for that client. e.g. ENG-2423" },
                    requirement: { type: "string", description: "The check, training or agreement. e.g. State of Virginia background check" },
                    applies_to: { type: "string", description: "The person it is for, by full name. e.g. Ellie Frost" },
                    lead_time: { type: "string", description: "How long it takes, copied from the account's existing requirement. e.g. 15 working days" },
                    owner: { type: "string", description: "Who owns it: People Ops, Client IT, Legal or Information Security." },
                    status: { type: "string", description: "Pending, In progress or In place. A newly started item is Pending." },
                    notes: { type: "string", description: "Anything the owner should know." },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created, with its ref" } },
        },
      },
      "/compliance/{ref}": {
        patch: {
          operationId: "updateComplianceRecord",
          summary: "Change one compliance item",
          description:
            "Update a single compliance record. Look it up first and pass its exact ref, such as " +
            "compliance-011; never pass a person's name, because one person has several items. " +
            "Send only the fields that change, and get agreement before calling.",
          parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" }, description: "The record's ref from a lookup, e.g. compliance-011" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", description: "Pending, In progress or In place." },
                    owner: { type: "string" },
                    lead_time: { type: "string" },
                    notes: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated, with the previous values" },
            "409": { description: "The ref matched more than one record" },
          },
        },
      },
      "/timesheets": {
        get: listOp(
          "listTimesheets",
          "Timesheet status by week",
          "Per person per week: engagement, billable and non-billable hours, whether it was " +
            "submitted and whether it was approved. Use this for 'who has not submitted', " +
            "'what is waiting for my approval', and utilisation questions. Every record carries a " +
            "ref such as timesheets-014; one person has a record per week.",
          ["Submitted", "Approved", "Approver"],
        ),
        post: {
          operationId: "logTimesheetHours",
          summary: "Log hours for a person and week",
          description:
            "Add a timesheet entry: hours against a week, billable or non-billable. Use this when " +
            "somebody asks to log time, for instance practice development, which is non-billable. " +
            "Confirm the person, week and hours before calling.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "week_ending"],
                  properties: {
                    name: { type: "string", description: "Full name of the person the hours belong to." },
                    week_ending: { type: "string", description: "The Saturday the week ends on, as YYYY-MM-DD. e.g. 2026-09-19" },
                    engagement_code: { type: "string", description: "Engagement code, or empty for internal time." },
                    hours_billable: { type: "number", description: "Billable hours. 0 for internal time." },
                    hours_non_billable: { type: "number", description: "Non-billable hours, such as practice development or bench time." },
                    submitted: { type: "string", description: "Yes or No. Defaults to No." },
                    approved: { type: "string", description: "Yes or No. Defaults to No." },
                    approver: { type: "string", description: "Who approves this person's time." },
                    notes: { type: "string", description: "What the time was for. e.g. Practice development" },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created, with its ref" } },
        },
      },
      "/timesheets/{ref}": {
        patch: {
          operationId: "updateTimesheet",
          summary: "Change one timesheet entry",
          description:
            "Update a single timesheet, for instance marking it approved or adding a note. Look it " +
            "up first and pass its exact ref, such as timesheets-014. Never pass a person's name: " +
            "each person has an entry per week, so a name matches several. If a lookup returns more " +
            "than one entry for the person, ask which week before calling. Send only the fields " +
            "that change, and get agreement first.",
          parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" }, description: "The entry's ref from a lookup, e.g. timesheets-014" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    submitted: { type: "string", description: "Yes or No." },
                    approved: { type: "string", description: "Yes or No." },
                    hours_billable: { type: "number" },
                    hours_non_billable: { type: "number" },
                    notes: { type: "string", description: "e.g. Approved after chasing" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated, with the previous values" },
            "409": { description: "The ref matched more than one record" },
          },
        },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: { "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}
