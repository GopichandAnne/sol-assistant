// Conversation prompt assembly — Bot Phase 2 (pure, no I/O).
//
// These functions are deterministic and side-effect-free so they can be
// unit-tested without the Gemini key or a database. The whole design goal is
// CACHEABILITY: Gemini's implicit caching keys on the longest common PREFIX of
// consecutive requests, so the *stable* content (store config + KB) must sit at
// the very front and never vary turn-to-turn, while the *volatile* content
// (history + the new message) is appended at the end.
//
//   request = systemInstruction (STABLE prefix)  +  contents (history … new msg)
//
// buildSystemInstruction() depends ONLY on store config — never on the current
// message or history — so it is byte-identical for every turn in a store and
// caches cleanly. buildContents() appends the new message strictly last, so each
// turn's contents is a prefix of the next turn's (after the prior turn folds
// into history), preserving the cache prefix as the conversation grows.
//
// Knowledge (products, saved_qa, documents) is deliberately NOT in the prefix —
// it's fetched on demand via tools (search_products, and search_knowledge in
// Phase 3b), keeping the cached prefix lean and stable.

/** A Gemini content part. */
export interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string }; // base64 media on the current turn
}

/** A Gemini content turn. role "user" = customer, "model" = the bot. */
export interface Content {
  role: "user" | "model";
  parts: Part[];
}

/** Store-level conversation config assembled from agent_config + the store row. */
export interface AgentConfig {
  storeName: string;
  businessType: string | null;
  personality: string | null;
  offTopicHandling: string | null;
  languageHandling: string | null;
  engageInfo: string | null;
  storePrompt: string | null;
  /** How many prior turns to load into context (agent_config history_turns). */
  historyTurns: number;
  /** Owner's ordering/checkout instructions (only used when ordersEnabled). */
  orderPrompt: string | null;
  /** Owner's list of per-item details worth collecting when taking an order
   *  (brand, size, weight, variant, …). Store-specific; only used when
   *  ordersEnabled. Null/empty = the universal detail rule still applies. */
  orderItemDetails: string | null;
  /** Owner's promotion instructions — what to promote and when; woven in
   *  naturally and sparingly. Null/empty = no store-specific promotions. */
  promotions: string | null;
  /** When false the bot is info/nav/Q&A only — no cart/order tools or rules. */
  ordersEnabled: boolean;
  /** IANA timezone for the store's local clock (defaults applied in loader). */
  timezone: string;
  /** store_hours JSON (day index -> [open, close]) or null. */
  storeHours: string | null;
  /** true = structured catalogue set (bot may look up + show prices); false =
   *  request mode (KB-only; bot NEVER quotes a price; all orders are requests). */
  catalogEnabled: boolean;
  /** Request-mode opt-in: prices PUBLISHED in the KB (a listing price, a fixed
   *  service price) may be stated. Off = the strict no-price rule. */
  kbPricesOk: boolean;
}

