-- ═══════════════════════════════════════════════════════════════════════════
-- 0116 — Teams approvals
--
-- Slack has had Approve / Decline buttons since 0107. Teams did not, so a held
-- action raised in Teams created the approval request correctly and then told
-- nobody in the place the work was happening. Governance is the differentiator
-- here, and it was half-wired to the channel most likely to be used.
--
-- Posting proactively into Teams needs a conversation to post INTO, and the Bot
-- Framework only hands you one when a person messages the bot. So teams_user
-- records what we learn on each inbound message: the conversation we can reach
-- that person on, their tenant, and their email once Graph resolves it.
--
-- Why an approver EMAIL rather than a channel, unlike Slack: posting an approval
-- into the conversation where the request was raised would let the requester
-- approve their own held action, which defeats the point. Naming a person is both
-- safer and closer to what an approval actually is.
--
-- Service-role only (RLS on, no client policies).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.teams_user (
  tenant_id       text not null,
  teams_user_id   text not null,            -- the 29:… channel account id
  aad_object_id   text,
  email           text,                     -- via Graph; null until User.Read.All is consented
  name            text,
  service_url     text not null,            -- regional Bot Framework endpoint
  conversation_id text not null,            -- the 1:1 conversation we can reach them on
  last_seen       timestamptz not null default now(),
  primary key (tenant_id, teams_user_id)
);
create index if not exists teams_user_email on public.teams_user (tenant_id, lower(email));
alter table public.teams_user enable row level security;

-- Who receives approval cards for this install. Null = nobody is notified in
-- Teams; the request still appears in the console's Activity page, which remains
-- the source of truth either way.
alter table public.teams_installs
  add column if not exists approvals_email text;

comment on column public.teams_installs.approvals_email is
  'Email of the person who receives Approve/Decline cards in Teams. They must have messaged the bot at least once, so we have a conversation to reach them on.';
