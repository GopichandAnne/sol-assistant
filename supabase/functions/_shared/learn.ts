// Learn-from-escalations — Bot Phase 5b.
// When a teammate answers an escalated question, an LLM decides whether it's a
// reusable FAQ (vs a one-off like "is MY order ready?"), cleans it into a
// general question + store-voice answer, and judges whether it's safe to publish
// automatically. Safe, high-confidence, price-free (in request mode) answers go
// LIVE immediately (active + indexed); anything borderline is saved as an
// inactive draft for the owner to review. Owners can always exclude/edit either.
//
// Runs in the webhook's background task (after the customer already got the
// answer), so the LLM call + re-embed never delay anything customer-facing.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { loadAgentConfig } from "./agent.ts";
import { reindexKnowledge, syncSavedQaToIndex } from "./knowledge.ts";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type LearnOutcome = "auto" | "draft" | "skipped";

interface Verdict {
  keep: boolean;
  question: string;
  answer: string;
  contains_price: boolean;
  auto_approve: boolean;
  reason: string;
}

/** LLM judgment: is this a reusable FAQ, and is it safe to auto-publish? */
async function judge(storeName: string, question: string, answer: string): Promise<Verdict | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return null;
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-latest";

  // The rubric decides what an assistant is allowed to remember, so it has to
  // describe THIS product's world. Written for a retail FAQ ("a customer's
  // question", "the store's products, hours, locations"), it quietly rejected the
  // internal questions this product actually gets, and the same question escalated
  // to a person again the next day \u2014 which is the whole loop failing.
  //
  // The keep/drop line is the same shape as before and is the one that matters:
  // how the organisation works is reusable, one person's own situation is not.
  const sys =
    `You curate the internal knowledge base for ${storeName}. A colleague on the ` +
    "team just answered a question the assistant could not answer on its own. " +
    "Decide whether it should become reusable knowledge the assistant can answer " +
    "with next time. Return STRICT JSON.\n" +
    "keep = true ONLY if the question is a general, reusable question about how " +
    "this organisation works \u2014 a policy, a process, an entitlement, a system, a " +
    "tool, who owns what, how to get something done \u2014 AND the answer is a general " +
    "fact that would help anyone here who asked the same thing.\n" +
    "keep = false for anything about ONE person's own situation: their leave " +
    "balance, their access, their pay, their device, the status of their specific " +
    "request or ticket, a complaint about one incident. Also keep = false if the " +
    "answer contains anyone's personal details, or any password, key, token or " +
    "other credential \u2014 those must never be written into the knowledge base.\n" +
    "If keep = true:\n" +
    "- question: rewrite as a clean, general question anyone here might ask \u2014 " +
    "remove names, ticket numbers, and first-person specifics ('my', 'I').\n" +
    "- answer: rewrite as a concise, factual answer in the organisation's voice. " +
    "Stay accurate to what the colleague said; never invent detail, and never " +
    "soften a limit or a condition.\n" +
    "- contains_price = true if the answer states a specific price, amount, or " +
    "currency figure.\n" +
    "- auto_approve = true ONLY if you are highly confident this is correct, " +
    "general, unambiguous and non-sensitive, and safe to publish automatically. " +
    "Set false when it is borderline, incomplete, sensitive (anything touching pay, " +
    "conduct, someone's employment, or security), or you are unsure \u2014 those go to " +
    "human review.\n" +
    "- reason: one short sentence.\n" +
    "If keep = false, still fill the other fields with best-effort values (they are ignored).";

  try {
    const res = await fetch(`${API_BASE}/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: [{ role: "user", parts: [{ text: `QUESTION: ${question}\nANSWER: ${answer}` }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 600,
          thinkingConfig: { thinkingBudget: 128 }, // 0 now 400s on gemini-flash-latest
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              keep: { type: "boolean" },
              question: { type: "string" },
              answer: { type: "string" },
              contains_price: { type: "boolean" },
              auto_approve: { type: "boolean" },
              reason: { type: "string" },
            },
            required: ["keep", "question", "answer", "contains_price", "auto_approve", "reason"],
          },
        },
      }),
    });
    if (!res.ok) {
      console.error(`[learn] judge ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    // deno-lint-ignore no-explicit-any
    const json: any = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    return JSON.parse(text) as Verdict;
  } catch (e) {
    console.error(`[learn] judge error: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * Turn one answered escalation into knowledge. Returns what happened:
 *  "auto"    -> published live (active + indexed)
 *  "draft"   -> saved inactive for owner review
 *  "skipped" -> not a reusable FAQ, or a duplicate.
 */
export async function learnFromAnswer(
  db: SupabaseClient,
  store: Store,
  rawQuestion: string,
  rawAnswer: string,
  session: string | null,
): Promise<LearnOutcome> {
  const q0 = (rawQuestion ?? "").trim();
  const a0 = (rawAnswer ?? "").trim();
  if (!q0 || !a0) return "skipped";

  const config = await loadAgentConfig(db, store);
  const v = await judge(store.store_display_name ?? store.slug, q0, a0);

  // If the judge is unavailable, fall back to the safe old behavior: a raw draft.
  const keep = v ? v.keep : true;
  if (v) {
    console.log(`[learn] ${store.slug}: keep=${v.keep} auto=${v.auto_approve} \u2014 ${v.reason}`);
  } else {
    console.warn(`[learn] ${store.slug}: judge unavailable, saving a draft for review`);
  }
  if (!keep) return "skipped";
  const question = (v?.question?.trim()) || q0;
  const answer = (v?.answer?.trim()) || a0;

  // Safety: never auto-publish a priced answer in request mode (the bot must not
  // quote prices there). It still goes to review.
  const requestMode = !config.catalogEnabled;
  const autoApprove = !!v?.auto_approve && !(requestMode && v?.contains_price);

  // Dedupe on the cleaned question (case-insensitive).
  const { data: dupe } = await db
    .from("saved_qa")
    .select("id")
    .eq("store_id", store.id)
    .ilike("question", question)
    .limit(1);
  if (dupe && dupe.length > 0) {
    console.log(`[learn] ${store.slug}: already knew "${question}"`);
    return "skipped";
  }

  const { error } = await db.from("saved_qa").insert({
    store_id: store.id,
    question,
    answer,
    source_session: session,
    active: autoApprove,
    category: autoApprove ? "Learned automatically" : "From a conversation",
  });
  if (error) {
    console.error(`[learn] insert: ${error.message}`);
    return "skipped";
  }

  if (autoApprove) {
    // Make it searchable now — same path as the panel's Sync (only re-embeds the
    // small saved_qa set; document chunks aren't stale, so they're untouched).
    try {
      await syncSavedQaToIndex(db, store.id);
      await reindexKnowledge(db, store.id, 200);
    } catch (e) {
      console.error(`[learn] index: ${e instanceof Error ? e.message : e}`);
    }
  }
  return autoApprove ? "auto" : "draft";
}