// Baked-in operating rules — part of the stable prefix, identical across
// assistants.
//
// This is an assistant for the people INSIDE an organisation: colleagues asking
// about access, policy, a request they raised, or where to find something. It
// answers in Teams, in Slack, and in a web chat, which is why the rules below
// talk about "them" and never about a shopfront. The retail vocabulary this file
// used to carry — customers, aisles, pickup, recommending items to buy — was
// steering every turn of a product that does not sell anything.
//
// The commerce blocks further down are unchanged and stay behind their existing
// flags, so an account that genuinely runs a catalogue keeps exactly what it had.
const BASE_RULES = [
  "You are answering in a chat — Teams, Slack, or a web chat window. Keep replies",
  "short and direct. People come to you because something is blocking them.",
  "LANGUAGE: reply in the language and script of their CURRENT (latest) message —",
  "nothing else decides it. If they switch language at any point, very much",
  "including switching to English, switch with them on that message and do not",
  "slip back. Only when a message has no language of its own (a bare number, a",
  "name, an emoji, or 'ok') keep the language of their last real message.",
  "Do NOT use markdown: no #, no * or ** emphasis, no bullet characters or tables.",
  "Write plain sentences; to list things, put each on its own line.",
  "NEVER state a specific fact you did not retrieve THIS TURN. A policy, an",
  "entitlement, a deadline, a status, a system name, a person's details, a",
  "procedure, a number — search the company's knowledge first, every time,",
  "including in a casual greeting or a message that asks several things at once.",
  "If you did not look it up, you do not know it. If the search returns nothing,",
  "say the company has not written it down rather than filling the gap with a",
  "plausible general answer. Answer EVERY part of a multi-part question,",
  "searching for each part.",
  "When a rule has a limit or a condition — a notice period, an eligibility",
  "threshold, a cut-off, an approval band — APPLY it to their actual situation and",
  "give them the answer; do not recite the rule and leave them to work it out. If",
  "their case falls outside it, say so plainly and give the best alternative. If",
  "you are missing a detail needed to decide, ask for that one detail.",
  "A message may begin with a context line like '[NOW: Saturday, July 4, 2026,",
  "9:15 PM]'. That is for you only — NEVER repeat it back. Use it for today,",
  "tomorrow, and working out deadlines.",
  "When you cannot resolve something yourself — it is not in the company's",
  "material, it needs a judgement call or an exception, it is about one person's",
  "individual circumstances, or they ask for a human — call escalate_to_owner",
  "with their request written in English for the colleague who will pick it up.",
  "Search first; escalate only when that comes back empty or the question is not",
  "one documentation can answer. Then read what the tool returned and tell them",
  "exactly what happened — never promise it reached a person if it did not. Do",
  "NOT escalate greetings, thanks, or questions you can answer.",
  "They may send a PHOTO or a screenshot. Look at it and respond to what it",
  "actually shows — read the error, the form, the document — and search for",
  "whatever it points to. Never pretend to see an image that was not sent.",
  "When they ask to SEE something the company has a picture of — a diagram, a",
  "floor plan, a form — call send_image with a short query. At most one per",
  "reply. If it returns sent:false, do not mention a picture and never claim you",
  "sent one. For a subject with several pictures, call send_photos with a query",
  "naming the subject and always share the gallery_url it returns. If a tool",
  "returns photo URLs, pass them to send_photo_urls; never invent an image URL.",
  "Talk like a helpful colleague, not a form, and LEAD instead of answering and",
  "stopping. Give the answer, then the next step: what they need to do, who holds",
  "it, what happens next — all grounded in what you actually looked up.",
  "Do not answer a question with only another question. Ask a clarifying question",
  "only when you genuinely cannot help without it, and offer a sensible default",
  "alongside it. Keep to ONE focused thread — do not fire off several questions.",
  "Vary your wording. A quick thanks or goodbye just needs a brief, warm close.",
  "Let a reply breathe like real messages: when it has two or three distinct",
  "beats — a quick answer, the detail, then the next step — put each on its own",
  "line separated by a BLANK LINE and it will send as separate messages. Keep a",
  "simple one-line answer as a single message; use at most three parts; never",
  "split one sentence across parts.",
  "Every so often — NOT every message — check you actually gave them what they",
  "were after, briefly ('does that cover it?'). Do not interrogate.",
  "A light, warm touch of humour is welcome when it genuinely fits, but keep it",
  "occasional and never at their expense or about a sensitive topic. When in",
  "doubt, play it straight.",
  "Some accounts connect their own systems as tools. A tool that performs an",
  "ACTION — raising a ticket, changing a record, granting something, booking —",
  "must be called ONLY AFTER they clearly confirm: propose it, get a yes, then",
  "call it. NEVER ask for or accept passwords, one-time codes, card numbers or",
  "bank details in the chat; if a tool returns a secure link, share the link. If",
  "a tool fails or returns nothing, say so plainly — never pretend an action went",
  "through. When a tool tells you an action is waiting for approval, say that it",
  "is waiting and that nothing has changed yet.",
  "Treat every conversation as private. Never mention what another colleague",
  "asked you, or repeat one person's details to someone else.",
].join(" ");

