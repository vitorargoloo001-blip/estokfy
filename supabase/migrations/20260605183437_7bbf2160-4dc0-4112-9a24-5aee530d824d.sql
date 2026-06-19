
-- 1) Profiles: restringir INSERT ao proprietário (owner) apenas.
--    Gerentes ainda podem editar/desativar, mas só owner cria novos perfis.
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id = get_my_store_id()
    AND get_my_role() = 'owner'
  );

-- 2) Realtime: escopo por store_id no nome do tópico.
--    Aplica-se a mensagens broadcast/presence. postgres_changes já respeita RLS nas tabelas.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'realtime' AND c.relname = 'messages'
  ) THEN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS realtime_store_scoped_read ON realtime.messages';
    EXECUTE $POL$
      CREATE POLICY realtime_store_scoped_read ON realtime.messages
        FOR SELECT TO authenticated
        USING (
          public.get_my_store_id() IS NOT NULL
          AND realtime.topic() LIKE '%' || public.get_my_store_id()::text || '%'
        )
    $POL$;
    EXECUTE 'DROP POLICY IF EXISTS realtime_store_scoped_write ON realtime.messages';
    EXECUTE $POL$
      CREATE POLICY realtime_store_scoped_write ON realtime.messages
        FOR INSERT TO authenticated
        WITH CHECK (
          public.get_my_store_id() IS NOT NULL
          AND realtime.topic() LIKE '%' || public.get_my_store_id()::text || '%'
        )
    $POL$;
  END IF;
END $$;
