-- Several people can approve held changes, and any one of them decides.
--
-- One approver was a single point of failure: the first time that person could
-- not be reached, every held change waited, and in a demo the room waits with it.
-- Deciding was already safe for several people — resolving a request claims it
-- only while it is still pending, so the first decision wins and a second tap is
-- told it was already resolved — so only routing assumed one person.
--
-- approvals_email is kept, holding the first approver, so anything still reading
-- it keeps working; approvals_emails is the list that is used.
alter table public.teams_installs
  add column if not exists approvals_emails text[] not null default '{}';

update public.teams_installs
   set approvals_emails = array[lower(trim(approvals_email))]
 where coalesce(trim(approvals_email), '') <> ''
   and cardinality(approvals_emails) = 0;

comment on column public.teams_installs.approvals_emails is
  'People sent an Approve/Decline card for held changes. Any one decides; the person who asked is never sent their own.';
