// TEMPORARY diagnostic: runs the model parity scenarios inside the edge runtime,
// where the provider keys already live, so a key never has to leave Supabase.
//
// Dispatches through llm.ts, the SAME router the chat engine uses, so this covers
// the real production path (including its fall-back-to-Gemini behaviour) rather
// than calling an adapter directly.
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
//   npx supabase functions deploy model-parity --project-ref <ref>
//   curl -X POST -H "Authorization: Bearer <anon>" -H "x-parity-secret: <secret>" //        "https://<ref>.supabase.co/functions/v1/model-parity?provider=openai&model=gpt-4o"
//   npx supabase functions delete model-parity --project-ref <ref>
//   npx supabase secrets unset PARITY_SECRET --project-ref <ref>
//
// Results on 2026-09-09 against sngmxemsfhtkaxwgkwfy, 9/9 unless noted:
//   gemini   (flash default), gemini-pro-latest
//   anthropic claude-sonnet-5, claude-opus-5, claude-haiku-4-5
//   openai    gpt-4o-mini, gpt-4o
//   gemini-2.5-pro  0/9 — HTTP 404, "no longer available to new users".
//                   Removed from the picker in favour of gemini-pro-latest.
import { generateReplyWith } from "../_shared/llm.ts";
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
  const q = new URL(req.url).searchParams;

  // ?diag=gemini-raw&model=... — the raw generateContent response, so a null reply
  // can be attributed (finishReason, whether any text part came back, token split).
  if (q.get("diag") === "gemini-raw") {
    const key = Deno.env.get("GEMINI_API_KEY") ?? "";
    const m = q.get("model") || "gemini-2.5-pro";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: "What company is this?" }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
        }),
      },
    );
    const body = await res.json();
    const cand = body?.candidates?.[0];
    return new Response(JSON.stringify({
      model: m,
      status: res.status,
      finishReason: cand?.finishReason ?? null,
      textParts: (cand?.content?.parts ?? []).filter((x: Record<string, unknown>) => x.text).length,
      usage: body?.usageMetadata ?? null,
      error: body?.error?.message ?? null,
    }, null, 1), { headers: { "content-type": "application/json" } });
  }

  // ?diag=gemini-models — ask Google which models THIS key may call. The picker
  // offers model ids from a static list, and an id the key cannot use fails as a
  // null reply rather than an error the owner would ever see.
  if (q.get("diag") === "gemini-models") {
    const key = Deno.env.get("GEMINI_API_KEY") ?? "";
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`);
    const body = await res.json();
    // deno-lint-ignore no-explicit-any
    const names = (body?.models ?? []).map((m: any) => String(m.name).replace("models/", ""))
      // deno-lint-ignore no-explicit-any
      .filter((n: string) => n.includes("gemini"));
    return new Response(JSON.stringify({ status: res.status, count: names.length, models: names }, null, 1),
      { headers: { "content-type": "application/json" } });
  }

  const provider = q.get("provider") || "gemini";
  const model = q.get("model") || undefined;
  // Exactly what a store row carries, so this is the dispatcher's real input.
  const choice = { model_provider: provider, model_name: model ?? null };
  const reply = (contents: GeminiContent[], toolset?: Toolset) =>
    generateReplyWith(choice, SYSTEM, contents, toolset);
  const checks: { name: string; pass: boolean; detail: string }[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

  try {
    // 1. Plain answer, no tools.
    {
      const r = await reply([u("What company is this?")]);
      add("plain answer without tools", !!r.text && r.toolsUsed.length === 0,
        `text=${JSON.stringify(r.text)}`);
    }

    // 2. A read tool. Where a rejected Gemini-shaped schema would show up: the
    //    adapter drops ALL tools and retries, which looks like a fine answer.
    {
      const { toolset, calls } = makeToolset();
      const r = await reply([u("Where is my order 7742?")], toolset);
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
      const r = await reply([u("Please order 40 units of SKU 4062-96 to my account.")], toolset);
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
      const r = await reply([u("Check order 7742 for me, and then order 10 more of SKU 4062-96.")], toolset);
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
      provider,
      model: model ?? "(provider default)",
      passed,
      failed: checks.length - passed,
      checks,
    }, null, 1),
    { headers: { "content-type": "application/json" } },
  );
});
