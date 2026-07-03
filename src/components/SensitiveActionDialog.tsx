import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Texto extra exibido acima do aviso padrão (ex.: resumo do que está sendo alterado). */
  summary?: React.ReactNode;
  confirmLabel?: string;
  onConfirm: (reason: string) => Promise<void>;
}

/**
 * Modal de confirmação reutilizável para ações sensíveis (editar/cancelar
 * crédito, devolução ou troca) — exige motivo obrigatório antes de confirmar.
 */
export default function SensitiveActionDialog({
  open, onOpenChange, title, summary, confirmLabel = 'Confirmar alteração', onConfirm,
}: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const close = () => { if (!submitting) { onOpenChange(false); setReason(''); } };

  const handleConfirm = async () => {
    if (reason.trim().length < 3) {
      toast.error('Informe o motivo da alteração (mínimo 3 caracteres).');
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
      setReason('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="flex items-start gap-2 pt-1">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <span>Esta ação altera estoque, financeiro e histórico do cliente. Informe o motivo para continuar.</span>
          </DialogDescription>
        </DialogHeader>

        {summary && <div className="rounded-md border bg-muted/30 p-3 text-sm">{summary}</div>}

        <div className="space-y-1">
          <Label className="text-destructive">Motivo da alteração *</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="Descreva o motivo desta alteração..."
            autoFocus
          />
          <p className="text-xs text-muted-foreground text-right">{reason.length}/500</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={submitting}>Voltar</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={submitting}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processando...</> : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
