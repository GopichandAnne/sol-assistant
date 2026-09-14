-- ═══════════════════════════════════════════════════════════════════════════
-- 0131 — hold the big ones
--
-- action_policy is one bit per tool: a write either runs or waits for a person.
-- That is the wrong shape for the decision an organisation actually makes, which
-- is almost never about the capability and almost always about the size of what
-- it does. Approving £50 and approving £50,000 are the same API call with the
-- same permission, and no system of record will stop either, because the person
-- genuinely may do both.
--
-- One bit forces a choice between two bad settings. Hold everything and people
-- learn to approve without reading, which looks like governance and is not.
-- Auto everything and the first expensive mistake is the one nobody saw.
--
-- So a tool may carry a threshold: run on its own below this number, wait for a
-- person at or above it. Two columns rather than an expression language, because
-- a rule an owner cannot read is a rule nobody will maintain, and the rule that
-- matters in practice is this one.
--
-- amount_field names the argument carrying the number. Where it is absent from a
-- call, or does not parse, the action HOLDS. A threshold that fails open turns
-- "approve anything over five thousand" into "approve nothing" the first time an
-- argument is named something unexpected.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.http_tool
  add column if not exists auto_below   numeric,
  add column if not exists amount_field text;

alter table public.mcp_tool
  add column if not exists auto_below   numeric,
  add column if not exists amount_field text;

-- Trackers were the inconsistency: their writes held unconditionally, with no
-- switch at all, while send_email had a configurable policy. Same two columns,
-- plus the policy they never had.
alter table public.workbook_source
  add column if not exists action_policy text not null default 'hold'
    check (action_policy in ('auto', 'hold')),
  add column if not exists auto_below    numeric,
  add column if not exists amount_field  text;

comment on column public.http_tool.auto_below is
  'Runs without approval when amount_field is below this. At or above it, and whenever the amount cannot be read, it waits for a person.';
comment on column public.workbook_source.action_policy is
  'hold (default) means every write to this tracker waits for a person, whatever its size.';
