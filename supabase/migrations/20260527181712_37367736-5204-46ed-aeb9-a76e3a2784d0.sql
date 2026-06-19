ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type = ANY (ARRAY[
    'initial_stock'::text,
    'purchase_in'::text,
    'sale_out'::text,
    'adjustment'::text,
    'return_in'::text,
    'return_out'::text,
    'manual_in'::text,
    'manual_out'::text,
    'transfer_in'::text,
    'transfer_out'::text,
    'cancel_reversal'::text,
    'inventory_fix'::text,
    'loss'::text
  ]));