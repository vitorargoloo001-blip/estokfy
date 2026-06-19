import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, RefreshCw, Loader2, Eye, FileText, Clock, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/use-mobile';

interface PaymentVerificationRow {
  id: string;
  store_id: string;
  user_id: string;
  email: string;
  plan_id: string;
  expected_amount: number;
  payment_status: string;
  uploaded_file_url: string | null;
  ai_confidence: number | null;
  ai_reason: string | null;
  extracted_name: string | null;
  extracted_amount: number | null;
  extracted_date: string | null;
  extracted_pix_key: string | null;
  date_is_recent: boolean | null;
  date_validation_result: string | null;
  match_result: string | null;
  reviewer_type: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  stores?: { name: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  under_review: 'Em análise',
  waiting_admin_approval: 'Aguardando aprovação',
  approved_by_admin: 'Aprovado',
  rejected: 'Rejeitado',
  needs_resubmission: 'Reenvio solicitado',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  under_review: 'secondary',
  waiting_admin_approval: 'default',
  approved_by_admin: 'default',
  rejected: 'destructive',
  needs_resubmission: 'outline',
};

const MATCH_LABELS: Record<string, string> = {
  full_match: 'Dados corretos',
  partial_match: 'Dados parciais',
  no_match: 'Dados incorretos',
};

export default function SuperAdminPaymentVerifications() {
  const [verifications, setVerifications] = useState<PaymentVerificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('waiting_admin_approval');
  const [selectedV, setSelectedV] = useState<PaymentVerificationRow | null>(null);
  const [actionDialog, setActionDialog] = useState<{ type: 'approve' | 'reject' | 'resubmit'; v: PaymentVerificationRow } | null>(null);
  const [notes, setNotes] = useState('');
  const [acting, setActing] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const fetchData = async () => {
    setLoading(true);
    let q = supabase
      .from('payment_verifications')
      .select('*, stores(name)')
      .order('updated_at', { ascending: false });

    if (filter && filter !== 'all') {
      q = q.eq('payment_status', filter);
    }

    const { data } = await q.limit(100);
    setVerifications((data as PaymentVerificationRow[] | null) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [filter]);

  const getSignedUrl = async (v: PaymentVerificationRow) => {
    if (!v.uploaded_file_url) return null;
    const path = v.uploaded_file_url.replace(/^.*payment-receipts\//, '');
    const { data } = await supabase.storage
      .from('payment-receipts')
      .createSignedUrl(path, 300);
    return data?.signedUrl || null;
  };

  const handleViewReceipt = async (v: PaymentVerificationRow) => {
    const url = await getSignedUrl(v);
    if (url) {
      setReceiptUrl(url);
      setSelectedV(v);
    } else {
      toast.error('Não foi possível carregar o comprovante.');
    }
  };

  const handleAction = async () => {
    if (!actionDialog) return;
    setActing(true);
    const { type, v } = actionDialog;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      if (type === 'approve') {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        await supabase.from('payment_verifications').update({
          payment_status: 'approved_by_admin',
          reviewer_type: 'admin',
          reviewed_at: new Date().toISOString(),
          ai_reason: notes || v.ai_reason,
          updated_at: new Date().toISOString(),
        }).eq('id', v.id);

        await supabase.from('stores').update({
          access_enabled: true,
          subscription_status: 'active',
          expires_at: expiresAt.toISOString(),
        }).eq('id', v.store_id);

        await supabase.from('super_admin_logs').insert({
          admin_user_id: user.id,
          store_id: v.store_id,
          action: 'payment_approved_manually',
          after_json: { verification_id: v.id, notes },
        });

        toast.success('Acesso liberado com sucesso!');
      } else if (type === 'reject') {
        await supabase.from('payment_verifications').update({
          payment_status: 'rejected',
          reviewer_type: 'admin',
          reviewed_at: new Date().toISOString(),
          ai_reason: notes || 'Rejeitado pelo administrador',
          updated_at: new Date().toISOString(),
        }).eq('id', v.id);

        await supabase.from('super_admin_logs').insert({
          admin_user_id: user.id,
          store_id: v.store_id,
          action: 'payment_rejected_manually',
          after_json: { verification_id: v.id, notes },
        });

        toast.success('Comprovante rejeitado.');
      } else if (type === 'resubmit') {
        await supabase.from('payment_verifications').update({
          payment_status: 'needs_resubmission',
          reviewer_type: 'admin',
          reviewed_at: new Date().toISOString(),
          ai_reason: notes || 'Administrador solicitou novo comprovante',
          updated_at: new Date().toISOString(),
        }).eq('id', v.id);

        await supabase.from('super_admin_logs').insert({
          admin_user_id: user.id,
          store_id: v.store_id,
          action: 'payment_resubmission_requested',
          after_json: { verification_id: v.id, notes },
        });

        toast.success('Solicitação de reenvio registrada.');
      }

      setActionDialog(null);
      setNotes('');
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao executar ação');
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl md:text-2xl font-bold">Verificações de Pagamento</h1>
        <div className="flex gap-2 flex-wrap">
          {['waiting_admin_approval', 'all', 'pending', 'rejected', 'approved_by_admin', 'needs_resubmission'].map(f => (
            <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'}
              onClick={() => setFilter(f)} className="text-xs">
              {f === 'all' ? 'Todos' : STATUS_LABELS[f] || f}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : verifications.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhuma verificação encontrada.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {verifications.map(v => (
            <Card key={v.id} className="overflow-hidden">
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="space-y-1">
                    <p className="font-semibold text-sm">{(v as any).stores?.name || 'Loja sem nome'}</p>
                    <p className="text-xs text-muted-foreground">{v.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Enviado: {new Date(v.updated_at).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[v.payment_status] || 'outline'}>
                    {STATUS_LABELS[v.payment_status] || v.payment_status}
                  </Badge>
                </div>

                {/* AI Analysis summary */}
                {v.ai_confidence != null && (
                  <div className="rounded-lg bg-muted p-3 space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Confiança IA:</span>
                      <span className={v.ai_confidence >= 75 ? 'text-green-600' : v.ai_confidence >= 50 ? 'text-amber-600' : 'text-red-600'}>
                        {v.ai_confidence}%
                      </span>
                      {v.match_result && (
                        <Badge variant="outline" className="text-[10px]">{MATCH_LABELS[v.match_result] || v.match_result}</Badge>
                      )}
                    </div>
                    {v.extracted_name && <p><span className="text-muted-foreground">Nome:</span> {v.extracted_name}</p>}
                    {v.extracted_pix_key && <p><span className="text-muted-foreground">Chave:</span> {v.extracted_pix_key}</p>}
                    {v.extracted_amount != null && <p><span className="text-muted-foreground">Valor:</span> R$ {v.extracted_amount.toFixed(2)}</p>}
                    {v.extracted_date && (
                      <p>
                        <span className="text-muted-foreground">Data:</span> {v.extracted_date}
                        {v.date_is_recent != null && (
                          <span className={v.date_is_recent ? 'text-green-600 ml-1' : 'text-red-600 ml-1'}>
                            ({v.date_is_recent ? 'Recente' : 'Antiga'})
                          </span>
                        )}
                      </p>
                    )}
                    {v.ai_reason && <p className="text-muted-foreground italic">"{v.ai_reason}"</p>}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  {v.uploaded_file_url && (
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => handleViewReceipt(v)}>
                      <Eye className="h-3.5 w-3.5" />Ver comprovante
                    </Button>
                  )}
                  {(v.payment_status === 'waiting_admin_approval' || v.payment_status === 'under_review') && (
                    <>
                      <Button size="sm" className="gap-1.5 text-xs" onClick={() => { setActionDialog({ type: 'approve', v }); setNotes(''); }}>
                        <CheckCircle2 className="h-3.5 w-3.5" />Aprovar
                      </Button>
                      <Button size="sm" variant="destructive" className="gap-1.5 text-xs" onClick={() => { setActionDialog({ type: 'reject', v }); setNotes(''); }}>
                        <XCircle className="h-3.5 w-3.5" />Rejeitar
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => { setActionDialog({ type: 'resubmit', v }); setNotes(''); }}>
                        <RefreshCw className="h-3.5 w-3.5" />Pedir reenvio
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Receipt viewer dialog */}
      <Dialog open={!!receiptUrl} onOpenChange={() => { setReceiptUrl(null); setSelectedV(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Comprovante</DialogTitle>
            <DialogDescription>{selectedV?.email}</DialogDescription>
          </DialogHeader>
          {receiptUrl && (
            receiptUrl.includes('.pdf') ? (
              <iframe src={receiptUrl} className="w-full h-[70vh] rounded border" />
            ) : (
              <img src={receiptUrl} alt="Comprovante" className="max-w-full rounded" />
            )
          )}
        </DialogContent>
      </Dialog>

      {/* Action confirmation dialog */}
      <Dialog open={!!actionDialog} onOpenChange={() => setActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.type === 'approve' && 'Aprovar acesso'}
              {actionDialog?.type === 'reject' && 'Rejeitar comprovante'}
              {actionDialog?.type === 'resubmit' && 'Solicitar novo comprovante'}
            </DialogTitle>
            <DialogDescription>
              {actionDialog?.type === 'approve' && 'Isso vai liberar o acesso da loja ao sistema.'}
              {actionDialog?.type === 'reject' && 'O cliente será informado que o comprovante não foi aprovado.'}
              {actionDialog?.type === 'resubmit' && 'O cliente será solicitado a enviar um novo comprovante.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="Observações (opcional)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)}>Cancelar</Button>
            <Button
              variant={actionDialog?.type === 'reject' ? 'destructive' : 'default'}
              onClick={handleAction}
              disabled={acting}
            >
              {acting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