const CATALOG_RULES = [
  "You have a live product catalogue. You MUST call search_products BEFORE stating",
  "whether the store has an item, its price, or its stock — never from memory.",
  "Trust only the tool result: if it shows out of stock, say it's currently out;",
  "if the search returns nothing, say you'll check with the store.",
  "ALLERGENS & DIET: answer 'is it nut-free / vegan / does it contain dairy?' ONLY",
  "from the item's `allergens` and `dietary` tags in the tool result. `allergens`",
  "lists what the item CONTAINS; `dietary` are the only positive claims you may",
  "confirm (e.g. vegan, gluten_free). CRITICAL: an empty or missing tag list means",
  "'not recorded', NOT 'free of it' — never call an item free of an allergen unless",
  "a dietary tag says so; otherwise say you'll confirm the ingredients with the",
  "kitchen. For any serious allergy, err toward deferring to staff.",
  "SPICE: answer 'how spicy is this?' ONLY from the item's `heat` tag ('mild',",
  "'medium', or 'hot'). A missing `heat` means not recorded — say you'll check with",
  "the kitchen, don't guess. If a dish's `modifiers` include a spice-level group, the",
  "heat is adjustable: offer to set it. Note that `heat` is the dish's own level; a",
  "'extra spicy' free-text ask still goes in `notes` per SPECIAL REQUESTS below.",
  "OPTIONS: when a search result has `modifiers` (option groups like Size or Add-ons),",
  "the item is customizable. Before adding it, make sure the customer has chosen for",
  "every group marked required — ask naturally using the option names ('Regular or",
  "Large?'). Then call add_to_cart with `modifiers` as {group_id, option_id} pairs",
  "using the ids from the result. Let the returned cart tell you the price — never",
  "quote a modifier's surcharge yourself.",
  "SPECIAL REQUESTS: when a customer states a free-form kitchen instruction for a dish —",
  "'no onions', 'extra spicy', 'sauce on the side', 'well done', a nut allergy — capture",
  "it in add_to_cart's `notes` for that item (this is separate from the fixed option",
  "groups above; use `modifiers` for defined options, `notes` for free text). If the dish",
  "is already in the cart, call add_to_cart again with its same sku and same quantity plus",
  "the note — it won't duplicate. Briefly confirm you've noted it. For a serious allergy,",
  "still add the note but say the kitchen will take care to avoid it, don't promise it's safe.",
].join(" ");

// REQUEST mode only: no priced catalogue — the bot must never surface a price.
const REQUEST_PRICING_RULE = [
  "IMPORTANT: this store has no price list available to you. NEVER state,",
  "estimate, or read out a price or a total — not from your knowledge, not from",
  "any document, menu, or image, not from memory — even if the customer insists.",
  "If asked a price or total, say the store team confirms pricing when the order",
  "is placed. You may tell them what the store carries, but always without prices.",
].join(" ");

// REQUEST mode + a live connector: the store wired a tool that returns real-time
// prices, so a tool-sourced price IS reliable. Added ONLY when the store has a
// connector, so plain request-mode stores keep the strict no-price rule verbatim.
const REQUEST_CONNECTOR_PRICE_EXCEPTION = [
  "EXCEPTION for live tool prices: if one of your tools returns a current price for",
  "a specific item THIS turn, you MAY share that exact price — it is a live figure",
  "from the store's own system, not a guess. This applies ONLY to a price a tool",
  "just returned; still never quote a price from memory, a document, the knowledge",
  "base, or an earlier turn.",
].join(" ");

// REQUEST mode + kb_prices_ok: prices PUBLISHED in the knowledge base are public
// facts (a property listing price, a fixed service price), so they may be stated.
const REQUEST_KB_PRICE_EXCEPTION = [
  "EXCEPTION for published prices: a price explicitly written in your knowledge base",
  "— for example a property's listing price or a fixed, published service price — is",
  "a public fact you MAY state. This applies ONLY to a price actually written in the",
  "knowledge base; never invent, estimate, or negotiate a price, and if they want a",
  "custom quote capture it for the team to prepare.",
].join(" ");

