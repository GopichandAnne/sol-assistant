-- ═══════════════════════════════════════════════════════════════════════════
-- 0128 — sync a folder in resumable batches, one row per file
--
-- The first version did everything in one request: list the folder, download
-- each file, convert it, run extraction, chunk, embed. That works for the five
-- files in a demo folder and falls over on the first real one. Extraction of a
-- scanned PDF is a model call; thirty of them in series is minutes of wall clock
-- against a function that does not get minutes. The failure is also the bad kind
-- — it times out halfway, having indexed some files and not others, with nothing
-- recording which.
--
-- So the work is planned first and done in batches. Planning walks the folder,
-- including sub-folders, and writes a row per file. Each pass then claims a few
-- pending rows and finishes them. The console can say "18 of 40" because that is
-- now a fact in a table rather than a guess, and an interrupted sync resumes
-- instead of restarting.
--
-- `title` is settled at plan time, not at index time. Ingestion replaces a
-- document by title, so two folders each holding "Policy.docx" would otherwise
-- silently overwrite one another — the second sync would erase the first
-- folder's document and nobody would be told. Titles are the path within the
-- attached folder, disambiguated against other sources when they still collide.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.sharepoint_file (
  id         uuid primary key default gen_random_uuid(),
  source_id  uuid not null references public.sharepoint_source(id) on delete cascade,
  store_id   uuid not null references public.stores(id) on delete cascade,
  -- Graph's driveItem id: stable across renames, which a path is not.
  item_id    text not null,
  -- Path within the attached folder, for display and for the document title.
  rel_path   text not null,
  -- What this file is indexed AS. Decided when the folder is planned.
  title      text not null,
  size       bigint,
  -- Graph's own change marker. A file whose etag is unchanged since it was last
  -- indexed is skipped, so a re-sync of forty documents costs almost nothing.
  etag       text,
  -- 'pending' | 'done' | 'skipped' | 'error'
  status     text not null default 'pending',
  note       text,
  indexed_at timestamptz,
  unique (source_id, item_id)
);

create index if not exists sharepoint_file_work_idx
  on public.sharepoint_file (source_id, status);

comment on column public.sharepoint_file.title is
  'The knowledge document this file becomes. Unique per store: ingestion replaces by title.';

-- Where a sync has got to, so the console can report progress and a later pass
-- knows whether planning has happened at all.
alter table public.sharepoint_source
  add column if not exists sync_state text not null default 'idle';
alter table public.sharepoint_source
  add column if not exists planned_at timestamptz;
-- Include files in sub-folders. Default on: somebody attaching "Policies"
-- means the policies, not the ones that happen to be loose at the top.
alter table public.sharepoint_source
  add column if not exists include_subfolders boolean not null default true;

alter table public.sharepoint_file enable row level security; -- service-role only
