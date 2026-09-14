-- ═══════════════════════════════════════════════════════════════════════════
-- 0129 — a spreadsheet registered as a system the assistant can work in
--
-- Knowledge answers questions. Doing the job usually means reading and writing a
-- record somewhere: who is off next week, which laptop that person has, whether
-- an invoice was approved. In a real deployment those live in an HRIS, an asset
-- register and a finance system. In most organisations we will meet, a
-- surprising number of them live in a spreadsheet on SharePoint — and in a demo,
-- a spreadsheet is the honest stand-in for a system we have not been given
-- access to yet.
--
-- A workbook is REGISTERED rather than discovered. The assistant is told "the
-- leave tracker is this table in this file", so asking about leave reads a known
-- table with known columns. Letting a model search for a likely-looking
-- spreadsheet and guess which column means what is how you get a confident
-- answer from last year's file.
--
-- `writable` is off by default and is the whole safety story here. Reading a
-- tracker is ordinary; appending a row to it is an action in somebody's system,
-- and it goes through the same hold-and-approve path as any other write. An
-- owner turns writing on per workbook, knowing which one they just made
-- writable.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.workbook_source (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores(id) on delete cascade,
  -- What the assistant calls it, and what a person would call it: "leave tracker".
  name         text not null,
  -- One line telling the model when this is the right table to look in. This is
  -- the difference between a tool that gets used and one that gets ignored.
  purpose      text not null,
  file_url     text not null,
  drive_id     text,
  item_id      text,
  -- The Excel table (ListObject) inside the workbook. Named tables carry their
  -- own header row, so columns are read rather than assumed from position.
  table_name   text not null default 'Table1',
  writable     boolean not null default false,
  connected_by text not null default '',
  active       boolean not null default true,
  last_error   text,
  created_at   timestamptz not null default now(),
  unique (store_id, name)
);

create index if not exists workbook_source_store_idx
  on public.workbook_source (store_id, active);

comment on table public.workbook_source is
  'A spreadsheet the assistant treats as a system of record. Writes are held for approval unless the account says otherwise.';
comment on column public.workbook_source.writable is
  'Off by default. Turning it on lets the assistant propose row writes, still subject to approval.';

alter table public.workbook_source enable row level security; -- service-role only
