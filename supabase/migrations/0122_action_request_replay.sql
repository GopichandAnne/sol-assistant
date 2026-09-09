-- ═══════════════════════════════════════════════════════════════════════════
-- 0122 — an approval that actually completes the action
--
-- 0101 gave a held write an approval request, a notification, and a decision.
-- What it did not give it was the write. Approving recorded a sign-off and
-- stopped there, leaving the owner to go and do the thing by hand in the other
-- system, and leaving the person who asked with no idea it had happened.
--
-- That is the difference between governance and paperwork. For a product whose
-- claim is "it can act in your systems, safely", the approval has to be the
-- moment the action runs — with a person's name against it.
--
-- Replaying a call needs the call. `detail` was written for human eyes (capped,
-- secret-ish keys stripped), so it cannot be replayed from. These columns keep
-- the arguments exactly as the tool received them, plus what happened when it
-- finally ran.
--
-- Arguments are the account's own data, service-role only like the rest of this
-- table, and never shown to another store. Secrets do not appear here: a tool's
-- credentials live on the tool, not in its arguments.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.action_request
  add column if not exists args         jsonb not null default '{}'::jsonb,
  add column if not exists completed    boolean not null default false,
  add column if not exists result_note  text;

comment on column public.action_request.args is
  'The tool call''s arguments, verbatim, so an approval can run the action it approved.';
comment on column public.action_request.completed is
  'True once the approved action actually ran. Approved-but-not-completed means the run failed; the decision stands and it can be retried.';
comment on column public.action_request.result_note is
  'What happened when it ran: a short outcome, or the error if it failed.';
