import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export function useStoreSettings(category: string) {
  const { profile } = useAuth();
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setLoading(true);
    supabase
      .from('store_settings' as any)
      .select('settings')
      .eq('store_id', profile.store_id)
      .eq('category', category)
      .maybeSingle()
      .then(({ data }: any) => {
        if (data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
          setSettings(data.settings as Record<string, any>);
        }
        setLoading(false);
      });
  }, [profile, category]);

  const update = useCallback((key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!profile) return;
    setSaving(true);
    const { error } = await supabase
      .from('store_settings' as any)
      .upsert({
        store_id: profile.store_id,
        category,
        settings,
        updated_at: new Date().toISOString(),
        updated_by: profile.id,
      }, { onConflict: 'store_id,category' });

    if (error) {
      toast.error('Erro ao salvar configurações');
      console.error(error);
    } else {
      toast.success('Configurações salvas!');
      setDirty(false);
    }
    setSaving(false);
  }, [profile, category, settings]);

  return { settings, loading, saving, dirty, update, save, setSettings };
}
