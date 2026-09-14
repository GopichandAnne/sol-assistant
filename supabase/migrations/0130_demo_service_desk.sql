-- ═══════════════════════════════════════════════════════════════════════════
-- 0130 — a stand-in for the client system nobody has given us access to yet
--
-- The Teams demo shows policies from SharePoint and records in a spreadsheet.
-- Both are real, and both invite the same question from a technical audience:
-- "yes, but our HR system is Workday and our tickets are in ServiceNow". The
-- honest answer is that the assistant reaches those the same way it reaches any
-- API, and the fastest way to prove it is to connect one live, in front of them,
-- in under two minutes.
--
-- So this is a small service desk with an OpenAPI spec and an MCP endpoint over
-- the same operations. It is deliberately NOT a facade over the demo
-- spreadsheet: the whole claim is one chat window reaching SEVERAL systems, and
-- an "API" that turns out to be the same file undercuts that the moment anybody
-- looks. It is a different system, with its own store, its own queue and its own
-- little web page to show a ticket landing in it.
--
-- Rows carry a tenant so a second demo cannot see the first one's tickets, and
-- nothing here is store-scoped: from the assistant's point of view this is an
-- external system, and pretending otherwise in the schema would make the demo
-- quietly easier than the real thing.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.demo_ticket (
  id          uuid primary key default gen_random_uuid(),
  tenant      text not null default 'northwind',
  -- Human reference, the thing a person quotes back: INC-1042.
  ref         text not null,
  title       text not null,
  description text,
  requester   text,
  assignee    text,
  category    text not null default 'General',
  priority    text not null default 'Normal' check (priority in ('Low', 'Normal', 'High', 'Urgent')),
  status      text not null default 'Open' check (status in ('Open', 'In progress', 'Waiting', 'Resolved', 'Closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant, ref)
);

create index if not exists demo_ticket_queue_idx
  on public.demo_ticket (tenant, status, created_at desc);

comment on table public.demo_ticket is
  'Mock external service desk for demonstrations. Not part of the product; reached over its own API like any client system.';

alter table public.demo_ticket enable row level security; -- service-role only

-- A starting queue, so the first thing anyone sees is a system already in use
-- rather than an empty table. Dates are relative to when this is applied, which
-- keeps "raised yesterday" true however long the demo sits unused.
insert into public.demo_ticket (ref, title, description, requester, assignee, category, priority, status, created_at)
values
  ('INC-1031', 'Laptop will not join the VPN after update',
   'Fails at the certificate step. Worked on Friday.',
   'priya.shah@northwind.example', 'servicedesk@northwind.example', 'IT', 'High', 'In progress', now() - interval '2 days'),
  ('INC-1034', 'Request access to the Finance reporting folder',
   'Needs read access for the quarterly pack.',
   'tom.wheeler@northwind.example', null, 'Access', 'Normal', 'Open', now() - interval '1 day'),
  ('INC-1036', 'Meeting room display not switching on',
   'Manchester, room 2. Reported by two people this week.',
   'leah.mbeki@northwind.example', 'facilities@northwind.example', 'Facilities', 'Low', 'Waiting', now() - interval '1 day'),
  ('INC-1039', 'New starter kit for engineering hire',
   'Start date 5 October. Laptop, monitor, phone.',
   'leah.mbeki@northwind.example', null, 'IT', 'Normal', 'Open', now() - interval '4 hours'),
  ('INC-1040', 'Expenses claim rejected without a reason',
   'Claim from the New York trip. Submitted within 60 days.',
   'joe.duffy@northwind.example', 'ana.ruiz@northwind.example', 'Finance', 'Normal', 'Open', now() - interval '2 hours')
on conflict (tenant, ref) do nothing;

-- Reference numbers continue from the seeded queue rather than restarting, so a
-- ticket raised in the demo reads as the next one in a real sequence.
create sequence if not exists public.demo_ticket_seq start with 1041;

-- Handing out the next reference in SQL keeps two people demoing at once from
-- both being told they raised INC-1041.
create or replace function public.next_demo_ticket_ref()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'INC-' || nextval('public.demo_ticket_seq')::text;
$$;

grant execute on function public.next_demo_ticket_ref() to service_role;
