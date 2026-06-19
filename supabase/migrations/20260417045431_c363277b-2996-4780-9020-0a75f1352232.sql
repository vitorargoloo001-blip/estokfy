UPDATE public.app_versions SET is_active = false WHERE is_active = true;
INSERT INTO public.app_versions (app_version, build_id, is_active, update_message)
VALUES ('1.0.1', 'test-' || extract(epoch from now())::text, true, 'Teste de propagação instantânea via realtime');