-- Teams and Slack are channels this product ships, but device_type was created
-- when the only ones were WhatsApp and the web widget. Every turn logged from
-- Teams or Slack was therefore refused by the enum, silently, because the insert
-- is best-effort: the assistant had no history on either channel, and nothing
-- said so.
alter type public.device_type add value if not exists 'teams';
alter type public.device_type add value if not exists 'slack';
