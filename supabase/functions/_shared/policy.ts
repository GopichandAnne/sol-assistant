// Whether a write runs on its own, and why.
//
// One place, because three kinds of tool need the same answer and three
// implementations of "is this one big enough to need a person" would disagree
// the first time somebody wrote a number with a currency symbol in front of it.
//
// The rule is deliberately small: below the threshold it runs, at or above it a
// person decides. Everything uncertain holds. A threshold that fails open turns
// "approve anything over five thousand" into "approve nothing" the moment an
// argument arrives named something the owner did not predict, and that failure
// is silent, which is the worst property an authorisation rule can have.

export type ActionRule = {
  /** The tool's standing policy. */
  action_policy?: "auto" | "hold" | null;
  /** Below this the action runs itself. Null means the policy alone decides. */
  auto_below?: number | string | null;
  /** Which argument carries the number the threshold is compared against. */
  amount_field?: string | null;
};

export type Decision = {
  mode: "auto" | "hold";
  /** Plain English, shown to the approver and written into the audit line. */
  reason: string;
  /** The number we read, when we could read one. */
  amount?: number;
};

/**
 * Pull a number out of the call's arguments.
 *
 * Looks at the named field, then inside a `values` object, because a tracker
 * write carries its numbers one level down under column names. Matching ignores
 * case and spaces so that a field called "Amount" is found by a rule written as
 * "amount".
 */
function readAmount(args: Record<string, unknown>, field: string): number | null {
  const want = field.trim().toLowerCase().replace(/\s+/g, "");
  const norm = (k: string) => k.trim().toLowerCase().replace(/\s+/g, "");

  const search: Record<string, unknown>[] = [args];
  const nested = args.values;
  if (nested && typeof nested === "object") search.push(nested as Record<string, unknown>);

  for (const bag of search) {
    for (const [k, v] of Object.entries(bag)) {
      if (norm(k) !== want) continue;
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "string") {
        // Currency symbols, thousands separators and a trailing code are how
        // people and APIs actually write money. Strip them rather than holding a
        // £1,200.00 that was only ever going to be twelve hundred.
        const cleaned = v.replace(/[^0-9.\-]/g, "");
        if (!cleaned || cleaned === "-" || cleaned === ".") return null;
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    }
  }
  return null;
}

/** What should happen to this call. Reads only: callers check side_effect first. */
export function decideAction(rule: ActionRule, args: Record<string, unknown>): Decision {
  const policy = rule.action_policy === "hold" ? "hold" : "auto";
  const limit = rule.auto_below == null || rule.auto_below === "" ? null : Number(rule.auto_below);
  const field = (rule.amount_field ?? "").trim();

  // No threshold configured: the standing policy is the whole answer.
  if (limit == null || !Number.isFinite(limit) || !field) {
    return policy === "hold"
      ? { mode: "hold", reason: "this needs a person to approve it" }
      : { mode: "auto", reason: "" };
  }

  const amount = readAmount(args, field);
  if (amount == null) {
    return {
      mode: "hold",
      reason: `I couldn't read ${field} for this, and anything without it waits for a person`,
    };
  }
  // Compared by size, not by sign. A credit note of -50,000 is every bit as
  // consequential as an invoice of 50,000, and a signed comparison would wave it
  // through for being "below" the limit.
  if (Math.abs(amount) >= limit) {
    return {
      mode: "hold",
      amount,
      reason: `${field} is ${amount}, which is at or above the ${limit} that needs approving`,
    };
  }
  // Below the line it runs even where the standing policy says hold: setting a
  // threshold IS the owner saying small ones are fine.
  return { mode: "auto", amount, reason: "" };
}
