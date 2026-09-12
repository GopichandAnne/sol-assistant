-- ═══════════════════════════════════════════════════════════════════════════
-- 0126 — work that starts without anybody typing, and a record of every run
--
-- Until now the only way anything happened was a person sending a message. That
-- is the ceiling on calling this an assistant rather than a chatbot: real
-- operations work starts from a clock, a queue or an event, and nobody is
-- sitting there to ask for it at seven in the morning.
--
-- Two tables.
--
-- agent_trigger — a standing instruction and when to carry it out. Deliberately
--   NOT a cron expression: the people who own these procedures write "every
--   weekday at 9" and should not have to learn five-field syntax to say so. The
--   three shapes here cover what an operations schedule actually needs, and a
--   raw-cron escape hatch can be added the first time one is genuinely required.
--
--   runs_as is the important column. A scheduled run still acts as a NAMED
--   person, so everything downstream — a held action going to an approver, an
--   identity assertion sent to somebody's API, the audit trail — reads exactly as
--   it does when that person asks in Teams. An agent that acts as "the system" is
--   an agent whose actions nobody can be held to, which is the failure this whole
--   product is arranged to avoid.
--
-- agent_run — what happened each time one fired. Approvals and tool calls were
--   already logged individually, but there was no answer to "what has this thing
--   been doing", which is the first question an owner asks and the first slide of
--   any review. Runs carry their own outcome, including the honest one: it ran,
--   and it could not finish.
--
-- Both are service-role only. Triggers are created through owner-gated server
-- actions rather than direct table access, because runs_as decides whose
-- authority the assistant borrows and that is not a field to leave to RLS alone.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.agent_trigger (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  name        text not null,
  -- What to do, in words. Handed to the assistant as the turn's message, so it
  -- reaches exactly the same tools, knowledge and holds as a typed request.
  instruction text not null,
  -- 'hourly' | 'daily' | 'weekdays'. at_hour is ignored by 'hourly'.
  schedule    text not null check (schedule in ('hourly', 'daily', 'weekdays')),
  at_hour     smallint not null default 9 check (at_hour between 0 and 23),
  -- Whose authority it borrows. An address, matched the same way a person's is.
  runs_as     text not null,
  active      boolean not null default true,
  last_run_at timestamptz,
  -- The claim key. A row is due when this is in the past; the runner rewrites it
  -- before doing any work, so two overlapping ticks cannot run it twice.
  next_run_at timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists agent_trigger_due_idx
  on public.agent_trigger (active, next_run_at);
create index if not exists agent_trigger_store_idx
  on public.agent_trigger (store_id);

comment on column public.agent_trigger.runs_as is
  'The person a scheduled run acts as. Everything it does is attributed here.';

create table if not exists public.agent_run (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores(id) on delete cascade,
  -- Kept when the trigger is deleted: the record of what ran must outlive the
  -- thing that scheduled it, or an owner can erase the evidence by tidying up.
  trigger_id   uuid references public.agent_trigger(id) on delete set null,
  trigger_name text not null,
  runs_as      text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  -- 'ok'       — it ran and finished
  -- 'held'     — it ran and something it tried needs a person to approve
  -- 'error'    — it could not finish
  status       text not null default 'ok' check (status in ('ok', 'held', 'error')),
  -- What it said, in full. Short enough to read, which is the point of a ledger.
  detail       text,
  tools_used   integer not null default 0,
  actions_held integer not null default 0
);

create index if not exists agent_run_store_idx
  on public.agent_run (store_id, started_at desc);

alter table public.agent_trigger enable row level security; -- service-role only
alter table public.agent_run enable row level security;     -- service-role only

-- ── Scheduling ────────────────────────────────────────────────────────────
-- Every five minutes, not every minute: these are hourly-or-slower jobs, and a
-- tick that costs nothing still costs something sixty times an hour.
create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'assistant-triggers') then
    perform cron.unschedule('assistant-triggers');
  end if;
end $$;

select cron.schedule(
  'assistant-triggers',
  '*/5 * * * *',
  $cmd$
    select net.http_post(
      url := 'https://sngmxemsfhtkaxwgkwfy.supabase.co/functions/v1/run-triggers',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $cmd$
);

-- ── Repointing two jobs that were calling somebody else's project ─────────
-- 0030 and 0034 carried the URL of the database this engine was forked from, so
-- applying them here scheduled a POST to ANOTHER project's edge functions every
-- minute — traffic aimed at a deployment this one has nothing to do with, and
-- two features that have therefore never run here. Repointed rather than
-- deleted: the functions exist in this project and are wanted.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'rani-followups') then
    perform cron.unschedule('rani-followups');
  end if;
  if exists (select 1 from cron.job where jobname = 'rani-health') then
    perform cron.unschedule('rani-health');
  end if;
end $$;

select cron.schedule(
  'assistant-followups',
  '* * * * *',
  $cmd$
    select net.http_post(
      url := 'https://sngmxemsfhtkaxwgkwfy.supabase.co/functions/v1/followup',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $cmd$
);

select cron.schedule(
  'assistant-health',
  '*/3 * * * *',
  $cmd$
    select net.http_post(
      url := 'https://sngmxemsfhtkaxwgkwfy.supabase.co/functions/v1/health',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $cmd$
);
