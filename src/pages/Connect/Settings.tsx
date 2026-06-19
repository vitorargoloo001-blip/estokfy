import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface ConnectSettings {
  auto_reconciliation_enabled: boolean;
  min_confidence_auto: number;
  date_window_days: number;
  amount_tolerance: number;
}

export default function Settings() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<ConnectSettings>({
    auto_reconciliation_enabled: true,
    min_confidence_auto: 95,
    date_window_days: 35,
    amount_tolerance: 100,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile?.store_id) loadSettings();
  }, [profile?.store_id]);

  const loadSettings = async () => {
    if (!profile?.store_id) return;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("store_settings")
        .select("settings")
        .eq("store_id", profile.store_id)
        .eq("category", "connect")
        .single();

      if (error && error.code !== "PGRST116") throw error;

      if (data?.settings) {
        setSettings({
          auto_reconciliation_enabled: data.settings.auto_reconciliation_enabled ?? true,
          min_confidence_auto: data.settings.min_confidence_auto ?? 95,
          date_window_days: data.settings.date_window_days ?? 35,
          amount_tolerance: data.settings.amount_tolerance ?? 100,
        });
      }
    } catch (error) {
      console.error("Erro ao carregar configurações:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!profile?.store_id) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("store_settings")
        .upsert({
          store_id: profile.store_id,
          category: "connect",
          settings: settings,
          updated_at: new Date().toISOString(),
        })
        .eq("store_id", profile.store_id)
        .eq("category", "connect");

      if (error) throw error;

      toast({
        title: "Configurações salvas",
        description: "As configurações do Estokfy Connect foram atualizadas.",
      });
    } catch (error) {
      console.error("Erro ao salvar:", error);
      toast({
        title: "Erro",
        description: "Não foi possível salvar as configurações.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground mt-2">
          Personalize o comportamento do Estokfy Connect
        </p>
      </div>

      <div className="grid gap-6 max-w-2xl">
        {/* Conciliação Automática */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conciliação Automática</CardTitle>
            <CardDescription>
              Confirme automaticamente transações quando a confiança atingir o limite mínimo
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-reconciliation">Ativar Conciliação Automática</Label>
              <Switch
                id="auto-reconciliation"
                checked={settings.auto_reconciliation_enabled}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, auto_reconciliation_enabled: checked })
                }
              />
            </div>

            {settings.auto_reconciliation_enabled && (
              <div className="space-y-2">
                <Label htmlFor="min-confidence">
                  Confiança Mínima para Confirmação Automática
                </Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="min-confidence"
                    type="number"
                    min="0"
                    max="100"
                    value={settings.min_confidence_auto}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        min_confidence_auto: parseInt(e.target.value) || 0,
                      })
                    }
                    className="max-w-[120px]"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Transações com confiança igual ou maior serão automaticamente confirmadas
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Janela de Busca */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Janela de Busca por Data</CardTitle>
            <CardDescription>
              Quantos dias antes/depois da transação buscar vendas correspondentes
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="date-window">Dias</Label>
            <div className="flex items-center gap-4">
              <Input
                id="date-window"
                type="number"
                min="1"
                max="365"
                value={settings.date_window_days}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    date_window_days: parseInt(e.target.value) || 1,
                  })
                }
                className="max-w-[120px]"
              />
              <span className="text-sm text-muted-foreground">dias</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Aumentar permite buscar vendas mais antigas (mais lento), diminuir é mais preciso
            </p>
          </CardContent>
        </Card>

        {/* Tolerância de Valor */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tolerância de Valor</CardTitle>
            <CardDescription>
              Diferença máxima permitida entre valor da venda e recebimento
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="amount-tolerance">Valor (R$)</Label>
            <div className="flex items-center gap-4">
              <Input
                id="amount-tolerance"
                type="number"
                min="0"
                step="0.01"
                value={settings.amount_tolerance}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    amount_tolerance: parseFloat(e.target.value) || 0,
                  })
                }
                className="max-w-[120px]"
              />
              <span className="text-sm text-muted-foreground">R$</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Transações com diferença menor serão consideradas como correspondência potencial
            </p>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar Configurações"}
          </Button>
        </div>
      </div>

      {/* Info */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-base text-blue-900">Dica</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-800">
          <p>
            Quanto mais restritivas as configurações, mais precisa a conciliação automática será.
            Quanto mais permissivas, mais transações serão automaticamente confirmadas (menos
            intervenção manual).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
