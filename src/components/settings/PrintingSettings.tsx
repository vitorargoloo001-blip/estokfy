import { Loader2, Save, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useStoreSettings } from '@/hooks/useStoreSettings';
import { DEFAULT_PRINT_SETTINGS } from '@/hooks/usePrintSettings';
import { printThermalReceipt } from '@/lib/receipt';

export default function PrintingSettings() {
  const s = useStoreSettings('printing');
  const v = (k: keyof typeof DEFAULT_PRINT_SETTINGS) =>
    s.settings[k] ?? (DEFAULT_PRINT_SETTINGS as any)[k];

  const handleTest = () => {
    printThermalReceipt(
      {
        storeName: 'Sua Loja',
        storePhone: '(11) 99999-9999',
        saleId: 'TESTE0001',
        createdAt: new Date().toISOString(),
        customerName: 'Cliente Teste',
        sellerName: 'Vendedor Teste',
        notes: v('show_notes') ? 'Comprovante de teste de impressão' : null,
        items: [
          { name: 'Produto A', qty: 2, unit_price: 25, line_total: 50 },
          { name: 'Produto B', qty: 1, unit_price: 75.5, line_total: 75.5 },
        ],
        gross: 125.5, discount: 5.5, shipping: 0, net: 120,
        amountPaid: 120, amountPending: 0, paymentStatus: 'paid',
        paymentMethods: ['pix'],
      },
      {
        paperWidth: v('paper_width'),
        copies: Number(v('copies')) || 1,
        showLogo: !!v('show_logo'),
        showNotes: !!v('show_notes'),
        footerMessage: v('footer_message'),
      },
    );
  };

  if (s.loading) {
    return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2"><Printer className="h-4 w-4" /> Impressão de cupom</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure como o comprovante térmico é impresso (impressora Tanca/USB via navegador).
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Configuração geral</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Ativar impressão térmica</Label>
              <p className="text-xs text-muted-foreground">Mostra o botão de cupom térmico nas vendas.</p>
            </div>
            <Switch checked={!!v('enabled')} onCheckedChange={c => s.update('enabled', c)} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Imprimir automaticamente após venda</Label>
              <p className="text-xs text-muted-foreground">Abre a janela de impressão ao finalizar uma venda.</p>
            </div>
            <Switch checked={!!v('auto_print')} onCheckedChange={c => s.update('auto_print', c)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Largura do papel</Label>
              <Select value={v('paper_width')} onValueChange={val => s.update('paper_width', val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="58mm">58 mm</SelectItem>
                  <SelectItem value="80mm">80 mm</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Quantidade de vias</Label>
              <Input type="number" min={1} max={5} value={v('copies')}
                onChange={e => s.update('copies', Math.max(1, Math.min(5, Number(e.target.value) || 1)))} />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div><Label className="text-sm">Mostrar logo / nome em destaque</Label></div>
            <Switch checked={!!v('show_logo')} onCheckedChange={c => s.update('show_logo', c)} />
          </div>

          <div className="flex items-center justify-between">
            <div><Label className="text-sm">Mostrar observação da venda</Label></div>
            <Switch checked={!!v('show_notes')} onCheckedChange={c => s.update('show_notes', c)} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Mensagem final</Label>
            <Input value={v('footer_message')} onChange={e => s.update('footer_message', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" onClick={handleTest}>
          <Printer className="h-4 w-4 mr-2" /> Testar impressão
        </Button>
        <Button onClick={s.save} disabled={!s.dirty || s.saving}>
          {s.saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Salvar configurações
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Dica: use a impressora Tanca configurada como impressora padrão do Windows.
        O sistema usa a janela de impressão do navegador, sem instalação extra.
      </p>
    </div>
  );
}
