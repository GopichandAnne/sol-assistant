# Operations & reliability runbook

How Ask Rani is watched, tested, and deployed — and what to do when something breaks.

## Monitoring — is the bot alive?

**Health endpoint:** `POST https://<ref>.supabase.co/functions/v1/health`
Pings the bot's *real* dependencies — Gemini `generateContent`, embeddings, and the
database — and returns `200` (healthy) or `503` (something is down) with a JSON
breakdown. This is what catches a **silent dependency failure** (e.g. Google
retiring a Gemini model), which otherwise only surfaces when a customer complains.

- A `pg_cron` job (`rani-health`) hits it every 3 minutes and records each result
  in `health_checks`.
- On a **healthy → failing** transition it posts an alert (de-duped, so no spam).

**Turn alerting on (one-time):**
1. Push channel — set a webhook secret (Slack or Discord incoming webhook URL):
   `npx supabase secrets set ALERT_WEBHOOK_URL=<webhook>`
   Until this is set, failures are only logged.
2. External watcher (recommended) — point a free uptime monitor
   (UptimeRobot / Better Stack) at the health URL, expecting `200`. This notices
   even if our whole stack — including the cron — is down.

## Testing — did a change break behavior?

**Code gate (CI, `.github/workflows/ci.yml`):** on every push/PR, runs the app
typecheck and the edge-function unit tests. Deterministic, no secrets.

**Behavior smoke test (`npm run eval`, `scripts/eval.mjs`):** runs real
conversations against the **deployed** bot and asserts grounding, no-hallucination
on compound questions, language mirroring, request-mode price safety, staying
on-topic, and order-detail collection. Run it **before and after any bot change**.
- Scheduled in `.github/workflows/smoke.yml` every 6h — enable by adding repo
  secrets `SMOKE_SUPABASE_URL` and `SMOKE_ANON_KEY`. GitHub emails you on failure.

## Deploying

- **Edge functions:** `npx supabase functions deploy <name> --project-ref <ref>`
  (web-chat, whatsapp-webhook, followup, bot-admin, health, mock-pos, mock-pay).
  Shared code in `_shared/` is bundled into each — redeploy every function that
  imports a file you changed.
- **Migrations:** `npx supabase db push --linked` (verify with `... migration list --linked`).
- **Apps:** `git push` → Vercel builds (`askrani-app` → app.askrani.ai,
  `askrani-web` → askrani.ai).
- **Model:** functions read `GEMINI_MODEL` (default `gemini-flash-latest`, an alias
  that survives model retirements). Never pin to a dated model that can be retired.

## When something is red

1. **Hit the health endpoint** — it tells you which dependency failed.
2. **Gemini failing** (`HTTP 404 / no longer available`) → a model was retired.
   List current models and update `GEMINI_MODEL`:
   the fix last time was setting `GEMINI_MODEL=gemini-flash-latest`.
3. **Bot replies "I had a brief hiccup"** to everyone → generation is returning
   null; almost always the Gemini check above.
4. **Function errors** → Supabase Dashboard → Edge Functions → Logs.
5. **Eval fails** → read which assertion; the reply is printed. A grounding/price
   failure is a real regression; investigate before deploying further.

## Sign-in (Microsoft Entra)

Staff sign in with their SOL Microsoft account. Email and password remains as the
break-glass path; the phone and Google routes were removed.

Three parts, and all three must agree:

1. **Azure** (portal.azure.com -> Entra ID -> App registrations -> "The Assistant")
   - Single tenant only, so only the SOL directory can authenticate.
   - Redirect URI, platform Web, pointing at **Supabase**, not Vercel:
     `https://<project-ref>.supabase.co/auth/v1/callback`
     Supabase receives Microsoft's callback and then sends the browser on to the
     app. Pointing this at the Vercel domain is the most common failure.
2. **Supabase** -> Authentication -> Sign In / Providers -> Azure
   - Client ID, and the client secret's **Value** (not the Secret ID, which is a
     GUID and will silently fail).
   - Azure Tenant URL `https://login.microsoftonline.com/<tenant-id>`. This is what
     enforces the single-tenant restriction on Supabase's side; the Azure setting
     alone does not.
   - "Allow users without an email" stays **off**. The app keys people by email
     everywhere (staff links, company membership, credit warnings), so an
     emailless account would authenticate and then fail to link to anything.
3. **Vercel** -> `NEXT_PUBLIC_MICROSOFT_SSO=true`, type **Config**, then redeploy.
   The button is hidden unless this is set, deliberately: the upstream Google
   button rendered against a provider that was never configured, so it could only
   ever fail. Register and enable first, flip the flag last.

The app requests the `email` scope explicitly. Entra returns no email claim
otherwise, which would authenticate a user the rest of the app cannot place.

**Secret rotation:** client secrets expire. Add the new secret in Azure first,
paste its Value into Supabase, then delete the old one. Doing it in that order
means no sign-in outage.

## Channels: what is one-time, and what is per organisation

The split matters, because it is the difference between "connect Teams in a click"
and "spend an afternoon in the Azure portal". Everything in the first list is done
ONCE by us and then applies to every organisation.

**One-time, ours (platform)**
- Slack: create the Slack app, set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`,
  `SLACK_STATE_SECRET`, `SLACK_SIGNING_SECRET`, `SLACK_REDIRECT_URL`.
- Teams: create the Azure bot + app registration, set `MICROSOFT_APP_ID` and
  `MICROSOFT_APP_PASSWORD`, point the messaging endpoint at the `teams-messages`
  function, and publish a Teams app manifest that references the bot.
- Teams, for identity: grant Microsoft Graph `User.Read.All` WITH admin consent.
  Without it the bot cannot resolve anyone's email, so every Teams user is
  anonymous, members-only knowledge returns nothing, and identity-forwarding
  tools decline. It looks like a bug and is a missing consent.

**Per organisation (the customer, or SOL for itself)**
- Slack: click "Add to Slack". That is the whole thing.
- Teams: an admin installs the app, someone sends it one message, then the owner
  clicks Connect on the organisation that appears. No GUID to find: the first
  message registers the tenant and the bot replies saying it is not connected
  yet, so nobody is left staring at silence.

**Naming and branding.** One Azure bot serves many tenants, so the name and icon
every organisation sees come from the single Teams app manifest, not from anything
in the console. The white-label fields only affect the web embed. Giving a client
their own name and icon means a separate Azure bot registration and manifest for
them; the tenant-to-assistant mapping already supports either choice.

## Known follow-ups (not yet done)

- Rotate the WhatsApp access token that was once exposed (do it in Meta).
- Meta-approved WhatsApp **templates** for messaging outside the 24h window
  (staff/customer notifications currently work in-window only).
- Consider auto-deploying functions/migrations from CI (needs a Supabase access
  token secret) once the team is bigger.
