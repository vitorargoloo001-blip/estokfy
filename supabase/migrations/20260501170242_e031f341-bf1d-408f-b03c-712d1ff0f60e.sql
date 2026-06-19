-- Revoga EXECUTE de anon em todas as funções SECURITY DEFINER do schema public.
-- Mantém GRANT para authenticated. As funções já validavam acesso via
-- get_my_store_id/get_my_role, mas agora bloqueiam na primeira camada.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM anon, public',
                   r.schema_name, r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated',
                   r.schema_name, r.proname, r.args);
  END LOOP;
END $$;