-- ═══════════════════════════════════════════════════════════════════════════
-- 0124 — remember that an organisation hasn't approved the app
--
-- A Teams install without admin consent works just enough to look fine: people
-- chat, it answers. What silently does not work is the directory lookup, so
-- every person arrives anonymous — and with no email there is no approver to
-- send a card to, no personal Microsoft 365, no name on an audited action, and
-- no requester on an approval.
--
-- That is a two-minute fix (one consent link) presenting as a product fault, and
-- until now the only trace was a warning in a log nobody reads. Recording it on
-- the install lets the console say so plainly, next to the link that fixes it.
--
-- Deliberately a timestamp rather than a flag: it answers "is this still true?"
-- The lookup clears it on the next success, so a granted consent heals the
-- warning without anyone pressing anything.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.teams_installs
  add column if not exists consent_missing_at timestamptz;

comment on column public.teams_installs.consent_missing_at is
  'Last time a directory lookup was refused for want of admin consent. Cleared on the next successful lookup; null means no known problem.';
