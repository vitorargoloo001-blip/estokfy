import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/api';
import { toast } from 'sonner';

interface PixChargeDialogProps {
  saleId: string | null;
  amountPending: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaid?: () => void;
}

interface PixCreateResponse {
  chargeId: string;
  amount: number;
  status: string;
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl: string;
  expiresAt?: string;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Cobrança Pix da venda. A quitação não acontece aqui: quando o Mercado Pago
 * confirma o pagamento, o servidor registra o recebimento. Esta tela só mostra
 * o QR Code e acompanha o status.
 */
export default function PixChargeDialog({ saleId, amountPending, open, onOpenChange, onPaid }: PixChargeDialogProps) {
  const [loading, setLoading] = useState(false);
  const [charge, setCharge] = useState<PixCreateResponse | null>(null);
  const [status, setStatus] = useState<string>('');

  // Abre (ou reaproveita) a cobrança quando o diálogo abre.
  useEffect(() => {
    if (!open || !saleId) return;
    let cancelled = false;
    setLoading(true);
    setCharge(null);
    setStatus('');
    invokeEdgeFunction<PixCreateResponse>('mercadopago-pix-create', { body: { saleId } })
      .then((res) => {
        if (cancelled) return;
        setCharge(res);
        setStatus(res.status);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : 'Não foi possível gerar o Pix');
        onOpenChange(false);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, saleId, onOpenChange]);

  // Acompanha o status até a confirmação do Mercado Pago. Pergunta ao servidor,
  // que consulta o Mercado Pago e quita a venda se já estiver pago — assim não
  // dependemos só do aviso do webhook. Se a consulta falhar, lê o banco.
  useEffect(() => {
    if (!open || !charge || ['paid', 'expired', 'cancelled', 'failed'].includes(status)) return;
    const timer = setInterval(async () => {
      let next: string | null = null;
      try {
        const res = await invokeEdgeFunction<{ status: string }>('mercadopago-pix-status', { body: { chargeId: charge.chargeId } });
        next = res.status;
      } catch {
        const { data } = await supabase
          .from('mercadopago_pix_charges')
          .select('status')
          .eq('id', charge.chargeId)
          .maybeSingle();
        next = data?.status ?? null;
      }
      if (!next) return;
      setStatus(next);
      if (next === 'paid') {
        toast.success('Pix recebido! Venda atualizada.');
        onPaid?.();
        onOpenChange(false);
      } else if (['expired', 'cancelled', 'failed'].includes(next)) {
        toast.error('Cobrança Pix encerrada sem pagamento. Gere uma nova se necessário.');
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [open, charge, status, onPaid, onOpenChange]);

  const copyCode = async () => {
    if (!charge) return;
    try {
      await navigator.clipboard.writeText(charge.qrCode);
      toast.success('Código Pix copiado');
    } catch {
      toast.error('Não foi possível copiar. Selecione o código e copie manualmente.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cobrança Pix</DialogTitle>
          <DialogDescription>
            Peça ao cliente para ler o QR Code ou colar o código no app do banco. A venda é quitada sozinha quando o pagamento cair.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-3">
            <p className="text-xs text-amber-700 dark:text-amber-400">Valor da cobrança (saldo devedor)</p>
            <p className="text-2xl font-bold text-amber-900 dark:text-amber-300">{fmt(charge?.amount ?? amountPending)}</p>
          </div>

          {loading && <p className="text-sm text-muted-foreground text-center py-6">Gerando QR Code...</p>}

          {charge && (
            <>
              <div className="flex justify-center">
                <img
                  src={`data:image/jpeg;base64,${charge.qrCodeBase64}`}
                  alt="QR Code Pix"
                  className="w-56 h-56 rounded border bg-white p-2"
                />
              </div>
              <div className="space-y-2">
                <Textarea readOnly value={charge.qrCode} rows={3} className="text-xs font-mono" />
                <Button variant="outline" className="w-full h-11" onClick={copyCode}>Copiar código Pix</Button>
              </div>
              <p className="text-xs text-center text-muted-foreground">
                {status === 'pending' ? 'Aguardando o pagamento...' : `Status: ${status}`}
              </p>
            </>
          )}

          <Button variant="outline" className="w-full h-11" onClick={() => onOpenChange(false)}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