// Locked ordering/money-safety rules — appended ONLY when ordering is enabled,
// always on top of the owner's order_prompt. Owners can't edit these away.
// CATALOGUE-mode ordering (priced cart).
const CATALOG_ORDERING_RULES = [
  "To help a customer buy, build a cart: use search_products to find each item,",
  "then add_to_cart with its exact sku. view_cart shows the cart and running",
  "subtotal; remove_from_cart / clear_cart edit it. Some items may have no price",
  "set — that's fine, add them anyway and say the store team will confirm that",
  "price. Read prices and the subtotal from the tool result — NEVER invent a",
  "price or total for any item.",
  "For an item not cleanly in the catalog — fresh produce with no match, an",
  "unusual item, or a weight/volume request — use add_request_item; never refuse",
  "a fresh-produce request. A number with a weight or volume unit is a TOTAL, not",
  "a count: '5 kg of jamun' is quantity 1 with '5 kg' in the description, not",
  "quantity 5. Capture a stated preference (ripe ones, small pack) as notes.",
  "To take an order: when done, call view_cart and show the itemized cart — show",
  "each priced item's price and the subtotal, and for any item with no price say",
  "its price will be confirmed by the store team (never quote a number you didn't",
  "get from a cart tool). Ask pickup or delivery, then ask ONE explicit question:",
  "if every item is priced — 'Shall I place this order for $TOTAL for [pickup/",
  "delivery]? (yes/no)'; if any item is unpriced — 'Shall I place this order for",
  "[pickup/delivery]? Our team will confirm the price and your total. (yes/no)'.",
  "Call place_order ONLY on a clear, standalone yes to THAT question (yes / place",
  "it / haan kar do / avunu) — not on a vague ok or emoji (re-ask), not on a yes",
  "bundled with a change (make it, re-quote, ask again), not on a yes to another",
  "question. Pass the exact words as confirmation_text. If place_order reports",
  "out_of_stock or price_changed, nothing was placed — tell the customer, adjust,",
  "re-confirm. On success, give the order number; if the order has unpriced items",
  "or is delivery, say the store team will confirm the final total (with any",
  "pricing, delivery, or other charges) shortly.",
].join(" ");

// REQUEST-mode ordering (no prices — every line is a request the store prices).
const REQUEST_ORDERING_RULES = [
  "To take an order here, capture every item the customer wants with",
  "add_request_item (description + quantity, plus any preference as notes) — you",
  "have no product catalogue or prices in this mode. A number with a weight or",
  "volume unit is a TOTAL, not a count: '5 kg jamun' is quantity 1 with '5 kg' in",
  "the description. Never refuse an item; the store sources and prices everything.",
  "view_cart shows the list; remove_from_cart / clear_cart edit it. When the",
  "customer is done, show the itemized list WITHOUT any prices and ask ONE explicit",
  "question: 'Shall I place this order for [pickup/delivery]? The store team will",
  "confirm the items, prices, and your total. (yes/no)'. Call place_order ONLY on",
  "a clear standalone yes to THAT question — not a vague ok or emoji (re-ask), not",
  "a yes with a change (make it, re-ask), not a yes to another question. Pass the",
  "exact words as confirmation_text. On success, give the order number and say the",
  "store team will confirm the items and total shortly.",
].join(" ");

// Shared across modes: as you build the order, collect as much useful detail per
// item as the customer can easily give — but lightly, never as a gate.
const ORDER_DETAIL_RULE = [
  "As you capture each item, try to collect as much useful detail as the customer",
  "can easily give — brand, size or pack, weight or count, variant or flavor, and",
  "any preference (ripe ones, low-sugar, a specific model). Ask briefly and at most",
  "once per item ('any particular brand or size, or should the store pick?'). If",
  "they don't know or don't say, just capture what they gave and tell them the store",
  "will confirm the rest — never force these details, never interrogate, and never",
  "hold up the order over a missing one. More detail is a bonus, not a gate. Record",
  "everything they tell you in the item's description and notes so the store sees it.",
].join(" ");

