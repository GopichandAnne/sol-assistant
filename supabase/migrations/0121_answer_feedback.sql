-- ═══════════════════════════════════════════════════════════════════════════
-- 0121 — knowing when it was wrong
--
-- The most common reason these projects are abandoned is not that the model is
-- wrong. It is that nobody can tell WHEN it is wrong: the output looks equally
-- confident either way, and regression tests do not catch it. Owners are asked to
-- trust something they cannot inspect, and eventually stop.
--
-- The audit log answers "what did it do". Nothing answered "was it right", and
-- the only people who reliably know are the colleagues reading the answers. So
-- the assistant listens for them saying so.
--
-- Recorded from a TOOL rather than a button, deliberately. A thumbs-down control
-- would need a surface in Teams, in Slack and on the web, would clutter every
-- message, and would still be ignored. People already say "that's wrong" in
-- their own words; the assistant recognising that and writing it down works in
-- every channel and needs no interface at all.
--
-- The exchange is stored with the complaint. A report saying only "someone was
-- unhappy" is not actionable; the question and the answer are the thing a person
-- needs in order to fix the knowledge behind it.
--
-- Service-role only (RLS on, no client policies).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.answer_feedback (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  session_id  text,
  channel     text,                  -- web | teams | slack, so patterns per surface show up
  question    text,                  -- what was asked
  answer      text,                  -- what it said
  note        text,                  -- what the person said was wrong, in their words
  reported_by text,                  -- their email when we know it, else null
  status      text not null default 'open' check (status in ('open', 'reviewed')),
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

create index if not exists answer_feedback_store_status
  on public.answer_feedback (store_id, status, created_at desc);

alter table public.answer_feedback enable row level security;
