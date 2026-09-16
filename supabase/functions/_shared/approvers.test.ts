import { assertEquals } from "jsr:@std/assert@1";
import { approverList, approversToNotify } from "./teams.ts";

Deno.test("approverList: the list wins, normalised and de-duplicated", () => {
  assertEquals(
    approverList({ approvals_emails: [" Carlos@X.com", "carlos@x.com", "shivani@x.com"], approvals_email: "old@x.com" }),
    ["carlos@x.com", "shivani@x.com"],
  );
});

Deno.test("approverList: falls back to the single legacy column", () => {
  assertEquals(approverList({ approvals_emails: [], approvals_email: "Carlos@X.com" }), ["carlos@x.com"]);
  assertEquals(approverList({ approvals_emails: null, approvals_email: null }), []);
  assertEquals(approverList(null), []);
});

Deno.test("approversToNotify: the person who asked never gets their own card", () => {
  assertEquals(approversToNotify(["gopi@x.com", "carlos@x.com"], "GOPI@x.com"), ["carlos@x.com"]);
  assertEquals(approversToNotify(["carlos@x.com"], null), ["carlos@x.com"]);
  // A lone approver who is also the asker gets nothing, rather than a card they cannot use.
  assertEquals(approversToNotify(["gopi@x.com"], "gopi@x.com"), []);
});
