REVOKE ALL ON FUNCTION public.resolve_product_ids_by_filter(uuid, text, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_product_ids_by_filter(text, uuid, text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_bulk_product_updates(jsonb, uuid[], jsonb, jsonb, uuid[], int, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_product_ids_by_filter(uuid, text, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_product_ids_by_filter(text, uuid, text, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_bulk_product_updates(jsonb, uuid[], jsonb, jsonb, uuid[], int, uuid) TO authenticated;