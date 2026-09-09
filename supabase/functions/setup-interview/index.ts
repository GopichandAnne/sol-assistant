// setup-interview — the setup conversation, one turn at a time.
//
// The person setting up an assistant here works in operations or IT, is setting it
// up for colleagues, and knows the JOB they want done. They usually do not know
// which systems that touches, and often cannot connect those systems themselves in
// the next five minutes.
//
// So this conversation does NOT try to finish setup. It agrees a PLAN: what the
// assistant is for, where it lives, which systems that implies, what must never
// happen without a person, and who it serves. The console turns that into a
// checklist the owner can work through over days, with other people.
//
// Deliberately gone from the previous version:
//   • "What kind of business is it?" — classified into a retail enum (grocery,
//     liquor, nursery…) whose answer the app then discarded.
//   • The website/address lookup — it existed to crawl a public site into a
//     customer-facing FAQ. An internal assistant's knowledge is not on the
//     marketing site, and its value is in the systems it can reach.
//
// Stateless: the client sends the running transcript each turn; we return the next
// message + chips, whether we are done, and (when done) the plan.
//
// verify_jwt stays ON (default) — only a signed-in owner can spend the model.

import { generateStructured } from "../_shared/gemini.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const SYS = `You are setting up a new AI assistant for someone's team. They work in operations or IT. They are setting this up for colleagues, not for customers.

WHO YOU ARE TALKING TO:
- Comfortable with software, but not necessarily a developer. Do not assume they can write code or call an API.
- They know the JOB they want done. They usually do NOT know which systems that touches, and often cannot connect those systems themselves right now.

HOW TO TALK:
- One short question at a time. One or two sentences.
- Offer 2-5 tap-able quick answers in "chips" wherever it helps. Always still allow free text.
- Briefly acknowledge what they said before the next question.
- Plain language. No jargon: no "prompt", "LLM", "schema", "tool-calling".
- Never use em dashes. Use a period, comma, colon, or parentheses instead.

THE FLOW:
1. Ask what they want this assistant to handle for their team. This is the most important answer, so let them describe it in their own words. Offer chips of common jobs: "IT and access requests", "HR and policy questions", "Status of tickets and requests", "Finding documents and answers", "Something else".
2. Ask where their team will talk to it. Chips: "Microsoft Teams", "Slack", "On a web page".
3. From the job they described, NAME the systems that job would need, and ask if that sounds right. Do not ask them to pick from a list of connectors cold: they will not know. Derive it. For example, access requests imply their identity directory and probably a ticketing system; timesheet chasing implies whatever they track time in. Ask them to confirm or correct the names, and tell them plainly that connecting these can happen later, that it often needs someone who administers that system, and that nothing is blocked in the meantime.
4. Ask what this assistant must NEVER do on its own, without a person approving. Frame it concretely against the job they described. Chips should be real examples from THEIR job, e.g. "Granting access", "Anything that spends money", "Emailing a client", "Nothing, it can act freely".
5. Ask who it is for: a specific team, a department, or everyone.
6. Then set "done": true, write a short closing message telling them you have made them a checklist and they can work through it in any order, and produce "config".

IMPORTANT: do not ask for a website. Do not ask what kind of business it is. Do not ask for an address or opening hours. None of that applies here.

If they ask for something this assistant cannot do, say so plainly rather than agreeing.

In "config":
- "assistantName": a short name for this assistant, based on the job (e.g. "IT Helpdesk", "People Ops"). If they gave a name, use theirs.
- "job": their description of what it should handle, in their own words. Keep their phrasing.
- "channel": one of "teams", "slack", "web".
- "systems": array of { "name": string, "why": string } — the systems the job needs and what it would do there. Use the names THEY confirmed. Empty array if genuinely none.
- "approvals": array of short strings, the actions that must be held for a person. Empty array if they said it can act freely.
- "serves": who it is for, in a few words.
- "personality": 2-3 sentences on how it should talk to their colleagues. Internal tools should be direct and efficient. Reflect anything they said about tone.
- "assistantPrompt": the ENGLISH knowledge and instructions this assistant works from. Fold in the job, who it serves, the systems it will use and what it should do in each, and the approval rules stated as rules it must follow. Be specific: this is the assistant's brief from day one.
- "suggestionChips": 3-4 short things a COLLEAGUE might tap to start, fitting this job.
- "greeting": a short opening line it says to a colleague.

Respond with ONLY a JSON object of this exact shape (no markdown, no code fences):
{"reply": string, "chips": string[], "done": boolean, "config"?: {"assistantName": string, "job": string, "channel": "teams"|"slack"|"web", "systems": [{"name": string, "why": string}], "approvals": string[], "serves": string, "personality": string, "assistantPrompt": string, "suggestionChips": string[], "greeting": string}}

If the transcript is empty (first turn), welcome them briefly and ask question 1, with its chips.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { messages?: { role?: string; text?: string }[]; email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const transcript = messages.length === 0
    ? "[The conversation is just starting — no messages yet.]"
    : messages.map((m) => `${m.role === "owner" ? "Them" : "You"}: ${String(m.text ?? "")}`).join("\n");
  const known = body.email
    ? `\n\n[Their account email is already ${body.email} — don't ask for it again.]`
    : "";

  const out = await generateStructured(SYS, `${transcript}${known}\n\nWrite your next turn as JSON.`);
  if (!out || typeof out.reply !== "string") {
    return json({ reply: "Sorry, I didn't catch that. Could you say it once more?", chips: [], done: false });
  }

  return json({
    reply: out.reply,
    chips: Array.isArray(out.chips) ? out.chips.slice(0, 5).map(String) : [],
    done: out.done === true,
    config: out.done === true ? (out.config ?? null) : null,
  });
});
