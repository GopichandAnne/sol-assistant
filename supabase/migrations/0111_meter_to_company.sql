-- ═══════════════════════════════════════════════════════════════════════════
-- 0111 — point metering at the company pool
--
-- Three changes, all in this one file so the switch is atomic:
--
--   1. meter_record() debits company_wallet instead of the per-store wallet,
--      resolving store -> company. usage_event keeps its store_id untouched, so
--      per-assistant cost attribution still works exactly as before.
--   2. It now RETURNS jsonb — the new remaining balance and whether this debit
--      crossed the warning threshold. The crossing is detected here (where the
--      before/after values are, atomically) but ACTED ON in meter.ts, where the
--      responder/email path already lives. SQL should not send mail.
--   3. The per-store wallet trigger is dropped. Two live credit systems in one
--      database is the single most dangerous thing about this carve; leaving
--      `wallet` present-but-unwritten makes the company pool the only truth.
--
-- Return type changes from void -> jsonb, which CREATE OR REPLACE cannot do,
-- hence the explicit DROP first.
--
-- Fail-safe throughout: a store with no company still records its usage_event
-- and returns null rather than raising. Metering must never break a reply.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.meter_record(uuid, text, text, text, jsonb, numeric, int, jsonb);

create function public.meter_record(
  p_store_id  uuid,
  p_kind      text,
  p_provider  text,
  p_model     text,
  p_units     jsonb,
  p_cost_usd  numeric,
  p_credits   int,
  p_ref       jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_before     bigint;
  v_after      bigint;
  v_threshold  int;
  v_crossed    boolean := false;
begin
  -- The raw COGS ledger is written unconditionally, company or not.
  insert into public.usage_event (store_id, kind, provider, model, units, cost_usd, credits, ref)
    values (p_store_id, p_kind, p_provider, p_model,
            coalesce(p_units, '{}'::jsonb), coalesce(p_cost_usd, 0),
            coalesce(p_credits, 0), p_ref);

  select s.company_id into v_company_id
    from public.stores s where s.id = p_store_id;

  -- Unassigned assistant: recorded, not billed. Never an error.
  if v_company_id is null then
    return null;
  end if;

  insert into public.company_wallet (company_id) values (v_company_id)
    on conflict (company_id) do nothing;

  -- Lock this company's row so concurrent turns can't interleave the
  -- before/after read that threshold detection depends on.
  select (w.granted_credits - w.spent_credits), w.threshold_credits
    into v_before, v_threshold
    from public.company_wallet w
    where w.company_id = v_company_id
    for update;

  if coalesce(p_credits, 0) <= 0 then
    return jsonb_build_object('remaining', v_before, 'threshold', v_threshold, 'crossed', false);
  end if;

  update public.company_wallet w set
    spent_credits  = w.spent_credits  + p_credits,
    total_cost_usd = w.total_cost_usd + coalesce(p_cost_usd, 0),
    updated_at     = now()
  where w.company_id = v_company_id;

  insert into public.company_ledger (company_id, store_id, delta, reason, cost_usd, ref)
    values (v_company_id, p_store_id, -p_credits, p_kind, p_cost_usd, p_ref);

  v_after := v_before - p_credits;

  -- Crossing, not "below": fires on the debit that takes the balance from above
  -- the threshold to at/below it. While it stays below, later debits have
  -- v_before <= threshold and do not re-fire. A grant that lifts the balance
  -- back above re-arms it (see company_grant_credits).
  if v_before > v_threshold and v_after <= v_threshold then
    v_crossed := true;
    update public.company_wallet w set threshold_fired_at = now()
      where w.company_id = v_company_id;
  end if;

  return jsonb_build_object('remaining', v_after, 'threshold', v_threshold, 'crossed', v_crossed);
end;
$$;

-- ── retire the per-store wallet ──────────────────────────────────────────────
-- The table and its 150-credit trial grant belong to the platform this forked
-- from. Dropping the trigger stops new per-store wallets being created; the
-- table itself stays (dormant, unread) so nothing that references it fails to
-- compile. company_wallet is now the only pool anything debits.
drop trigger if exists trg_wallet_on_store on public.stores;
