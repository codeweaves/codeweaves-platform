-- Safety net: auto-enable RLS on every new table created in the `public`
-- schema, so a future table can never silently repeat the unauthenticated Data
-- API exposure fixed in the previous migration.
--
-- RLS with no policy = deny-all to anon/authenticated. The app's service-role
-- connection bypasses RLS, so this never breaks Prisma-backed access. If a
-- future table genuinely needs public Data API access, add an explicit policy.
--
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
    WHERE command_tag = 'CREATE TABLE' AND object_type = 'table'
  LOOP
    IF split_part(obj.object_identity, '.', 1) = 'public' THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS auto_enable_rls_trigger;
CREATE EVENT TRIGGER auto_enable_rls_trigger
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE')
  EXECUTE FUNCTION public.auto_enable_rls();
