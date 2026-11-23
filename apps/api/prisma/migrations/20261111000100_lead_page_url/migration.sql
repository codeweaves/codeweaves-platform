-- Lead page URL (ADR-0020): record the page a visitor was on when they gave
-- their lead details. All three columns are nullable or have a constant
-- default, so Postgres adds them without rewriting the tables.

-- Per-agent switch. Off for every existing agent.
ALTER TABLE "agents" ADD COLUMN "capturePageUrl" BOOLEAN NOT NULL DEFAULT false;

-- The page of each visitor message (web widget only, switch on only).
ALTER TABLE "chat_messages" ADD COLUMN "pageUrl" VARCHAR(2048);

-- The page where the lead details were given.
ALTER TABLE "collected_data" ADD COLUMN "pageUrl" VARCHAR(2048);
