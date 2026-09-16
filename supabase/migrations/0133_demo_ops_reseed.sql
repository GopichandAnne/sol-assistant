-- The bench and timesheet data, re-seeded from the CSVs of record.
--
-- Three things were wrong for a demo dated mid-September 2026.
--
-- Tom Wheeler's bench start made him fifteen days idle while both his own note and
-- the script claimed twenty-eight, so the rate card's "more than three weeks is
-- discussed by name" did not actually apply to the one person that scene exists to
-- catch. He now starts on 14 August, and the note no longer carries a number that
-- goes stale the day after it is written.
--
-- Week ending 12 September held three rows out of twelve, so "who has not
-- submitted" really meant "who has a row at all" — a question that reads as an
-- answer right up until somebody looks at the sheet. The week is now filled out,
-- and Priya and Joe are outstanding because they are outstanding.
--
-- Four bench rows carried an unquoted comma in Notes and so had an eleventh field,
-- including both Virginia clearance dates. As a CSV that is a parse error; built
-- into an Excel table it is a stray unnamed column on screen.
--
-- Re-seeded rather than patched: these rows exist to mirror the spreadsheets, and
-- a partial update is how two copies of the same thing drift apart.

delete from public.demo_ops_row where dataset in ('bench', 'timesheets');

insert into public.demo_ops_row (dataset, ref, data) values
  ('bench', 'Priya Shah', '{"Name": "Priya Shah", "Level": "Principal", "Practice": "Data & Platform", "Primary Skills": "Databricks, dbt, data governance", "Current Engagement": "Meridian Media - FAST migration", "Rolls Off": "2026-10-03", "Availability": "Available 6 Oct", "Location": "London", "Clearances": "None", "Notes": "Wants a data-heavy next engagement"}'::jsonb),
  ('bench', 'Dan Okafor', '{"Name": "Dan Okafor", "Level": "Senior Manager", "Practice": "AI Acceleration", "Primary Skills": "LLM apps, RAG, evals", "Current Engagement": "Internal - SAGE", "Rolls Off": "2026-09-30", "Availability": "Available 1 Oct", "Location": "London", "Clearances": "None", "Notes": "Half time on SAGE until end of Q4"}'::jsonb),
  ('bench', 'Leah Mbeki', '{"Name": "Leah Mbeki", "Level": "Manager", "Practice": "Operations", "Primary Skills": "Process redesign, ops modelling", "Current Engagement": "Calder Health - claims ops", "Rolls Off": "2026-11-14", "Availability": "", "Location": "Manchester", "Clearances": "HIPAA trained", "Notes": "Extension likely, confirm with client"}'::jsonb),
  ('bench', 'Tom Wheeler', '{"Name": "Tom Wheeler", "Level": "Consultant", "Practice": "Data & Platform", "Primary Skills": "SQL, Power BI, dbt", "Current Engagement": "", "Rolls Off": "", "Availability": "On bench since 2026-08-14", "Location": "London", "Clearances": "None", "Notes": "Flagged by name at the last two staffing calls"}'::jsonb),
  ('bench', 'Ana Ruiz', '{"Name": "Ana Ruiz", "Level": "Principal", "Practice": "Financial Services", "Primary Skills": "Regulatory reporting, controls", "Current Engagement": "Brightwater Bank - reporting", "Rolls Off": "2026-12-19", "Availability": "", "Location": "New York", "Clearances": "None", "Notes": ""}'::jsonb),
  ('bench', 'Joe Duffy', '{"Name": "Joe Duffy", "Level": "Senior Consultant", "Practice": "Media & Entertainment", "Primary Skills": "Ad tech, DAM, content ops", "Current Engagement": "Meridian Media - FAST migration", "Rolls Off": "2026-10-03", "Availability": "Available 6 Oct", "Location": "New York", "Clearances": "None", "Notes": ""}'::jsonb),
  ('bench', 'Nina Kaur', '{"Name": "Nina Kaur", "Level": "Manager", "Practice": "Public Sector", "Primary Skills": "Case management, procurement", "Current Engagement": "Commonwealth IT - case mgmt", "Rolls Off": "2027-01-30", "Availability": "", "Location": "Remote", "Clearances": "State background check - Virginia", "Notes": "Cleared 2026-04-11, valid 2 years"}'::jsonb),
  ('bench', 'Ellie Frost', '{"Name": "Ellie Frost", "Level": "Consultant", "Practice": "AI Acceleration", "Primary Skills": "Python, integrations, MCP", "Current Engagement": "", "Rolls Off": "", "Availability": "On bench since 2026-09-08", "Location": "London", "Clearances": "None", "Notes": "First bench spell, shadowing SAGE"}'::jsonb),
  ('bench', 'Raj Menon', '{"Name": "Raj Menon", "Level": "Senior Manager", "Practice": "Data & Platform", "Primary Skills": "Databricks, streaming, architecture", "Current Engagement": "Northgate Retail - inventory", "Rolls Off": "2026-10-24", "Availability": "Available 27 Oct", "Location": "London", "Clearances": "None", "Notes": "Requested no travel until December"}'::jsonb),
  ('bench', 'Sam Patel', '{"Name": "Sam Patel", "Level": "Manager", "Practice": "Operations", "Primary Skills": "Service design, change", "Current Engagement": "Commonwealth IT - case mgmt", "Rolls Off": "2026-12-12", "Availability": "", "Location": "Manchester", "Clearances": "State background check - Virginia", "Notes": "Cleared 2026-02-02, valid 2 years"}'::jsonb),
  ('bench', 'Marcus Bell', '{"Name": "Marcus Bell", "Level": "Partner", "Practice": "AI Acceleration", "Primary Skills": "Transformation, exec advisory", "Current Engagement": "Multiple - oversight", "Rolls Off": "", "Availability": "Partial", "Location": "London", "Clearances": "None", "Notes": "Two days a week available for pursuits"}'::jsonb),
  ('bench', 'Grace Lin', '{"Name": "Grace Lin", "Level": "Senior Consultant", "Practice": "Financial Services", "Primary Skills": "Risk, data lineage", "Current Engagement": "Brightwater Bank - reporting", "Rolls Off": "2026-10-31", "Availability": "Available 3 Nov", "Location": "New York", "Clearances": "None", "Notes": ""}'::jsonb),
  ('timesheets', 'timesheets-001', '{"Name": "Priya Shah", "Week Ending": "2026-09-05", "Engagement Code": "ENG-2411", "Hours Billable": "38", "Hours Non Billable": "2", "Submitted": "Yes", "Approved": "Yes", "Approver": "Marcus Bell", "Notes": ""}'::jsonb),
  ('timesheets', 'timesheets-002', '{"Name": "Joe Duffy", "Week Ending": "2026-09-05", "Engagement Code": "ENG-2411", "Hours Billable": "40", "Hours Non Billable": "0", "Submitted": "Yes", "Approved": "Yes", "Approver": "Marcus Bell", "Notes": ""}'::jsonb),
  ('timesheets', 'timesheets-003', '{"Name": "Leah Mbeki", "Week Ending": "2026-09-05", "Engagement Code": "ENG-2418", "Hours Billable": "36", "Hours Non Billable": "4", "Submitted": "Yes", "Approved": "Yes", "Approver": "Marcus Bell", "Notes": ""}'::jsonb),
  ('timesheets', 'timesheets-004', '{"Name": "Nina Kaur", "Week Ending": "2026-09-05", "Engagement Code": "ENG-2423", "Hours Billable": "40", "Hours Non Billable": "0", "Submitted": "Yes", "Approved": "Yes", "Approver": "Ana Ruiz", "Notes": ""}'::jsonb),
  ('timesheets', 'timesheets-005', '{"Name": "Sam Patel", "Week Ending": "2026-09-05", "Engagement Code": "ENG-2423", "Hours Billable": "37", "Hours Non Billable": "3", "Submitted": "Yes", "Approved": "No", "Approver": "Ana Ruiz", "Notes": "Awaiting approval 6 days"}'::jsonb),
  ('timesheets', 'timesheets-006', '{"Name": "Ana Ruiz", "Week Ending": "2026-09-05", "Engagement Code": "ENG-2427", "Hours Billable": "34", "Hours Non Billable": "6", "Submitted": "Yes", "Approved": "Yes", "Approver": "Marcus Bell", "Notes": ""}'::jsonb),
  ('timesheets', 'timesheets-007', '{"Name": "Grace Lin", "Week Ending": "2026-09-05", "Engagement Code": "ENG-2427", "Hours Billable": "40", "Hours Non Billable": "0", "Submitted": "No", "Approved": "No", "Approver": "Ana Ruiz", "Notes": "Not submitted"}'::jsonb),
  ('timesheets', 'timesheets-008', '{"Name": "Raj Menon", "Week Ending": "2026-09-05", "Engagement Code": "ENG-2430", "Hours Billable": "39", "Hours Non Billable": "1", "Submitted": "Yes", "Approved": "Yes", "Approver": "Marcus Bell", "Notes": ""}'::jsonb),
  ('timesheets', 'timesheets-009', '{"Name": "Tom Wheeler", "Week Ending": "2026-09-05", "Engagement Code": "", "Hours Billable": "0", "Hours Non Billable": "40", "Submitted": "No", "Approved": "No", "Approver": "Marcus Bell", "Notes": "On bench - still needs a timesheet"}'::jsonb),
  ('timesheets', 'timesheets-010', '{"Name": "Ellie Frost", "Week Ending": "2026-09-05", "Engagement Code": "", "Hours Billable": "0", "Hours Non Billable": "40", "Submitted": "No", "Approved": "No", "Approver": "Dan Okafor", "Notes": "On bench - still needs a timesheet"}'::jsonb),
  ('timesheets', 'timesheets-011', '{"Name": "Dan Okafor", "Week Ending": "2026-09-05", "Engagement Code": "", "Hours Billable": "0", "Hours Non Billable": "40", "Submitted": "Yes", "Approved": "Yes", "Approver": "Marcus Bell", "Notes": "SAGE development"}'::jsonb),
  ('timesheets', 'timesheets-012', '{"Name": "Priya Shah", "Week Ending": "2026-09-12", "Engagement Code": "ENG-2411", "Hours Billable": "40", "Hours Non Billable": "0", "Submitted": "No", "Approved": "No", "Approver": "Marcus Bell", "Notes": "Not submitted"}'::jsonb),
  ('timesheets', 'timesheets-013', '{"Name": "Joe Duffy", "Week Ending": "2026-09-12", "Engagement Code": "ENG-2411", "Hours Billable": "38", "Hours Non Billable": "2", "Submitted": "No", "Approved": "No", "Approver": "Marcus Bell", "Notes": "Not submitted"}'::jsonb),
  ('timesheets', 'timesheets-014', '{"Name": "Leah Mbeki", "Week Ending": "2026-09-12", "Engagement Code": "ENG-2418", "Hours Billable": "40", "Hours Non Billable": "0", "Submitted": "Yes", "Approved": "No", "Approver": "Marcus Bell", "Notes": "Awaiting approval"}'::jsonb),
  ('timesheets', 'timesheets-015', '{"Name": "Nina Kaur", "Week Ending": "2026-09-12", "Engagement Code": "ENG-2423", "Hours Billable": "40", "Hours Non Billable": "0", "Submitted": "Yes", "Approved": "Yes", "Approver": "Ana Ruiz", "Notes": ""}'::jsonb),
  ('timesheets', 'timesheets-016', '{"Name": "Sam Patel", "Week Ending": "2026-09-12", "Engagement Code": "ENG-2423", "Hours Billable": "38", "Hours Non Billable": "2", "Submitted": "Yes", "Approved": "Yes", "Approver": "Ana Ruiz", "Notes": ""}'::jsonb),
  ('timesheets', 'timesheets-017', '{"Name": "Ana Ruiz", "Week Ending": "2026-09-12", "Engagement Code": "ENG-2427", "Hours Billable": "36", "Hours Non Billable": "4", "Submitted": "Yes", "Approved": "Yes", "Approver": "Marcus Bell", "Notes": ""}'::jsonb),
  ('timesheets', 'timesheets-018', '{"Name": "Grace Lin", "Week Ending": "2026-09-12", "Engagement Code": "ENG-2427", "Hours Billable": "40", "Hours Non Billable": "0", "Submitted": "Yes", "Approved": "Yes", "Approver": "Ana Ruiz", "Notes": ""}'::jsonb),
  ('timesheets', 'timesheets-019', '{"Name": "Raj Menon", "Week Ending": "2026-09-12", "Engagement Code": "ENG-2430", "Hours Billable": "40", "Hours Non Billable": "0", "Submitted": "Yes", "Approved": "Yes", "Approver": "Marcus Bell", "Notes": ""}'::jsonb),
  ('timesheets', 'timesheets-020', '{"Name": "Dan Okafor", "Week Ending": "2026-09-12", "Engagement Code": "", "Hours Billable": "0", "Hours Non Billable": "40", "Submitted": "Yes", "Approved": "Yes", "Approver": "Marcus Bell", "Notes": "SAGE development"}'::jsonb),
  ('timesheets', 'timesheets-021', '{"Name": "Tom Wheeler", "Week Ending": "2026-09-12", "Engagement Code": "", "Hours Billable": "0", "Hours Non Billable": "40", "Submitted": "Yes", "Approved": "Yes", "Approver": "Marcus Bell", "Notes": "On bench"}'::jsonb),
  ('timesheets', 'timesheets-022', '{"Name": "Ellie Frost", "Week Ending": "2026-09-12", "Engagement Code": "", "Hours Billable": "0", "Hours Non Billable": "40", "Submitted": "Yes", "Approved": "Yes", "Approver": "Dan Okafor", "Notes": "On bench"}'::jsonb);

-- The service desk queue still addressed everyone at northwind.example, left over
-- from when the demo was set in a made-up company. The page only ever renders the
-- part before the @, so nobody saw it there — but the assistant reads the whole
-- record, and quoting a different company's domain back into a Sol demo is exactly
-- the detail a practice leader notices. The tenant key stays as it is: it
-- partitions the rows and is never shown.
update public.demo_ticket
   set requester = replace(requester, '@northwind.example', '@solconsulting.example')
 where requester like '%@northwind.example';

update public.demo_ticket
   set assignee = replace(assignee, '@northwind.example', '@solconsulting.example')
 where assignee like '%@northwind.example';
