import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface PrintSettings {
  enabled: boolean;
  paper_width: '58mm' | '80mm';
  auto_print: boolean;
  copies: number;
  show_logo: boolean;
  show_notes: boolean;
  footer_message: string;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  enabled: true,
  paper_width: '80mm',
  auto_print: false,
  copies: 1,
  show_logo: true,
  show_notes: true,
  footer_message: 'Obrigado pela preferência.',
};

export function usePrintSettings() {
  const { profile } = useAuth();
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!profile?.store_id) return;
    setLoading(true);
    const { data } = await supabase
      .from('store_settings' as any)
      .select('settings')
      .eq('store_id', profile.store_id)
      .eq('category', 'printing')
      .maybeSingle();
    if (data && (data as any).settings && typeof (data as any).settings === 'object') {
      setSettings({ ...DEFAULT_PRINT_SETTINGS, ...((data as any).settings as Partial<PrintSettings>) });
    } else {
      setSettings(DEFAULT_PRINT_SETTINGS);
    }
    setLoading(false);
  }, [profile?.store_id]);

  useEffect(() => { reload(); }, [reload]);

  return { settings, loading, reload };
}
