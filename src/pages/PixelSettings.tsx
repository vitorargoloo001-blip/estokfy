import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Code, Copy, Check, Plus, RefreshCw, Eye, EyeOff, Loader2, Wifi, WifiOff,
  CheckCircle2, XCircle, Clock, AlertTriangle, Zap, Globe, Shield, Activity,
} from 'lucide-react';

const BASE_URL = import.meta.env.VITE_SUPABASE_URL;

interface StorePixel {
  id: string;
  store_id: string;
  pixel_id: string;
  public_key: string;
  secret_key: string;
  is_active: boolean;
  allowed_domains: string[];
  created_at: string;
}

interface PixelEvent {
  id: string;
  event_type: string;
  external_event_id: string | null;
  external_order_id: string | null;
  processing_status: string;
  error_message: string | null;
  received_at: string;
  processed_at: string | null;
  payload_json: any;
}

const statusMap: Record<string, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  processed: { label: 'Processado', icon: CheckCircle2, cls: 'text-green-600' },
  pending: { label: 'Pendente', icon: Clock, cls: 'text-amber-500' },
  error: { label: 'Erro', icon: XCircle, cls: 'text-destructive' },
};

const eventLabels: Record<string, string> = {
  purchase_approved: 'Compra Aprovada',
  purchase_cancelled: 'Compra Cancelada',
  refund_created: 'Reembolso Criado',
  refund_completed: 'Reembolso Concluído',
  exchange_created: 'Troca Criada',
  customer_created: 'Cliente Criado',
  payment_approved: 'Pagamento Aprovado',
  payment_failed: 'Pagamento Falhou',
};

