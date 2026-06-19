CREATE OR REPLACE FUNCTION public.audit_product_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  SELECT id INTO v_actor FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  IF NEW.sale_price IS DISTINCT FROM OLD.sale_price THEN
    v_changes := v_changes || jsonb_build_object('sale_price', jsonb_build_object('from', OLD.sale_price, 'to', NEW.sale_price));
  END IF;
  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN
    v_changes := v_changes || jsonb_build_object('cost_price', jsonb_build_object('from', OLD.cost_price, 'to', NEW.cost_price));
  END IF;
  IF NEW.minimum_stock IS DISTINCT FROM OLD.minimum_stock THEN
    v_changes := v_changes || jsonb_build_object('minimum_stock', jsonb_build_object('from', OLD.minimum_stock, 'to', NEW.minimum_stock));
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('from', OLD.name, 'to', NEW.name));
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    v_changes := v_changes || jsonb_build_object('is_active', jsonb_build_object('from', OLD.is_active, 'to', NEW.is_active));
  END IF;

  IF v_changes <> '{}'::jsonb THEN
    INSERT INTO public.audit_logs(store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
    VALUES (NEW.store_id, v_actor, 'update', 'product', NEW.id,
            jsonb_build_object('changes', v_changes),
            jsonb_build_object('note', 'Alteração de produto', 'changes', v_changes));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_product_changes ON public.products;
CREATE TRIGGER trg_audit_product_changes
AFTER UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.audit_product_changes();