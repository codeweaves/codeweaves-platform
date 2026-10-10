-- ADR-0012, PR 3: list prices for WhatsApp messages and Resend email.
-- Data only. Sources: docs/research/provider-costs/messaging.md, retrieved
-- 2026-10-10. Effective from 2026-01-01, like the PR 2 seed.

INSERT INTO "provider_prices" ("id", "provider", "model", "unit", "price", "per", "currency", "effectiveFrom", "sourceUrl", "note") VALUES
  -- Meta WhatsApp, INR per delivered message, India (+91) recipients, by
  -- pricing.category from the status webhook. The client's own WABA pays Meta
  -- (usage rows are billedTo = CLIENT).
  -- Free messages are never recorded: Meta sends billable=false for the
  -- first 1,000 service messages a month per number, the customer service
  -- window and free entry points. That free tier is NOT deducted per message
  -- here, so reports must state it. Utility and authentication are list
  -- rates before volume tiers. Other countries are stored as '<category>:intl'
  -- and stay unpriced.
  (gen_random_uuid(), 'meta_whatsapp', 'service',        'MESSAGE', 0.115,  1, 'INR', '2026-01-01', 'https://developers.facebook.com/docs/whatsapp/pricing', 'India rate card effective 2026-10-01. First 1,000 service messages a month per number are free (sent as billable=false, not recorded); the free tier is not deducted per message, so reports must state it'),
  (gen_random_uuid(), 'meta_whatsapp', 'utility',        'MESSAGE', 0.115,  1, 'INR', '2026-01-01', 'https://developers.facebook.com/docs/whatsapp/pricing', 'India list rate before volume tiers; free inside the customer service window (billable=false)'),
  (gen_random_uuid(), 'meta_whatsapp', 'authentication', 'MESSAGE', 0.115,  1, 'INR', '2026-01-01', 'https://developers.facebook.com/docs/whatsapp/pricing', 'India list rate before volume tiers'),
  (gen_random_uuid(), 'meta_whatsapp', 'marketing',      'MESSAGE', 0.8631, 1, 'INR', '2026-01-01', 'https://developers.facebook.com/docs/whatsapp/pricing', 'India rate card effective 2026-10-01'),

  -- Resend, per recipient. The free plan (3,000 emails a month, 100 a day)
  -- costs nothing per email; add a dated row when the plan changes.
  (gen_random_uuid(), 'resend', 'email', 'EMAIL', 0, 1, 'USD', '2026-01-01', 'https://resend.com/pricing', 'Free plan: 3,000 emails/month, 100/day, $0. Every recipient counts as one email');