export default function PixelSettings() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const [pixel, setPixel] = useState<StorePixel | null>(null);
  const [events, setEvents] = useState<PixelEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [domainInput, setDomainInput] = useState('');
  const [tab, setTab] = useState('config');
  const [eventFilter, setEventFilter] = useState('all');

  const storeId = profile?.store_id;

  const fetchPixel = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    const { data } = await supabase
      .from('store_pixels')
      .select('*')
      .eq('store_id', storeId)
      .maybeSingle();
    setPixel(data as StorePixel | null);
    setLoading(false);
  }, [storeId]);

  const fetchEvents = useCallback(async () => {
    if (!storeId) return;
    let q = supabase
      .from('pixel_events')
      .select('id, event_type, external_event_id, external_order_id, processing_status, error_message, received_at, processed_at, payload_json')
      .eq('store_id', storeId)
      .order('received_at', { ascending: false })
      .limit(50);
    if (eventFilter !== 'all') q = q.eq('processing_status', eventFilter);
    const { data } = await q;
    setEvents((data || []) as PixelEvent[]);
  }, [storeId, eventFilter]);

  useEffect(() => { fetchPixel(); }, [fetchPixel]);
  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const createPixel = async () => {
    if (!storeId) return;
    setCreating(true);
    const { error } = await supabase.from('store_pixels').insert({ store_id: storeId });
    if (error) {
      toast.error('Erro ao criar pixel: ' + error.message);
    } else {
      toast.success('Pixel criado com sucesso!');
      await fetchPixel();
    }
    setCreating(false);
  };

  const toggleActive = async () => {
    if (!pixel) return;
    const { error } = await supabase
      .from('store_pixels')
      .update({ is_active: !pixel.is_active, updated_at: new Date().toISOString() })
      .eq('id', pixel.id);
    if (error) toast.error('Erro ao atualizar');
    else {
      setPixel({ ...pixel, is_active: !pixel.is_active });
      toast.success(pixel.is_active ? 'Pixel desativado' : 'Pixel ativado');
    }
  };

  const addDomain = async () => {
    if (!pixel || !domainInput.trim()) return;
    const domain = domainInput.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (pixel.allowed_domains.includes(domain)) { toast.info('Domínio já existe'); return; }
    const newDomains = [...pixel.allowed_domains, domain];
    const { error } = await supabase
      .from('store_pixels')
      .update({ allowed_domains: newDomains, updated_at: new Date().toISOString() })
      .eq('id', pixel.id);
    if (error) toast.error('Erro ao salvar');
    else { setPixel({ ...pixel, allowed_domains: newDomains }); setDomainInput(''); toast.success('Domínio adicionado'); }
  };

  const removeDomain = async (domain: string) => {
    if (!pixel) return;
    const newDomains = pixel.allowed_domains.filter(d => d !== domain);
    const { error } = await supabase
      .from('store_pixels')
      .update({ allowed_domains: newDomains, updated_at: new Date().toISOString() })
      .eq('id', pixel.id);
    if (error) toast.error('Erro ao remover');
    else { setPixel({ ...pixel, allowed_domains: newDomains }); toast.success('Domínio removido'); }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(`${label} copiado!`);
    setTimeout(() => setCopied(null), 2000);
  };

  const snippet = pixel
    ? `<!-- Estokfy Pixel -->
<script>
(function(){
  var CPX_ID="${pixel.pixel_id}";
  var CPX_KEY="${pixel.secret_key}";
  var CPX_URL="${BASE_URL}/functions/v1/pixel-events";
  var pixel={
    track:function(eventType,data){
      data=data||{};
      fetch(CPX_URL,{
        method:"POST",
        headers:{"Content-Type":"application/json","x-pixel-id":CPX_ID,"x-pixel-key":CPX_KEY},
        body:JSON.stringify({event_type:eventType,external_event_id:data.event_id||null,external_order_id:data.order_id||null,external_customer_id:data.customer_id||null,payload:data})
      }).catch(function(){});
    }
  };
  window.EstokfyPixel=pixel;
  window.ControlixPixel=pixel;/* alias legado */
})();
</script>
<!-- End Estokfy Pixel -->`
    : '';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!pixel) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Zap className="h-6 w-6 text-primary" /> Estokfy Pixel</h1>
          <p className="text-muted-foreground text-sm mt-1">Receba automaticamente vendas, cancelamentos e clientes do seu site.</p>
        </div>
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="text-lg">Ativar Estokfy Pixel</CardTitle>
            <CardDescription>Crie seu pixel exclusivo para integrar seu site com o Estokfy.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={createPixel} disabled={creating} className="w-full">
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Criar meu Pixel
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = {
    total: events.length,
    processed: events.filter(e => e.processing_status === 'processed').length,
    errors: events.filter(e => e.processing_status === 'error').length,
    pending: events.filter(e => e.processing_status === 'pending').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Zap className="h-6 w-6 text-primary" /> Estokfy Pixel</h1>
          <p className="text-muted-foreground text-sm mt-1">Integração automática de vendas e eventos do seu site.</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={pixel.is_active ? 'default' : 'secondary'} className="gap-1">
            {pixel.is_active ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {pixel.is_active ? 'Ativo' : 'Inativo'}
          </Badge>
          <Switch checked={pixel.is_active} onCheckedChange={toggleActive} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Eventos', value: stats.total, icon: Activity, cls: 'text-primary' },
          { label: 'Processados', value: stats.processed, icon: CheckCircle2, cls: 'text-green-600' },
          { label: 'Erros', value: stats.errors, icon: XCircle, cls: 'text-destructive' },
          { label: 'Pendentes', value: stats.pending, icon: Clock, cls: 'text-amber-500' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`h-5 w-5 ${s.cls}`} />
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={isMobile ? 'w-full grid grid-cols-3' : ''}>
          <TabsTrigger value="config"><Shield className="h-4 w-4 mr-1" /> Configuração</TabsTrigger>
          <TabsTrigger value="snippet"><Code className="h-4 w-4 mr-1" /> Instalação</TabsTrigger>
          <TabsTrigger value="events"><Activity className="h-4 w-4 mr-1" /> Eventos</TabsTrigger>
        </TabsList>

        {/* Config Tab */}
        <TabsContent value="config" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Credenciais do Pixel</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">Pixel ID</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono truncate">{pixel.pixel_id}</code>
                  <Button size="icon" variant="outline" onClick={() => copyToClipboard(pixel.pixel_id, 'Pixel ID')}>
                    {copied === 'Pixel ID' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Secret Key</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono truncate">
                    {showSecret ? pixel.secret_key : '••••••••••••••••••••••••'}
                  </code>
                  <Button size="icon" variant="outline" onClick={() => setShowSecret(!showSecret)}>
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => copyToClipboard(pixel.secret_key, 'Secret Key')}>
                    {copied === 'Secret Key' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" /> Domínios Autorizados</CardTitle>
              <CardDescription>Deixe vazio para aceitar eventos de qualquer domínio.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="exemplo.com.br"
                  value={domainInput}
                  onChange={e => setDomainInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addDomain()}
                  className="flex-1"
                />
                <Button onClick={addDomain} size="sm"><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
              </div>
              {pixel.allowed_domains.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pixel.allowed_domains.map(d => (
                    <Badge key={d} variant="secondary" className="gap-1 cursor-pointer" onClick={() => removeDomain(d)}>
                      {d} <XCircle className="h-3 w-3" />
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Snippet Tab */}
        <TabsContent value="snippet" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Script de Instalação</CardTitle>
              <CardDescription>Copie e cole no HTML do seu site, antes do &lt;/body&gt;.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <ScrollArea className="h-[200px] rounded border bg-muted p-3">
                  <pre className="text-xs font-mono whitespace-pre-wrap">{snippet}</pre>
                </ScrollArea>
                <Button
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(snippet, 'Snippet')}
                >
                  {copied === 'Snippet' ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                  Copiar
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Como usar</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="font-medium mb-1">Registrar uma compra:</p>
                <pre className="bg-muted p-3 rounded text-xs font-mono overflow-x-auto">{`ControlixPixel.track("purchase_approved", {
  order_id: "ORD-123",
  event_id: "EVT-456",
  customer: {
    name: "Maria Silva",
    email: "maria@email.com",
    phone: "11999999999"
  },
  total_amount: 199.90,
  payment_method: "pix",
  items: [
    { name: "Produto X", qty: 1, price: 199.90 }
  ]
});`}</pre>
              </div>
              <div>
                <p className="font-medium mb-1">Cancelar uma compra:</p>
                <pre className="bg-muted p-3 rounded text-xs font-mono overflow-x-auto">{`ControlixPixel.track("purchase_cancelled", {
  order_id: "ORD-123"
});`}</pre>
              </div>
              <div>
                <p className="font-medium mb-1">Eventos suportados:</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {Object.entries(eventLabels).map(([k, v]) => (
                    <Badge key={k} variant="outline" className="text-xs">{v}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Events Tab */}
        <TabsContent value="events" className="space-y-4 mt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => fetchEvents()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
            </Button>
            {['all', 'processed', 'pending', 'error'].map(f => (
              <Button
                key={f}
                size="sm"
                variant={eventFilter === f ? 'default' : 'outline'}
                onClick={() => setEventFilter(f)}
              >
                {f === 'all' ? 'Todos' : statusMap[f]?.label || f}
              </Button>
            ))}
          </div>

          {events.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Nenhum evento recebido ainda.</p>
                <p className="text-xs mt-1">Instale o pixel no seu site e envie o primeiro evento.</p>
              </CardContent>
            </Card>
          ) : isMobile ? (
            <div className="space-y-2">
              {events.map(evt => {
                const st = statusMap[evt.processing_status] || statusMap.pending;
                const StIcon = st.icon;
                return (
                  <Card key={evt.id}>
                    <CardContent className="p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">{eventLabels[evt.event_type] || evt.event_type}</Badge>
                        <span className={`flex items-center gap-1 text-xs ${st.cls}`}><StIcon className="h-3 w-3" /> {st.label}</span>
                      </div>
                      {evt.external_order_id && <p className="text-xs text-muted-foreground">Pedido: {evt.external_order_id}</p>}
                      <p className="text-xs text-muted-foreground">{new Date(evt.received_at).toLocaleString('pt-BR')}</p>
                      {evt.error_message && <p className="text-xs text-destructive">{evt.error_message}</p>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Evento</TableHead>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Recebido</TableHead>
                    <TableHead>Erro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map(evt => {
                    const st = statusMap[evt.processing_status] || statusMap.pending;
                    const StIcon = st.icon;
                    return (
                      <TableRow key={evt.id}>
                        <TableCell><Badge variant="outline" className="text-xs">{eventLabels[evt.event_type] || evt.event_type}</Badge></TableCell>
                        <TableCell className="text-xs font-mono">{evt.external_order_id || '—'}</TableCell>
                        <TableCell><span className={`flex items-center gap-1 text-xs ${st.cls}`}><StIcon className="h-3 w-3" /> {st.label}</span></TableCell>
                        <TableCell className="text-xs">{new Date(evt.received_at).toLocaleString('pt-BR')}</TableCell>
                        <TableCell className="text-xs text-destructive max-w-[200px] truncate">{evt.error_message || '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
