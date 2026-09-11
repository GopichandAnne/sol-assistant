-- ═══════════════════════════════════════════════════════════════════════════
-- 0125 — an account's own mail setup, and escalations by subject
--
-- TWO changes, both about the same thing: a request reaching the right person.
--
-- 1. notification_email. Outbound mail was one set of environment variables for
--    the whole deployment, so every account's escalations left from ours. That is
--    fine while we are the only account and wrong the moment a client wants
--    notifications arriving from their own domain — which is also the version
--    that survives their spam filter. Kept per ACCOUNT rather than per assistant:
--    a client with three assistants has one mail setup, not three.
--
--    The password is AES-GCM ciphertext under the same key as the OAuth vault
--    (OAUTH_ENC_KEY). It is never returned to the console; the panel shows
--    whether one is set and lets it be replaced.
--
-- 2. escalation_topics. Responders already subscribe to topics, but the only
--    escalation topic was "escalation", so every unanswerable question went to
--    everybody. An account can now name its own subjects — HR, IT, Finance — and
--    the assistant picks the closest one when it hands a question over, so the
--    person who gets it is the person who can answer it.
--
--    Stored as configuration rather than a table because it is a short list of
--    labels the owner edits as prose, exactly like the suggestion chips beside it.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.notification_email (
  company_id      uuid primary key references public.company(id) on delete cascade,
  host            text not null,
  port            integer not null default 587,
  username        text not null,
  password_cipher text not null,
  from_address    text,
  from_name       text,
  active          boolean not null default true,
  -- Set when a test message actually went out, so the panel can say "working"
  -- rather than "saved" — the two are not the same and only one is reassuring.
  verified_at     timestamptz,
  last_error      text,
  updated_at      timestamptz not null default now()
);

comment on table public.notification_email is
  'Per-account outbound mail. Falls back to the platform SMTP env when absent.';
comment on column public.notification_email.password_cipher is
  'AES-GCM ciphertext under OAUTH_ENC_KEY. Never leaves the server.';

alter table public.notification_email enable row level security; -- service-role only

-- The new configuration key. Added as a value only; nothing reads it until the
-- console writes one.
alter type public.agent_config_key add value if not exists 'escalation_topics';
