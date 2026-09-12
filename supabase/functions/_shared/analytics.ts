// Turn analytics — what the assistant learns about its own coverage.
//
// Runs AFTER the reply is sent (best-effort), so it never adds latency. Falls
// back to the script-based language guess if the key is missing or the call fails.
//
// This used to classify "a message from a customer to a store's shopping
// assistant", extracting product names and what was out of stock. Carried over
// from the retail engine, it meant the two panels on Home — what people ask most,
// what it could not answer — were showing product names and stock gaps for an
// assistant that answers HR and IT questions. The panels were not mislabelled;
// the model was being asked the wrong question, so the data underneath was wrong.
//
// What it asks now is the question an operator actually has: what did this person
// want, did they get it, and if not, what was missing. That last field is the
// whole point — "no source of truth" is a knowledge gap, "needs a system" is an
// integration to build, and "needs a person" may be a procedure worth automating.
// Those are three different pieces of work, and lumping them together as "could
// not answer" tells nobody what to do next.

import { detectLanguage } from "./prompt.ts";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";

export async function classifyTurn(
  userMessage: string,
  assistantReply: string,
): Promise<Record<string, unknown>> {
  const fallback = { language: detectLanguage(userMessage) };
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return fallback;
  const model = Deno.env.get("GEMINI_MODEL") ?? DEFAULT_MODEL;

  const prompt =
    "Classify one exchange between a person at an organisation and its internal " +
    "assistant, from the person's message and the assistant's reply.\n" +
    "- topic: the area of work this belongs to — IT, HR, Finance, Facilities, " +
    "Legal, Sales, Engineering, Operations, or Other. One word.\n" +
    "- ask: what they actually wanted, as a short generic phrase in lower case, " +
    "with names, dates, ticket numbers and other specifics REMOVED so that two " +
    "people asking the same thing produce the same phrase. " +
    "\"how do I reset my MFA\" and \"MFA reset for Priya\" are both \"reset mfa\". " +
    "Empty for greetings and small talk.\n" +
    "- resolved: true only if the assistant actually gave them what they needed. " +
    "False if it said it did not know, could not check, would find out, or handed " +
    "them to a person.\n" +
    "- gap_reason: when resolved is false, the single reason why — " +
    "\"no_source\" (the answer is not in anything it has been given), " +
    "\"needs_system\" (it would have to look in or change another system), " +
    "\"needs_person\" (a judgement or approval only a human can give), " +
    "\"unclear\" (the question was too vague to answer), " +
    "\"out_of_scope\" (not something this assistant is for). " +
    "Use \"none\" when resolved is true.\n" +
    "- repeatable: true if this is routine work that recurs — the kind of request " +
    "many people make many times. False for one-offs and novel questions.\n" +
    "- sentiment: overall tone (positive / neutral / negative).\n" +
    "- frustrated: true if they sound annoyed, impatient or blocked.\n" +
    "- language: the language they wrote in, detecting romanized text too.\n" +
    `Person's message: ${userMessage}\n` +
    `Assistant reply: ${assistantReply}`;

  try {
    const res = await fetch(`${API_BASE}/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 800,
          thinkingConfig: { thinkingBudget: 128 }, // 0 now 400s on gemini-flash-latest
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              topic: { type: "string" },
              ask: { type: "string" },
              resolved: { type: "boolean" },
              gap_reason: {
                type: "string",
                enum: ["none", "no_source", "needs_system", "needs_person", "unclear", "out_of_scope"],
              },
              repeatable: { type: "boolean" },
              sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
              frustrated: { type: "boolean" },
              language: { type: "string" },
            },
            required: ["topic", "ask", "resolved", "gap_reason", "repeatable", "sentiment", "frustrated", "language"],
          },
        },
      }),
    });
    if (!res.ok) return fallback;
    // deno-lint-ignore no-explicit-any
    const json: any = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