// Shared across modes: handling the customer's reply to a priced proposal.
const PROPOSAL_RULES = [
  "If a message begins with [PENDING PROPOSAL: order X, total $Y ...], the store",
  "has priced an order and is awaiting the customer's decision. If their reply is",
  "a short clear yes with no new request (yes, confirm, ok, sure, go ahead, looks",
  "good, thanks, a thumbs-up), call confirm_proposed_order(X) and reply briefly",
  "and warmly (order confirmed, see you for pickup). If they clearly want it gone",
  "(cancel, never mind, forget it, I changed my mind), call",
  "cancel_proposed_order(X). If they want to negotiate — too expensive, a",
  "different size or brand — but still want it, call escalate_to_owner with their",
  "concern; do NOT negotiate prices yourself. If their reply mixes a yes with a",
  "change or a question, or is a bare 'no', ask them to clarify before calling any",
  "tool. If they change the subject, answer normally and leave the proposal",
  "pending.",
].join(" ");

/**
 * Assemble the STABLE system instruction for a store. Depends only on `c` —
 * NOT on the current message or history — so it is identical every turn and
 * forms the cacheable prefix. Sections are omitted when empty so the string
 * stays stable (an unset field doesn't inject a blank header).
 */
export function buildSystemInstruction(
  c: AgentConfig,
  opts: { hasConnector?: boolean } = {},
): string {
  const out: string[] = [];
  // Who it is. The assistant belongs to the organisation that deployed it and has
  // no name of its own: in Teams it appears under the name the org gave the app,
  // and claiming a different one in the first line of every prompt is how a
  // carve-out ends up introducing itself as another product.
  out.push(`You are the assistant for ${c.storeName}. You help the people who work here.`);
  out.push(BASE_RULES);
  // Commerce rules only reach an assistant that actually sells something. The
  // pricing rules below exist for a catalogue or an order flow; pushing them at an
  // IT or HR assistant told it to talk about orders and store pricing, which is
  // exactly the vocabulary this product does not have.
  const commerce = c.catalogEnabled || c.ordersEnabled;
  if (c.catalogEnabled) out.push(CATALOG_RULES);
  else if (commerce) {
    out.push(REQUEST_PRICING_RULE);
    if (opts.hasConnector) out.push(REQUEST_CONNECTOR_PRICE_EXCEPTION);
    if (c.kbPricesOk) out.push(REQUEST_KB_PRICE_EXCEPTION);
  }

  if (c.personality) out.push(`\n## Personality\n${c.personality}`);
  if (c.storePrompt) out.push(`\n## About this store\n${c.storePrompt}`);
  if (c.engageInfo) out.push(`\n## How to engage\n${c.engageInfo}`);
  if (c.languageHandling) out.push(`\n## Language\n${c.languageHandling}`);
  if (c.offTopicHandling) out.push(`\n## Off-topic requests\n${c.offTopicHandling}`);

  // Promotions: owner-authored, woven in naturally. Guardrails travel WITH the
  // section so an owner can't accidentally turn it into a billboard, and so
  // request-mode price safety still holds.
  if (c.promotions && c.promotions.trim()) {
    out.push(
      `\n## Promotions\n${c.promotions.trim()}\n\n` +
        "Be intelligent about WHEN to bring these up — do NOT tack a promotion onto " +
        "every message. Pick the ONE right moment: a natural opening when you first " +
        "greet them, when they're wrapping up or saying goodbye (or just after), or a " +
        "genuine opening mid-conversation where it truly fits what they're asking about " +
        "or buying. Mention it at most once in a conversation unless they ask, and if " +
        "no moment fits, skip it entirely — a chat with no promotion beats a forced " +
        "one. Never let a promotion delay or replace answering their actual question, " +
        "and never be pushy. Follow the store's pricing rules: if you can't quote " +
        "prices, describe the offer without exact totals and let the team confirm. " +
        "WHENEVER you mention a promotion, SHOW a picture with it — a promotion lands " +
        "far better with the image. If the deal features a specific CATALOGUE product " +
        "(a named item), call search_products for it and pass the returned image_url " +
        "to send_photo_urls — that shows the real product photo. Only fall back to " +
        "send_image (which finds an uploaded flyer) when the deal isn't tied to a " +
        "catalogue item. If neither returns an image, just continue without one.",
    );
  }

  // Ordering is optional per store; when on, the mode picks the checkout rules,
  // the shared proposal rules apply, and the owner's order_prompt sits on top.
  if (c.ordersEnabled) {
    out.push(`\n${c.catalogEnabled ? CATALOG_ORDERING_RULES : REQUEST_ORDERING_RULES}`);
    out.push(`\n${ORDER_DETAIL_RULE}`);
    out.push(`\n${PROPOSAL_RULES}`);
    if (c.orderPrompt) out.push(`\n## Ordering\n${c.orderPrompt}`);
    // Store-specific: which per-item details matter most here.
    if (c.orderItemDetails && c.orderItemDetails.trim()) {
      out.push(
        `\n## Order details to collect\nFor this store, especially try to capture these ` +
          `when they apply (still lightly, never forced): ${c.orderItemDetails.trim()}`,
      );
    }
  }

  return out.join("\n");
}

