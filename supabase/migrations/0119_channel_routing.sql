-- ═══════════════════════════════════════════════════════════════════════════
-- 0119 — more than one assistant per organisation
--
-- teams_installs and slack_installs key on the workspace (tenant_id / team_id),
-- so a Microsoft 365 tenant mapped to exactly ONE assistant. Every other part of
-- the product assumes an account owns several: credits pool at the company, the
-- checklist is per assistant, the admin console lists them. An admin who built an
-- IT assistant and an HR assistant could put one of them in Teams and the other
-- on a web page nobody visits.
--
-- Routing by CHANNEL rather than by content, deliberately. The alternative was one
-- presence that reads the question and picks an assistant, which puts a classifier
-- between a person and their answer and makes it the thing standing between
-- private HR knowledge and an IT answer. Keying on the channel makes the assistant
-- boundary and the knowledge boundary the same object: people already ask HR
-- questions in the HR channel, and there is no decision left to get wrong.
--
-- Backwards compatible by construction. The install row keeps its store_id and
-- remains the workspace default, so an existing single-assistant org is unchanged
-- and needs no migration of its own. channel_route only ever adds overrides.
--
-- Service-role only (RLS on, no client policies).
-- ═══════════════════════════════════════════════════════════════════════════

-- Which assistant answers in a given channel.
create table if not exists public.channel_route (
  channel_kind text not null check (channel_kind in ('teams', 'slack')),
  workspace_id text not null,            -- Azure tenant id, or Slack team id
  channel_id   text not null,            -- the channel/conversation this applies to
  store_id     uuid not null references public.stores(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (channel_kind, workspace_id, channel_id)
);
create index if not exists channel_route_store on public.channel_route (store_id);
alter table public.channel_route enable row level security;

-- Channels we have actually seen, so the console can offer real names to route
-- rather than asking someone to paste an opaque channel id. Group conversations
-- only: a direct message is between one person and the org default, and is not
-- something anyone would route separately.
create table if not exists public.channel_seen (
  channel_kind text not null check (channel_kind in ('teams', 'slack')),
  workspace_id text not null,
  channel_id   text not null,
  name         text,                     -- when the platform gives us one
  last_seen    timestamptz not null default now(),
  primary key (channel_kind, workspace_id, channel_id)
);
create index if not exists channel_seen_workspace
  on public.channel_seen (channel_kind, workspace_id, last_seen desc);
alter table public.channel_seen enable row level security;

comment on table public.channel_route is
  'Per-channel assistant override. Absent = the workspace default on teams_installs / slack_installs answers.';
