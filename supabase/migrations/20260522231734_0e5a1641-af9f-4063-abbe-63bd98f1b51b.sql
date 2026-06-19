
-- 1) Fix product-images storage policies: scope UPDATE/DELETE to the store folder
DROP POLICY IF EXISTS "Authenticated users can update product images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete product images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload product images" ON storage.objects;

CREATE POLICY "Product images store-scoped upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (public.get_my_store_id())::text
);

CREATE POLICY "Product images store-scoped update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (public.get_my_store_id())::text
)
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (public.get_my_store_id())::text
);

CREATE POLICY "Product images store-scoped delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (public.get_my_store_id())::text
);

-- 2) Anchor get_my_role() to the current store
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select p.role
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.store_id = public.get_my_store_id()
  limit 1
$function$;
