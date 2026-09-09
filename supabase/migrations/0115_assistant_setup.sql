-- ═══════════════════════════════════════════════════════════════════════════
-- 0115 — assistant_setup: what the onboarding conversation agreed to
--
-- The interview used to end by writing a finished configuration and walking away.
-- For an assistant that has to reach real systems, most of the setup CANNOT be
-- finished during a chat: connecting a system needs credentials or an OAuth
-- consent the person onboarding often does not have to hand, and deploying to
-- Teams needs an admin. An interview that ends "now go get an API key" simply
-- dead-ends, and the assistant sits empty.
--
-- So the conversation records a PLAN here, and the console turns it into a
-- checklist the owner can finish over days, with other people, in any order.
-- Nothing in this table is load-bearing for the engine: it drives the checklist
-- and nothing else, so a half-finished plan degrades to a shorter list rather
-- than a broken assistant.
--
-- Service-role only (RLS on, no client policies) — read through the admin client,
-- same posture as the rest of the console's server-side reads.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.assistant_setup (
  store_id    uuid primary key references public.stores(id) on delete cascade,

  -- The job, in the owner's own words. Kept verbatim rather than classified into
  -- an enum: the useful detail ("chase overdue timesheets before payroll") is
  -- exactly what an enum would throw away, and the previous interview's
  -- business-type enum is a standing reminder of that.
  job         text,

  -- Where people will actually talk to it: 'teams' | 'slack' | 'web'.
  channel     text,

  -- Systems the job implies, derived in conversation rather than asked cold.
  -- [{ "name": "Jira", "why": "raise and check tickets" }]
  systems     jsonb not null default '[]'::jsonb,

  -- Actions the owner said must never happen without a person. These become the
  -- argument for setting action_policy='hold' on the matching tools once those
  -- tools exist, which is why they are recorded as intent, not as policy.
  -- ["granting admin access", "anything that emails a client"]
  approvals   jsonb not null default '[]'::jsonb,

  -- Who it is for: a team, a department, or everyone.
  serves      text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.assistant_setup enable row level security;
