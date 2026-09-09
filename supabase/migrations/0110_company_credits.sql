-- ═══════════════════════════════════════════════════════════════════════════
-- 0110 — company credits: one pool per account, granted not purchased
--
-- No payment processor in this product. Credits arrive by GRANT (admin console)
-- and the system's job is to meter honestly and warn early. Crossing the
-- threshold notifies; it never blocks a live assistant mid-conversation.
--
-- Balance is DERIVED, never stored: `remaining = granted_credits - spent_credits`.
-- Two counters that only ever increase cannot drift out of agreement with the
-- ledger, which a single mutable balance column eventually does.
--
-- Service-role only (RLS on, no client policies).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.company_wallet (
  company_id          uuid primary key references public.company(id) on delete cascade,
  granted_credits     bigint not null default 0,      -- lifetime granted, only grows
  spent_credits       bigint not null default 0,      -- lifetime spent,   only grows
  threshold_credits   int    not null default 250,    -- warn at/below this remaining
  threshold_fired_at  timestamptz,                    -- when the warning last fired
  total_cost_usd      numeric(14,6) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.company_wallet enable row level security;

-- ── every credit movement, newest-first, attributed to an assistant ──────────
-- store_id is kept on debits so per-assistant burn is answerable even though the
-- pool is shared. ON DELETE SET NULL: deleting an assistant must not erase the
-- financial record of what it spent.
create table if not exists public.company_ledger (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.company(id) on delete cascade,
  store_id    uuid references public.stores(id) on delete set null,
  ts          timestamptz not null default now(),
  delta       int  not null,                  -- +grant / -debit
  reason      text not null,                  -- usage kind, or 'grant' / 'trial'
  cost_usd    numeric(14,6),
  ref         jsonb
);
create index if not exists company_ledger_company_ts on public.company_ledger (company_id, ts desc);
alter table public.company_ledger enable row level security;

-- ── auto-provision a wallet when a company is created ────────────────────────
create or replace function public.company_wallet_on_company() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.company_wallet (company_id) values (new.id)
    on conflict (company_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_company_wallet on public.company;
create trigger trg_company_wallet after insert on public.company
  for each row execute function public.company_wallet_on_company();

-- ── grant credits (the only way credits enter the system) ────────────────────
-- Re-arms the threshold warning: if a grant lifts the balance back above the
-- threshold, clear the fired marker so the next crossing warns again.
create or replace function public.company_grant_credits(
  p_company_id uuid,
  p_credits    int,
  p_reason     text default 'grant',
  p_ref        jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_granted   bigint;
  v_spent     bigint;
  v_threshold int;
begin
  if coalesce(p_credits, 0) <= 0 then
    raise exception 'grant must be positive';
  end if;

  insert into public.company_wallet (company_id) values (p_company_id)
    on conflict (company_id) do nothing;

  update public.company_wallet w set
    granted_credits    = w.granted_credits + p_credits,
    threshold_fired_at = case
                           when (w.granted_credits + p_credits - w.spent_credits) > w.threshold_credits
                           then null else w.threshold_fired_at
                         end,
    updated_at         = now()
  where w.company_id = p_company_id
  returning w.granted_credits, w.spent_credits, w.threshold_credits
    into v_granted, v_spent, v_threshold;

  insert into public.company_ledger (company_id, delta, reason, ref)
    values (p_company_id, p_credits, coalesce(p_reason, 'grant'), p_ref);

  return jsonb_build_object(
    'remaining', v_granted - v_spent,
    'threshold', v_threshold
  );
end;
$$;
