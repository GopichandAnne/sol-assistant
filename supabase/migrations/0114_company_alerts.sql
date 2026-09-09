-- ═══════════════════════════════════════════════════════════════════════════
-- 0114 — who hears about a credit threshold
--
-- The existing notify path (notifyResponders) targets store_responders — the
-- people who answer customers. A credit warning is not a customer-service event:
-- it belongs to whoever owns the ACCOUNT. This adds that recipient.
--
--   • company.billing_email — an explicit override when billing goes to someone
--     who isn't a console user (finance, an ops alias).
--   • company_alert_target(store_id) — one round-trip for the edge function:
--     given the assistant that crossed, return the company and the addresses to
--     warn. Falls back to the owner/admin members' own sign-in emails, so an
--     account with no billing_email still gets the warning.
--
-- SECURITY DEFINER because it reads auth.users, which the edge function's role
-- cannot select directly. Returns only email addresses of that company's own
-- owners/admins — no other user data crosses the boundary.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.company
  add column if not exists billing_email text;

comment on column public.company.billing_email is
  'Where credit warnings go. Null = fall back to the owner/admin members.';

create or replace function public.company_alert_target(p_store_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select case when c.id is null then null else jsonb_build_object(
    'company_id',   c.id,
    'company_name', c.name,
    'emails', coalesce(
      -- an explicit billing address wins outright
      case when nullif(btrim(c.billing_email), '') is not null
           then jsonb_build_array(btrim(c.billing_email)) end,
      -- otherwise every owner/admin on the account
      (select jsonb_agg(distinct u.email)
         from public.company_member cm
         join auth.users u on u.id = cm.user_id
        where cm.company_id = c.id
          and cm.role in ('owner', 'admin')
          and u.email is not null),
      '[]'::jsonb
    )
  ) end
  from public.stores s
  left join public.company c on c.id = s.company_id
  where s.id = p_store_id;
$$;
