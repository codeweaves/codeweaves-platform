-- Lead field type for a person's name (ADR-0025).
--
-- Additive: existing fields keep their type. An operator switches a field to
-- NAME in the agent editor; extracted values for it must then look like a
-- name (letters, spaces, . ' -), or they are not stored.
ALTER TYPE "DataFieldType" ADD VALUE IF NOT EXISTS 'NAME' AFTER 'STRING';
