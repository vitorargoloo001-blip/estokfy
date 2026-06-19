-- Tabela de controle de versões do app
CREATE TABLE public.app_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  app_version text NOT NULL,
  build_id text NOT NULL,
  minimum_supported_version text NOT NULL DEFAULT '1.0.0',
  update_required boolean NOT NULL DEFAULT false,
  update_message text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Garante apenas uma versão ativa por vez
CREATE UNIQUE INDEX app_versions_only_one_active
  ON public.app_versions ((is_active))
  WHERE is_active = true;

CREATE INDEX app_versions_active_idx ON public.app_versions (is_active, created_at DESC);

ALTER TABLE public.app_versions ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado pode ler (precisa para saber se está desatualizado)
CREATE POLICY "app_versions_select_all"
  ON public.app_versions FOR SELECT
  TO authenticated
  USING (true);

-- Apenas super-admins podem inserir/editar
CREATE POLICY "app_versions_insert_sa"
  ON public.app_versions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "app_versions_update_sa"
  ON public.app_versions FOR UPDATE
  TO authenticated
  USING (public.is_super_admin());

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION public.touch_app_versions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_versions_touch_updated_at
  BEFORE UPDATE ON public.app_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_app_versions_updated_at();

-- Versão inicial
INSERT INTO public.app_versions (app_version, build_id, minimum_supported_version, update_required, update_message, is_active)
VALUES ('1.0.0', '2026.04.16.01', '1.0.0', false, 'Nova versão disponível com melhorias e correções.', true);