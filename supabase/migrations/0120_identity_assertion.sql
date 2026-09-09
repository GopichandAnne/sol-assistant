-- ═══════════════════════════════════════════════════════════════════════════
-- 0120 — a verifiable identity, in every channel
--
-- Forwarding a person's identity to a downstream API has worked one way only:
-- on the web embed, where the host site signs a token and we hand that exact
-- token on, so their API verifies its own signature. In Teams and Slack there is
-- no such token. The best available was to send an email and ask the API to trust
-- us, which is an assertion, not a delegation: the API cannot check it, and
-- anything that can reach the endpoint can claim to be anyone.
--
-- So we sign the assertion ourselves. A short-lived JWT states who the person is,
-- which channel proved it, and which assistant is asking. The receiving API
-- verifies it with a secret only it and we hold, and can then trust the subject
-- for the sixty seconds it is valid.
--
-- Symmetric (HS256) on purpose. The alternative, a platform key pair and a public
-- JWKS endpoint, is the more elegant answer and avoids distributing secrets, but
-- it needs key management and rotation before it is safe, and this product's
-- whole argument is that a person can wire up an integration without a platform
-- team. Pasting one secret into an API they already own is a step they can do
-- today. The claim set below is deliberately the same either way, so moving to
-- asymmetric later changes how it is verified and not what it says.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.stores
  add column if not exists assertion_secret text;

comment on column public.stores.assertion_secret is
  'HS256 key for identity assertions this assistant sends to downstream APIs. Generated on first use, shown once in the console, rotatable. Never sent to the model.';
