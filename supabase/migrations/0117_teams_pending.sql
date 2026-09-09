-- ═══════════════════════════════════════════════════════════════════════════
-- 0117 — connecting Teams without going to Azure
--
-- Linking Teams used to mean: open the Azure portal, find your directory
-- (tenant) id, copy the GUID, paste it into the console. Every step of that is
-- something we asked a person to do because WE needed an identifier, not because
-- they wanted anything. And until they did it, messages from their tenant were
-- dropped with a log line, so the assistant simply appeared broken.
--
-- Instead: the first message from an unknown tenant is recorded here, and the
-- person gets a reply telling them it isn't linked yet. The console then shows
-- that tenant as waiting, and the owner links it with one click. The identifier
-- arrives on its own; nobody visits Azure to fetch it.
--
-- Rows are a queue, not a record. They are deleted on linking, and anything left
-- is just an org that installed the app and never finished.
--
-- Service-role only (RLS on, no client policies).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.teams_pending_tenant (
  tenant_id     text primary key,
  team_name     text,               -- from the activity, when Teams provides one
  sample_user   text,               -- who messaged, so the owner recognises the org
  message_count int not null default 1,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now()
);

alter table public.teams_pending_tenant enable row level security;
