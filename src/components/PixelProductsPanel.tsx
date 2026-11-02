import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Package, RefreshCw, AlertTriangle } from 'lucide-react';

export interface PixelProductError {
  external_id: string | null;
  error: string;
}

export interface PixelProductSync {
  id: string;
  created_at: string;
  created: number;
  updated: number;
  errors: number;
  items: number;
  errors_detail: PixelProductError[];
}

// Códigos que a função pixel_sync_products devolve, com o texto para a loja.
export const PIXEL_PRODUCT_ERRORS: Array<{ code: string; text: string }> = [
  { code: 'external_id_obrigatorio', text: 'Item sem id da loja online (external_id).' },
  { code: 'nome_obrigatorio', text: 'Produto sem nome.' },
  { code: 'custo_invalido', text: 'Custo negativo.' },
  { code: 'preco_invalido', text: 'Preço negativo.' },
  { code: 'estoque_minimo_invalido', text: 'Estoque mínimo negativo.' },
  { code: 'estoque_invalido', text: 'Estoque negativo.' },
  { code: 'sku_ja_ligado_a_outro_produto_da_loja_online', text: 'SKU já usado por outro produto da loja online. Nada foi alterado.' },
  { code: 'barcode_ja_ligado_a_outro_produto_da_loja_online', text: 'Código de barras já usado por outro produto da loja online. Nada foi alterado.' },
  { code: 'invalid input syntax for type integer', text: 'Estoque ou estoque mínimo que não é número inteiro.' },
  { code: 'invalid input syntax for type numeric', text: 'Preço ou custo que não é número.' },
];

// Traduz a mensagem do banco para o texto da tela. Mensagem desconhecida volta como veio.
export function describePixelProductError(message: string): string {
  const hit = PIXEL_PRODUCT_ERRORS.find(({ code }) => message.includes(code));
  return hit ? hit.text : message;
}

function toSync(row: { id: string; created_at: string; after_json: unknown }): PixelProductSync {
  const data = (row.after_json ?? {}) as Record<string, unknown>;
  const detail = Array.isArray(data.errors_detail) ? (data.errors_detail as PixelProductError[]) : [];
  return {
    id: row.id,
    created_at: row.created_at,
    created: Number(data.created ?? 0),
    updated: Number(data.updated ?? 0),
    errors: Number(data.errors ?? 0),
    items: Number(data.items ?? 0),
    errors_detail: detail,
  };
}

export default function PixelProductsPanel({ storeId }: { storeId: string }) {
  const [syncs, setSyncs] = useState<PixelProductSync[]>([]);
  const [productCount, setProductCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [logs, count] = await Promise.all([
      supabase
        .from('audit_logs')
        .select('id, created_at, after_json')
        .eq('store_id', storeId)
        .eq('action', 'pixel_products_sync')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', storeId)
        .not('external_id', 'is', null),
    ]);
    if (logs.error) toast.error('Não foi possível carregar os envios de produtos.');
    else setSyncs((logs.data ?? []).map(toSync));
    setProductCount(count.count ?? 0);
    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const lastSync = syncs[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Produtos recebidos da loja online</p>
            <p className="text-2xl font-bold mt-1">{productCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Último envio</p>
            <p className="text-sm font-medium mt-1">
              {lastSync ? new Date(lastSync.created_at).toLocaleString('pt-BR') : 'Nenhum envio ainda'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4" /> Envios da loja online</CardTitle>
          <CardDescription>
            A loja envia os produtos pela API, com o mesmo Pixel ID e Secret Key. Veja como integrar em{' '}
            <Link to="/docs/pixel#produtos" className="underline">Documentação do Pixel</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </div>

          {!loading && syncs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Nenhum envio de produtos recebido ainda.</p>
              <p className="text-xs mt-1">Quando a loja online chamar a API, cada envio aparece aqui com o resultado.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead>Criados</TableHead>
                  <TableHead>Atualizados</TableHead>
                  <TableHead>Erros</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncs.map((sync) => (
                  <Fragment key={sync.id}>
                    <TableRow>
                      <TableCell className="text-xs">{new Date(sync.created_at).toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-xs">{sync.items}</TableCell>
                      <TableCell className="text-xs">{sync.created}</TableCell>
                      <TableCell className="text-xs">{sync.updated}</TableCell>
                      <TableCell className="text-xs">
                        {sync.errors > 0 ? (
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setOpenId(openId === sync.id ? null : sync.id)}>
                            <Badge variant="outline" className="text-destructive border-destructive/40">{sync.errors}</Badge>
                            <span className="ml-1">{openId === sync.id ? 'Ocultar' : 'Ver motivos'}</span>
                          </Button>
                        ) : (
                          '0'
                        )}
                      </TableCell>
                    </TableRow>
                    {openId === sync.id && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/40">
                          <ul className="space-y-1 text-xs">
                            {sync.errors_detail.map((err, i) => (
                              <li key={i}>
                                <span className="font-mono">{err.external_id ?? 'sem id'}</span>: {describePixelProductError(err.error)}
                              </li>
                            ))}
                          </ul>
                          {sync.errors > sync.errors_detail.length && (
                            <p className="text-xs text-muted-foreground mt-2">
                              E mais {sync.errors - sync.errors_detail.length} erro(s) não listados.
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
