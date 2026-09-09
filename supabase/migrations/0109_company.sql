-- ═══════════════════════════════════════════════════════════════════════════
-- 0109 — company: the account that owns assistants
--
-- The platform this forked from had no entity above `stores` — an owner was
-- linked to a single store through `staff`, and billing hung off that store.
-- A SaaS customer instead has ONE account with SEVERAL assistants (production,
-- staging, a second product line) and expects one balance and one team across
-- them. `company` is that root; an assistant is still a `stores` row beneath it.
--
-- Naming note: the schema keeps saying "store" because ~17,600 lines of edge
-- code read it. Only the owner-facing labels say "assistant".
--
-- Service-role only (RLS on, no client policies) — the console reads these
-- through the admin client, same posture as action_request / store_secrets.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.company (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  status      text not null default 'active',   -- active | suspended
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.company enable row level security;

-- ── who belongs to the account ───────────────────────────────────────────────
-- Mirrors the existing `staff` mechanism (user_id + role) but at company grain,
-- so a person gets access to every assistant the company owns at once.
create table if not exists public.company_member (
  company_id  uuid not null references public.company(id) on delete cascade,
  user_id     uuid not null,
  role        text not null default 'member',   -- owner | admin | member
  created_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index if not exists company_member_user_idx on public.company_member (user_id);
alter table public.company_member enable row level security;

-- ── every assistant belongs to exactly one company ───────────────────────────
-- Nullable on purpose: store creation runs before the onboarding rewrite lands,
-- and a store with no company simply isn't metered (meter_record falls back to
-- record-only) rather than failing. Enforced NOT NULL in a later migration once
-- every write path sets it.
alter table public.stores
  add column if not exists company_id uuid references public.company(id) on delete restrict;
create index if not exists stores_company_idx on public.stores (company_id);
