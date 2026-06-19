import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useLowStockAlert(storeId: string | undefined) {
  const [count, setCount] = useState(0);
  const toasted = useRef(false);

  useEffect(() => {
    if (!storeId) return;
    const fetch = async () => {
      const { data } = await supabase
        .from('products')
        .select('id, on_hand, minimum_stock')
        .eq('store_id', storeId)
        .eq('is_active', true);
      const low = (data || []).filter(p => p.on_hand <= p.minimum_stock);
      setCount(low.length);
      if (low.length > 0 && !toasted.current) {
        toasted.current = true;
        toast.warning(`${low.length} produto(s) com estoque baixo`, {
          description: 'Verifique a página de estoque.',
          duration: 6000,
        });
      }
    };
    fetch();
  }, [storeId]);

  return count;
}
