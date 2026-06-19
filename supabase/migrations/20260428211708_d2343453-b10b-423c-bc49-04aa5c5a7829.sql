REVOKE EXECUTE ON FUNCTION public.refresh_store_notifications() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.product_analytics(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.product_history(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.customer_360(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.refresh_store_notifications() TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_analytics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_history(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_360(uuid) TO authenticated;