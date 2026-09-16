-- The action log said whose credential a call used and nothing else.
--
-- For a tool that runs on the account's own API key that is "the account", which
-- is true and answers the wrong question: an auditor reading the log wants the
-- person who asked for it and, where it was held, the person who let it through.
-- Both are now recorded next to the credential, which stays, because "it ran as
-- Gopi" and "Gopi asked, and it ran on the account's key" are different facts and
-- a security review needs to tell them apart.
alter table public.agent_action_log add column if not exists requested_by text;
alter table public.agent_action_log add column if not exists approved_by text;

-- Teams sessions carry the person in their id, and the bot recorded their address
-- when they messaged it, so rows logged before this change can be attributed.
update public.agent_action_log l
   set requested_by = u.email
  from public.teams_user u
 where l.requested_by is null
   and u.email is not null
   and l.session_id = 'teams_' || u.tenant_id || '_' || coalesce(nullif(u.aad_object_id, ''), u.teams_user_id);

-- The same gap on approval requests raised before the requester was recorded.
update public.action_request r
   set acted_as = u.email
  from public.teams_user u
 where r.acted_as is null
   and u.email is not null
   and r.session_id = 'teams_' || u.tenant_id || '_' || coalesce(nullif(u.aad_object_id, ''), u.teams_user_id);

-- A replay logged at approval time: attribute it to the request it ran.
update public.agent_action_log l
   set requested_by = coalesce(l.requested_by, r.acted_as),
       approved_by  = r.decided_by
  from public.action_request r
 where l.approved_by is null
   and r.status = 'approved'
   and r.store_id = l.store_id
   and r.tool = l.tool
   and l.session_id = r.session_id
   and l.side_effect
   and l.ts between r.decided_at - interval '5 seconds' and r.decided_at + interval '60 seconds';
