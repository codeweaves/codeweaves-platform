-- Final gap in the auto-RLS safety net (see 20260725000100 / 20260725000200).
--
-- Widely-repeated docs claim `SELECT ... INTO` is reported to event triggers as
-- `CREATE TABLE AS`. Verified empirically on this PostgreSQL 17 instance: it is
-- NOT. `pg_event_trigger_ddl_commands()` reports its own distinct command tag,
-- `SELECT INTO`, so a table created that way was still getting RLS OFF even
-- after 20260725000200 added `CREATE TABLE AS`.
--
-- Measured tags for the three table-creation paths on PG 17:
--   CREATE TABLE t (...)            -> 'CREATE TABLE'
--   CREATE TABLE t AS SELECT ...    -> 'CREATE TABLE AS'
--   SELECT ... INTO t               -> 'SELECT INTO'
--
-- All three are now covered. Idempotent: safe to re-run.
CREATE OR REPLACE FUNCTION public.auto_enable_rls()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type = 'table'
  LOOP
    IF split_part(obj.object_identity, '.', 1) = 'public' THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
    END IF;
  END LOOP;
END;
$$;

-- The trigger's TAG filter is immutable, so drop + re-create to widen it.
DROP EVENT TRIGGER IF EXISTS auto_enable_rls_trigger;
CREATE EVENT TRIGGER auto_enable_rls_trigger
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.auto_enable_rls();
