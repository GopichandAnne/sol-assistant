-- The engagements book, re-denominated to USD.
--
-- It carried a mix of GBP and USD, from when the rate card quoted both. The
-- practice reads in dollars, and a margin question that answers in two currencies
-- invites a conversation about exchange rates instead of about margin. The
-- amounts are unchanged: this is the same book, stated in one currency.

delete from public.demo_ops_row where dataset = 'engagements';

insert into public.demo_ops_row (dataset, ref, data) values
  ('engagements', 'ENG-2411', '{"Code": "ENG-2411", "Client": "Meridian Media", "Engagement": "FAST channel migration", "Practice": "Media & Entertainment", "Partner": "Marcus Bell", "Delivery Lead": "Priya Shah", "Start": "2026-04-06", "End": "2026-10-03", "Fee Type": "Fixed fee", "Fee": "485000", "Currency": "USD", "Status": "Delivery", "Margin Target": "38", "Margin Actual": "31"}'::jsonb),
  ('engagements', 'ENG-2418', '{"Code": "ENG-2418", "Client": "Calder Health", "Engagement": "Claims operations redesign", "Practice": "Operations", "Partner": "Marcus Bell", "Delivery Lead": "Leah Mbeki", "Start": "2026-06-01", "End": "2026-11-14", "Fee Type": "Time and materials", "Fee": "392000", "Currency": "USD", "Status": "Delivery", "Margin Target": "42", "Margin Actual": "44"}'::jsonb),
  ('engagements', 'ENG-2423', '{"Code": "ENG-2423", "Client": "Commonwealth IT", "Engagement": "Case management modernisation", "Practice": "Public Sector", "Partner": "Ana Ruiz", "Delivery Lead": "Nina Kaur", "Start": "2026-07-13", "End": "2027-01-30", "Fee Type": "Fixed fee", "Fee": "760000", "Currency": "USD", "Status": "Delivery", "Margin Target": "35", "Margin Actual": "36"}'::jsonb),
  ('engagements', 'ENG-2427', '{"Code": "ENG-2427", "Client": "Brightwater Bank", "Engagement": "Regulatory reporting rebuild", "Practice": "Financial Services", "Partner": "Ana Ruiz", "Delivery Lead": "Ana Ruiz", "Start": "2026-08-03", "End": "2026-12-19", "Fee Type": "Time and materials", "Fee": "540000", "Currency": "USD", "Status": "Delivery", "Margin Target": "40", "Margin Actual": "39"}'::jsonb),
  ('engagements', 'ENG-2430', '{"Code": "ENG-2430", "Client": "Northgate Retail", "Engagement": "Inventory data platform", "Practice": "Data & Platform", "Partner": "Marcus Bell", "Delivery Lead": "Raj Menon", "Start": "2026-05-18", "End": "2026-10-24", "Fee Type": "Fixed fee", "Fee": "310000", "Currency": "USD", "Status": "Delivery", "Margin Target": "38", "Margin Actual": "27"}'::jsonb),
  ('engagements', 'ENG-2402', '{"Code": "ENG-2402", "Client": "Meridian Media", "Engagement": "Ad tech assessment", "Practice": "Media & Entertainment", "Partner": "Marcus Bell", "Delivery Lead": "Joe Duffy", "Start": "2026-01-12", "End": "2026-03-27", "Fee Type": "Fixed fee", "Fee": "95000", "Currency": "USD", "Status": "Closed", "Margin Target": "45", "Margin Actual": "48"}'::jsonb),
  ('engagements', 'ENG-2389', '{"Code": "ENG-2389", "Client": "Harbour Point Resorts", "Engagement": "Guest platform assessment", "Practice": "Travel & Hospitality", "Partner": "Marcus Bell", "Delivery Lead": "Leah Mbeki", "Start": "2025-09-15", "End": "2025-12-19", "Fee Type": "Fixed fee", "Fee": "120000", "Currency": "USD", "Status": "Closed", "Margin Target": "40", "Margin Actual": "41"}'::jsonb);
