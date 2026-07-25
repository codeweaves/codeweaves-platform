-- Close unauthenticated Supabase Data API exposure.
--
-- These 5 public tables had RLS disabled while the anon/authenticated roles
-- retain Supabase's default table grants, so they were readable AND writable
-- over PostgREST with the public anon key (event_logs was leaking ~12.6k rows;
-- pii_tokens/agent_documents/agent_document_chunks/agent_integrations were the
-- same misconfiguration, empty at the time). Enabling RLS with no policy denies
-- all access to anon/authenticated. The application is unaffected: it connects
-- via the service-role/direct Postgres connection, which bypasses RLS.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY on an already-enabled table is a no-op.
ALTER TABLE public.event_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pii_tokens            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_integrations    ENABLE ROW LEVEL SECURITY;
