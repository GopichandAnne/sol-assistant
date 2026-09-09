// TEMPORARY diagnostic: runs the Claude parity scenarios inside the edge runtime,
// where ANTHROPIC_API_KEY already lives, so the key never has to leave Supabase.
//
// Mirrors scripts/claude-parity.ts. That script is the durable version and runs on
// a developer machine; this one exists so the suite can be run against the deployed
// project without anyone copying a live key around.
//
// NOT DEPLOYED. Kept as source only, and safe by default: with PARITY_SECRET
// unset every request gets a 403, on top of the gateway's own JWT check.
//
// To use it, deploy, run, then remove the live surface again:
//   npx supabase secrets set PARITY_SECRET=$(openssl rand -hex 24) --project-ref <ref>
//   npx supabase functions deploy claude-parity --project-ref <ref>
//   curl -X POST -H "Authorization: Bearer <anon>" -H "x-parity-secret: <secret>" //        "https://<ref>.supabase.co/functions/v1/claude-parity?model=claude-opus-5"
//   npx supabase functions delete claude-parity --project-ref <ref>
//   npx supabase secrets unset PARITY_SECRET --project-ref <ref>
//
// Result on 2026-09-09 against sngmxemsfhtkaxwgkwfy: 9/9 on claude-sonnet-5,
// claude-opus-5 and claude-haiku-4-5.
import { anthropicReply } from "../_shared/anthropic.ts";
import type { Toolset, FunctionDeclaration } from "../_shared/tools.ts";
import type { GeminiContent } from "../_shared/gemini.ts";

const SYSTEM = [
  "You are the assistant for Northwind Supply, a distributor.",
  "Answer customers directly and briefly.",
  "When a tool is available for what the customer asked, call it rather than guessing.",
  "If a tool reports that an action was held for a person, say plainly that it has NOT",
  "been done and that someone will confirm. Never claim a held action succeeded.",
].join(" ");

const DECLS: FunctionDeclaration[] = [
  {
    name: "order_status",
    description: "Look up the status of a customer's order by its number.",
    parameters: {
      type: "object",
      properties: { order_number: { type: "string", description: "The order number, e.g. 7742" } },
      required: ["order_number"],
    },
  },
  {
    name: "place_order",
    description: "Place a new order on the customer's account. This performs a write.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string", description: "Product SKU" },
        quantity: { type: "number", description: "How many units" },
      },
      required: ["sku", "quantity"],
    },
  },
];

function makeToolset() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const toolset: Toolset = {
    declarations: DECLS,
    execute: (name, args) => {
      calls.push({ name, args });
      if (name === "order_status") {
        return Promise.resolve({
          order_number: String(args.order_number ?? ""),
          status: "shipped", shipped_on: "Tuesday", carrier: "Dallas DC", items: "12 cases",
        });
      }
      if (name === "place_order") {
        // The exact shape the real executor returns when action_policy = 'hold'.
        return Promise.resolve({
          held: true,
          note: "This action needs a person to approve it. An approval request has been opened. Nothing has been ordered.",
        });
      }
      return Promise.resolve({ error: `unknown tool ${name}` });
    },
  };
  return { toolset, calls };
}

const u = (text: string): GeminiContent => ({ role: "user", parts: [{ text }] });
const has = (t: string | null, words: string[]) =>
  !!t && words.some((w) => t.toLowerCase().includes(w.toLowerCase()));

Deno.serve(async (req) => {
  const guard = Deno.env.get("PARITY_SECRET");
  if (!guard || req.headers.get("x-parity-secret") !== guard) {
    return new Response("forbidden", { status: 403 });
  }
  const model = new URL(req.url).searchParams.get("model") || undefined;
  const checks: { name: string; pass: boolean; detail: string }[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

  try {
    // 1. Plain answer, no tools.
    {
      const r = await anthropicReply(model, SYSTEM, [u("What company is this?")]);
      add("plain answer without tools", !!r.text && r.toolsUsed.length === 0,
        `text=${JSON.stringify(r.text)}`);
    }

    // 2. A read tool. Where a rejected Gemini-shaped schema would show up: the
    //    adapter drops ALL tools and retries, which looks like a fine answer.
    {
      const { toolset, calls } = makeToolset();
      const r = await anthropicReply(model, SYSTEM, [u("Where is my order 7742?")], toolset);
      add("read tool declared and called", calls.some((c) => c.name === "order_status"),
        `executed=${JSON.stringify(calls.map((c) => c.name))} (empty = schema rejected, tools dropped)`);
      add("tool argument extracted", calls.some((c) => String(c.args.order_number ?? "").includes("7742")),
        `args=${JSON.stringify(calls.map((c) => c.args))}`);
      add("tool result reaches the answer", has(r.text, ["shipped", "Tuesday"]),
        `text=${JSON.stringify(r.text)}`);
    }

    // 3. A HELD write. Governance is only real if the model does not claim success.
    {
      const { toolset, calls } = makeToolset();
      const r = await anthropicReply(model, SYSTEM,
        [u("Please order 40 units of SKU 4062-96 to my account.")], toolset);
      add("held write: tool attempted", calls.some((c) => c.name === "place_order"),
        `executed=${JSON.stringify(calls.map((c) => c.name))}`);
      add("held write: does NOT claim success",
        !!r.text && !has(r.text, [
          "i've placed", "i have placed", "order is placed", "successfully ordered",
          "your order has been placed", "i've ordered", "i have ordered",
        ]),
        `text=${JSON.stringify(r.text)}`);
      add("held write: says it needs approval",
        has(r.text, ["approv", "held", "confirm", "not been", "hasn't been", "someone"]),
        `text=${JSON.stringify(r.text)}`);
    }

    // 4. Two tools, exercising the multi-round loop.
    {
      const { toolset, calls } = makeToolset();
      const r = await anthropicReply(model, SYSTEM,
        [u("Check order 7742 for me, and then order 10 more of SKU 4062-96.")], toolset);
      add("chained tools across rounds", new Set(calls.map((c) => c.name)).size >= 2,
        `executed=${JSON.stringify(calls.map((c) => c.name))}`);
      add("chained: returns a final answer", !!r.text, `text=${JSON.stringify(r.text)}`);
    }
  } catch (e) {
    add("suite completed without throwing", false, String((e as Error)?.message ?? e));
  }

  const passed = checks.filter((c) => c.pass).length;
  return new Response(
    JSON.stringify({
      model: model ?? "adapter default (claude-sonnet-5)",
      passed,
      failed: checks.length - passed,
      checks,
    }, null, 1),
    { headers: { "content-type": "application/json" } },
  );
});
