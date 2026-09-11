/**
 * `from()` for tables the generated Database type doesn't know about.
 *
 * Several tables — the channel installs, routing, feedback — are created by
 * migrations that postdate the last type generation, so a typed client refuses
 * them at compile time. The cast has to live somewhere; it lives here, once,
 * with the reason why it is shaped like this.
 *
 * The shape matters. The obvious version detaches the method:
 *
 *     const from = db.from as unknown as (t: string) => any;   // throws
 *
 * supabase-js declares `from()` on the prototype and its body is
 * `return this.rest.from(relation)`. Pulled off the object it loses its
 * receiver, and the first call fails with "Cannot read properties of undefined
 * (reading 'rest')" — a message that names an internal field and so reads like a
 * broken client or a bad key, not like the one-line mistake it is. Worse, the
 * error surfaces wherever the query was, which in a console meant every panel
 * reporting itself unconfigured at once.
 *
 * Calling through the object keeps the receiver, and cannot be written wrongly.
 */
// deno-lint-ignore no-explicit-any
export function untyped(db: unknown): (table: string) => any {
  // deno-lint-ignore no-explicit-any
  const client = db as { from: (table: string) => any };
  return (table: string) => client.from(table);
}