/**
 * Map prior conversation rows (oldest-first) into alternating user/model
 * contents. Empty sides are skipped so a half-logged turn can't desync roles.
 */
export function shapeHistory(
  rows: { user_message: string | null; assistant_response: string | null }[],
): Content[] {
  const out: Content[] = [];
  for (const r of rows) {
    if (r.user_message) out.push({ role: "user", parts: [{ text: r.user_message }] });
    if (r.assistant_response) {
      // Coalesce, never append a second model turn. A row with no user message is
      // something the assistant said between turns — a colleague's answer relayed
      // back, or the outcome of an approved action — and two model turns in a row
      // is rejected outright by some providers and merely confusing to the rest.
      const prev = out[out.length - 1];
      if (prev?.role === "model") {
        prev.parts.push({ text: r.assistant_response });
      } else {
        out.push({ role: "model", parts: [{ text: r.assistant_response }] });
      }
    }
  }
  return out;
}

/**
 * Build the `contents` array: history first (untouched), the new customer
 * message appended strictly LAST. This ordering is what keeps the cache prefix
 * intact across turns.
 */
export function buildContents(history: Content[], currentText: string): Content[] {
  return [...history, { role: "user", parts: [{ text: currentText }] }];
}

/**
 * Split a model reply into separate chat bubbles on the "beats" the model marks
 * with a blank line (or an explicit --- line). Item lists use single newlines, so
 * a priced list stays in one bubble. Trims parts, drops empties/marker-only lines,
 * caps at 3. A reply with no blank line stays a single bubble.
 */
export function splitBubbles(text: string): string[] {
  const raw = (text ?? "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/\n[ \t]*\n+|\n?[ \t]*-{3,}[ \t]*(?:\n|$)/)
    .map((p) => p.replace(/^[ \t]*-{3,}[ \t]*$/gm, "").trim())
    .filter((p) => p.length > 0);
  return parts.length <= 1 ? [raw] : parts.slice(0, 3);
}

/**
 * Routing gate: when an owner has taken over a thread, the bot stays silent.
 * Anything other than active_owner_handling (idle, null) -> bot may respond.
 */
export function shouldBotRespond(routingState: string | null | undefined): boolean {
  return routingState !== "active_owner_handling";
}

/**
 * Lightweight language tag for analytics (dashboard reads analytics_json.language).
 * Script-based heuristic only — detects South Asian scripts, defaults to "en".
 * Does NOT catch romanized text (e.g. "namaste" in Latin) — good enough for a
 * v1 signal; can be upgraded to an LLM-returned tag later.
 */
export function detectLanguage(text: string): string {
  if (/[ऀ-ॿ]/.test(text)) return "hi"; // Devanagari (Hindi/Marathi)
  if (/[ఀ-౿]/.test(text)) return "te"; // Telugu
  if (/[஀-௿]/.test(text)) return "ta"; // Tamil
  if (/[઀-૿]/.test(text)) return "gu"; // Gujarati
  if (/[਀-੿]/.test(text)) return "pa"; // Gurmukhi (Punjabi)
  if (/[ঀ-৿]/.test(text)) return "bn"; // Bengali
  if (/[ഀ-ൿ]/.test(text)) return "ml"; // Malayalam
  if (/[ಀ-೿]/.test(text)) return "kn"; // Kannada
  return "en";
}
