UPDATE public.app_versions SET is_active = false WHERE is_active = true;
UPDATE public.app_versions SET is_active = true WHERE app_version = '1.0.0' AND build_id = '2026.04.16.01';
DELETE FROM public.app_versions WHERE app_version = '1.0.1' AND build_id LIKE 'test-%';