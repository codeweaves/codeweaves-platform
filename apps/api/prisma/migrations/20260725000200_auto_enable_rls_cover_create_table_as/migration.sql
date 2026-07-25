-- Close a gap in the auto-RLS safety net added by
-- 20260725000100_auto_enable_rls_on_new_public_tables.
--
-- That trigger only matched the `CREATE TABLE` command tag. Postgres reports
-- `CREATE TABLE AS` for BOTH `CREATE TABLE ... AS SELECT` and `SELECT ... INTO`,
-- so a public table created either of those ways was still created with RLS
-- OFF — defeating the "every new public table gets RLS" guarantee.
--
-- Redefines the function and re-creates the event trigger to cover both tags.
-- Idempotent: CREATE OR REPLACE + DROP ... IF EXISTS make re-runs safe.
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
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS')
      AND object_type = 'table'
  LOOP
    IF split_part(obj.object_identity, '.', 1) = 'public' THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
    END IF;
  END LOOP;
END;
$$;

-- The trigger's TAG filter is immutable, so it must be dropped and re-created
-- to widen it (ALTER EVENT TRIGGER cannot change WHEN TAG).
DROP EVENT TRIGGER IF EXISTS auto_enable_rls_trigger;
CREATE EVENT TRIGGER auto_enable_rls_trigger
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS')
  EXECUTE FUNCTION public.auto_enable_rls();
