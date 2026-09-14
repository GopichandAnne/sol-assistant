-- ═══════════════════════════════════════════════════════════════════════════
-- 0127 — SharePoint folders as a knowledge source
--
-- Knowledge could be typed, pasted or uploaded one file at a time. Every
-- organisation we will ever deploy into already keeps its policies somewhere,
-- and that somewhere is usually a SharePoint document library. Asking them to
-- re-upload it is asking them to maintain the same document twice, which they
-- will do once and then stop — after which the assistant answers from last
-- quarter's policy and quietly becomes a liability.
--
-- So a folder becomes a source: point at it once, and its files are read,
-- chunked and indexed like any other document. Re-syncing replaces what it
-- previously produced, so the answer follows the document.
--
-- Two decisions worth recording.
--
-- connected_by holds a person's address, not a service account. Files.Read.All
-- is DELEGATED — it reads what the signed-in user can reach — so whoever
-- connects the folder decides the blast radius. Storing it makes that visible
-- and revocable, instead of leaving "whose access is this, actually" to be
-- reconstructed later from an OAuth row.
--
-- The resolved drive_id/item_id are cached rather than re-resolved from the URL
-- each run: a SharePoint link carries a site path that changes when somebody
-- renames a site, and a sync that silently starts reading a different folder is
-- worse than one that fails.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.sharepoint_source (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  -- Exactly what the owner pasted, kept for display and for re-resolving if the
  -- cached ids ever stop working.
  folder_url    text not null,
  label         text,
  drive_id      text,
  item_id       text,
  -- Whose delegated access this reads with.
  connected_by  text not null default '',
  active        boolean not null default true,
  last_synced_at timestamptz,
  -- One line of plain English: how many files, or what went wrong. Shown as-is.
  last_result   text,
  file_count    integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (store_id, folder_url)
);

create index if not exists sharepoint_source_store_idx
  on public.sharepoint_source (store_id);

comment on table public.sharepoint_source is
  'A SharePoint folder indexed into the knowledge base. Re-syncing replaces the documents it produced.';
comment on column public.sharepoint_source.connected_by is
  'The person whose delegated Microsoft access this folder is read with.';

alter table public.sharepoint_source enable row level security; -- service-role only

-- Which source produced a knowledge document, so a re-sync can retire files that
-- have been deleted from the folder without touching anything a person uploaded
-- by hand. Nullable: everything already in the table came from somewhere else.
alter table public.knowledge_index
  add column if not exists sharepoint_source_id uuid
  references public.sharepoint_source(id) on delete set null;

create index if not exists knowledge_index_sharepoint_idx
  on public.knowledge_index (sharepoint_source_id)
  where sharepoint_source_id is not null;
