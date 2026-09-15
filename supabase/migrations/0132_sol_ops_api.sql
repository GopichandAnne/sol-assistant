-- ═══════════════════════════════════════════════════════════════════════════
-- 0132 — Sol's operational records, served as an API
--
-- The demo was built to read four spreadsheets in SharePoint. Reading them needs
-- Files.Read.All, writing them needs more, and this tenant requires an
-- administrator to approve both. That approval is a person's calendar, not an
-- engineering problem, and the demo cannot wait for it.
--
-- So the same four datasets are served from here instead, over an ordinary API
-- with an OpenAPI document, connected through the connector builder like any
-- client system. It costs the "point at your own spreadsheet" moment and buys
-- something arguably closer to what a client will actually have: records behind
-- an API, reached with a key.
--
-- One table rather than four, because the shape a model reasons about is the
-- OPERATION and its description, not the storage. Each dataset gets its own
-- path and its own description in the spec; underneath they are rows with a
-- payload, which keeps this to one migration and no schema churn when a column
-- is added to a demo dataset.
--
-- Seeded from the CSVs in demo/sol-internal so the numbers in the runbook, the
-- policy documents and this API agree. Scene 2 depends on four sources telling
-- the same story; a hand-typed copy here would have broken it within a day.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.demo_ops_row (
  id       uuid primary key default gen_random_uuid(),
  tenant   text not null default 'sol',
  -- 'bench' | 'engagements' | 'compliance' | 'timesheets'
  dataset  text not null,
  -- The human reference where the dataset has one: a person's name, an
  -- engagement code. Used to address a single row for an update.
  ref      text not null,
  data     jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demo_ops_row_dataset_idx
  on public.demo_ops_row (tenant, dataset);

comment on table public.demo_ops_row is
  'Mock Sol operational records for demonstrations. Reached over their own API, like a client system.';

alter table public.demo_ops_row enable row level security; -- service-role only

-- Re-seedable: clearing first means applying this twice leaves one clean copy
-- rather than duplicates that would quietly change every count in the demo.
delete from public.demo_ops_row where tenant = 'sol';

insert into public.demo_ops_row (dataset, ref, data) values
  ('bench', 'Priya Shah', '{"Name": "Priya Shah", "Level": "Principal", "Practice": "Data & Platform", "Primary Skills": "Databricks, dbt, data governance", "Current Engagement": "Meridian Media - FAST migration", "Rolls Off": "2026-10-03", "Availability": "Available 6 Oct", "Location": "London", "Clearances": "None", "Notes": "Wants a data-heavy next engagement"}'::jsonb),
  ('bench', 'Dan Okafor', '{"Name": "Dan Okafor", "Level": "Senior Manager", "Practice": "AI Acceleration", "Primary Skills": "LLM apps, RAG, evals", "Current Engagement": "Internal - SAGE", "Rolls Off": "2026-09-30", "Availability": "Available 1 Oct", "Location": "London", "Clearances": "None", "Notes": "Half time on SAGE until end of Q4"}'::jsonb),
  ('bench', 'Leah Mbeki', '{"Name": "Leah Mbeki", "Level": "Manager", "Practice": "Operations", "Primary Skills": "Process redesign, ops modelling", "Current Engagement": "Calder Health - claims ops", "Rolls Off": "2026-11-14", "Availability": "", "Location": "Manchester", "Clearances": "HIPAA trained", "Notes": "Extension likely"}'::jsonb),
  ('bench', 'Tom Wheeler', '{"Name": "Tom Wheeler", "Level": "Consultant", "Practice": "Data & Platform", "Primary Skills": "SQL, Power BI, dbt", "Current Engagement": "", "Rolls Off": "", "Availability": "On bench since 2026-09-01", "Location": "London", "Clearances": "None", "Notes": "28 days on bench - flagged at last staffing call"}'::jsonb),
  ('bench', 'Ana Ruiz', '{"Name": "Ana Ruiz", "Level": "Principal", "Practice": "Financial Services", "Primary Skills": "Regulatory reporting, controls", "Current Engagement": "Brightwater Bank - reporting", "Rolls Off": "2026-12-19", "Availability": "", "Location": "New York", "Clearances": "None", "Notes": ""}'::jsonb),
  ('bench', 'Joe Duffy', '{"Name": "Joe Duffy", "Level": "Senior Consultant", "Practice": "Media & Entertainment", "Primary Skills": "Ad tech, DAM, content ops", "Current Engagement": "Meridian Media - FAST migration", "Rolls Off": "2026-10-03", "Availability": "Available 6 Oct", "Location": "New York", "Clearances": "None", "Notes": ""}'::jsonb),
  ('bench', 'Nina Kaur', '{"Name": "Nina Kaur", "Level": "Manager", "Practice": "Public Sector", "Primary Skills": "Case management, procurement", "Current Engagement": "Commonwealth IT - case mgmt", "Rolls Off": "2027-01-30", "Availability": "", "Location": "Remote", "Clearances": "State background check - Virginia", "Notes": "Cleared 2026-04-11"}'::jsonb),
  ('bench', 'Ellie Frost', '{"Name": "Ellie Frost", "Level": "Consultant", "Practice": "AI Acceleration", "Primary Skills": "Python, integrations, MCP", "Current Engagement": "", "Rolls Off": "", "Availability": "On bench since 2026-09-08", "Location": "London", "Clearances": "None", "Notes": "First bench spell"}'::jsonb),
  ('bench', 'Raj Menon', '{"Name": "Raj Menon", "Level": "Senior Manager", "Practice": "Data & Platform", "Primary Skills": "Databricks, streaming, architecture", "Current Engagement": "Northgate Retail - inventory", "Rolls Off": "2026-10-24", "Availability": "Available 27 Oct", "Location": "London", "Clearances": "None", "Notes": "Requested no travel until December"}'::jsonb),
  ('bench', 'Sam Patel', '{"Name": "Sam Patel", "Level": "Manager", "Practice": "Operations", "Primary Skills": "Service design, change", "Current Engagement": "Commonwealth IT - case mgmt", "Rolls Off": "2026-12-12", "Availability": "", "Location": "Manchester", "Clearances": "State background check - Virginia", "Notes": "Cleared 2026-02-02"}'::jsonb),
  ('bench', 'Marcus Bell', '{"Name": "Marcus Bell", "Level": "Partner", "Practice": "AI Acceleration", "Primary Skills": "Transformation, exec advisory", "Current Engagement": "Multiple - oversight", "Rolls Off": "", "Availability": "Partial", "Location": "London", "Clearances": "None", "Notes": "Two days a week available for pursuits"}'::jsonb),
  ('bench', 'Grace Lin', '{"Name": "Grace Lin", "Level": "Senior Consultant", "Practice": "Financial Services", "Primary Skills": "Risk, data lineage", "Current Engagement": "Brightwater Bank - reporting", "Rolls Off": "2026-10-31", "Availability": "Available 3 Nov", "Location": "New York", "Clearances": "None", "Notes": ""}'::jsonb),
  ('engagements', 'ENG-2411', '{"Code": "ENG-2411", "Client": "Meridian Media", "Engagement": "FAST channel migration", "Practice": "Media & Entertainment", "Partner": "Marcus Bell", "Delivery Lead": "Priya Shah", "Start": "2026-04-06", "End": "2026-10-03", "Fee Type": "Fixed fee", "Fee": "485000", "Currency": "GBP", "Status": "Delivery", "Margin Target": "38", "Margin Actual": "31"}'::jsonb),
  ('engagements', 'ENG-2418', '{"Code": "ENG-2418", "Client": "Calder Health", "Engagement": "Claims operations redesign", "Practice": "Operations", "Partner": "Marcus Bell", "Delivery Lead": "Leah Mbeki", "Start": "2026-06-01", "End": "2026-11-14", "Fee Type": "Time and materials", "Fee": "392000", "Currency": "GBP", "Status": "Delivery", "Margin Target": "42", "Margin Actual": "44"}'::jsonb),
  ('engagements', 'ENG-2423', '{"Code": "ENG-2423", "Client": "Commonwealth IT", "Engagement": "Case management modernisation", "Practice": "Public Sector", "Partner": "Ana Ruiz", "Delivery Lead": "Nina Kaur", "Start": "2026-07-13", "End": "2027-01-30", "Fee Type": "Fixed fee", "Fee": "760000", "Currency": "USD", "Status": "Delivery", "Margin Target": "35", "Margin Actual": "36"}'::jsonb),
  ('engagements', 'ENG-2427', '{"Code": "ENG-2427", "Client": "Brightwater Bank", "Engagement": "Regulatory reporting rebuild", "Practice": "Financial Services", "Partner": "Ana Ruiz", "Delivery Lead": "Ana Ruiz", "Start": "2026-08-03", "End": "2026-12-19", "Fee Type": "Time and materials", "Fee": "540000", "Currency": "USD", "Status": "Delivery", "Margin Target": "40", "Margin Actual": "39"}'::jsonb),
  ('engagements', 'ENG-2430', '{"Code": "ENG-2430", "Client": "Northgate Retail", "Engagement": "Inventory data platform", "Practice": "Data & Platform", "Partner": "Marcus Bell", "Delivery Lead": "Raj Menon", "Start": "2026-05-18", "End": "2026-10-24", "Fee Type": "Fixed fee", "Fee": "310000", "Currency": "GBP", "Status": "Delivery", "Margin Target": "38", "Margin Actual": "27"}'::jsonb),
  ('engagements', 'ENG-2402', '{"Code": "ENG-2402", "Client": "Meridian Media", "Engagement": "Ad tech assessment", "Practice": "Media & Entertainment", "Partner": "Marcus Bell", "Delivery Lead": "Joe Duffy", "Start": "2026-01-12", "End": "2026-03-27", "Fee Type": "Fixed fee", "Fee": "95000", "Currency": "GBP", "Status": "Closed", "Margin Target": "45", "Margin Actual": "48"}'::jsonb),
  ('engagements', 'ENG-2389', '{"Code": "ENG-2389", "Client": "Harbour Point Resorts", "Engagement": "Guest platform assessment", "Practice": "Travel & Hospitality", "Partner": "Marcus Bell", "Delivery Lead": "Leah Mbeki", "Start": "2025-09-15", "End": "2025-12-19", "Fee Type": "Fixed fee", "Fee": "120000", "Currency": "GBP", "Status": "Closed", "Margin Target": "40", "Margin Actual": "41"}'::jsonb),
  ('compliance', 'compliance-001', '{"Client": "Commonwealth IT", "Engagement Code": "ENG-2423", "Requirement": "State of Virginia background check", "Applies To": "Everyone client facing", "Lead Time": "15 working days", "Owner": "People Ops", "Status": "In place", "Renews": "Every 2 years", "Notes": "Fingerprints in person at a Virginia site"}'::jsonb),
  ('compliance', 'compliance-002', '{"Client": "Commonwealth IT", "Engagement Code": "ENG-2423", "Requirement": "Client VPN and GovCloud account", "Applies To": "Everyone with system access", "Lead Time": "5 working days", "Owner": "Client IT", "Status": "In place", "Renews": "Annual", "Notes": "Requires background check to be cleared first"}'::jsonb),
  ('compliance', 'compliance-003', '{"Client": "Commonwealth IT", "Engagement Code": "ENG-2423", "Requirement": "Accessibility training (WCAG 2.2)", "Applies To": "Anyone touching the UI", "Lead Time": "Self paced 3 hours", "Owner": "People Ops", "Status": "In place", "Renews": "Every 2 years", "Notes": ""}'::jsonb),
  ('compliance', 'compliance-004', '{"Client": "Calder Health", "Engagement Code": "ENG-2418", "Requirement": "HIPAA awareness training", "Applies To": "Everyone on the account", "Lead Time": "Self paced 2 hours", "Owner": "People Ops", "Status": "In place", "Renews": "Annual", "Notes": "Certificate goes to the client security team"}'::jsonb),
  ('compliance', 'compliance-005', '{"Client": "Calder Health", "Engagement Code": "ENG-2418", "Requirement": "Business associate agreement acknowledgement", "Applies To": "Everyone on the account", "Lead Time": "1 working day", "Owner": "Legal", "Status": "In place", "Renews": "Per engagement", "Notes": ""}'::jsonb),
  ('compliance', 'compliance-006', '{"Client": "Calder Health", "Engagement Code": "ENG-2418", "Requirement": "No PHI in any AI tool", "Applies To": "Everyone on the account", "Lead Time": "Immediate", "Owner": "Information Security", "Status": "In place", "Renews": "Continuous", "Notes": "Explicitly includes SAGE and the assistant"}'::jsonb),
  ('compliance', 'compliance-007', '{"Client": "Brightwater Bank", "Engagement Code": "ENG-2427", "Requirement": "Financial services screening", "Applies To": "Everyone client facing", "Lead Time": "10 working days", "Owner": "People Ops", "Status": "In place", "Renews": "Every 3 years", "Notes": "Credit and criminal record check"}'::jsonb),
  ('compliance', 'compliance-008', '{"Client": "Brightwater Bank", "Engagement Code": "ENG-2427", "Requirement": "Client laptop (no BYOD)", "Applies To": "Anyone with system access", "Lead Time": "10 working days", "Owner": "Client IT", "Status": "In place", "Renews": "Per engagement", "Notes": "Sol laptops are not permitted on their network"}'::jsonb),
  ('compliance', 'compliance-009', '{"Client": "Meridian Media", "Engagement Code": "ENG-2411", "Requirement": "Content embargo NDA", "Applies To": "Everyone on the account", "Lead Time": "1 working day", "Owner": "Legal", "Status": "In place", "Renews": "Per engagement", "Notes": "Unreleased programming is commercially sensitive"}'::jsonb),
  ('compliance', 'compliance-010', '{"Client": "Northgate Retail", "Engagement Code": "ENG-2430", "Requirement": "Standard mutual NDA", "Applies To": "Everyone on the account", "Lead Time": "1 working day", "Owner": "Legal", "Status": "In place", "Renews": "Per engagement", "Notes": ""}'::jsonb),
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
  ('timesheets', 'timesheets-014', '{"Name": "Leah Mbeki", "Week Ending": "2026-09-12", "Engagement Code": "ENG-2418", "Hours Billable": "40", "Hours Non Billable": "0", "Submitted": "Yes", "Approved": "No", "Approver": "Marcus Bell", "Notes": "Awaiting approval"}'::jsonb);
