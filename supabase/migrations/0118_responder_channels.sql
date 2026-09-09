-- ═══════════════════════════════════════════════════════════════════════════
-- 0118 — reach a responder wherever they work
--
-- store_responders was built for WhatsApp: `phone` is NOT NULL because the phone
-- number WAS the address. This product has no WhatsApp, so that column forced
-- whoever adds a colleague to invent a phone number for a channel nobody uses,
-- and the send silently skipped anyway (no token, no phone_number_id).
--
-- Email is the address now, with Teams and Slack preferred when the person is
-- reachable there. So: phone becomes optional, email becomes the thing that
-- matters, and a responder with neither is not reachable at all.
--
-- The column stays rather than being dropped. It costs nothing, and removing a
-- column from a table four call sites read is a worse trade than leaving one
-- nullable field behind.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.store_responders alter column phone drop not null;

comment on column public.store_responders.phone is
  'Legacy WhatsApp address. Unused: this product reaches responders via Teams, Slack or email.';

comment on column public.store_responders.email is
  'How a responder is reached. Also the key used to find them in Teams (teams_user) and Slack (users.lookupByEmail), so an escalation lands where they already work.';

-- Dedupe on email now that it is the address. The existing unique constraint is
-- (store_slug, phone); with phone null, Postgres treats every null as distinct, so
-- upserting on it would insert a fresh row for the same colleague every time.
-- Emails are lower-cased before write, so a plain unique index is enough and,
-- unlike an expression index, PostgREST can target it with on_conflict.
create unique index if not exists store_responders_store_email
  on public.store_responders (store_slug, email);
