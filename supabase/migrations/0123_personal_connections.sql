-- ═══════════════════════════════════════════════════════════════════════════
-- 0123 — whose account is this?
--
-- Until now an assistant had ONE connection per provider, made by an owner, and
-- every call went out as that account. For a shared booking calendar that is
-- fine: the answer does not depend on who asked.
--
-- It is badly wrong for anything personal. "Find my email from Finance" or
-- "what's on my calendar" answered from the owner's mailbox is both the wrong
-- answer and a disclosure — one person's mail read on another person's behalf.
-- Microsoft 365 is the first connector where that distinction bites, because it
-- is the first one reaching mail, files and a personal calendar.
--
-- So a connection now says whose it is:
--
--   user_key = ''             the ORGANISATION's connection. Shared lookups
--                             only — a document in SharePoint, a colleague in
--                             the directory. Connected once, by an owner.
--
--   user_key = '<email>'      one PERSON's connection, made by them, used only
--                             when that same person is the one asking. Their
--                             mail, their calendar, their tasks, mail sent as
--                             them.
--
-- Empty string rather than NULL so the unique constraint keeps working normally
-- and an upsert can target it: in Postgres two NULLs are not equal, so a
-- nullable column here would silently allow duplicate organisation rows.
--
-- Deliberately keyed by verified EMAIL rather than by our own user id: the
-- person asking may be in Teams, in Slack or on the web and may have no console
-- account at all. Email is the one identifier every channel resolves to, and it
-- is always the channel-verified one — never a value the model or the person
-- supplied.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.oauth_connection
  add column if not exists user_key text not null default '';

comment on column public.oauth_connection.user_key is
  'Whose connection this is. Empty = the organisation''s shared connection; otherwise the verified email of the one person it belongs to and may be used for.';

-- Replace the old (store_id, provider) uniqueness with one that includes the
-- person, so an organisation connection and any number of personal ones coexist.
alter table public.oauth_connection
  drop constraint if exists oauth_connection_store_id_provider_key;

create unique index if not exists oauth_connection_store_provider_user
  on public.oauth_connection (store_id, provider, user_key);

-- Looking up "does this person have a connection" happens on every turn that
-- offers a personal tool, so it gets its own index.
create index if not exists oauth_connection_user_idx
  on public.oauth_connection (store_id, provider, user_key)
  where status = 'connected';
