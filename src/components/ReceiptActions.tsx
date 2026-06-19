import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Receipt, FileDown, Printer, MessageCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  generateReceiptPdfA4, buildReceiptText, printThermalReceipt, shareWhatsApp,
  type ReceiptData,
} from '@/lib/receipt';
import { usePrintSettings } from '@/hooks/usePrintSettings';

interface Props {
  saleId: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'default' | 'icon';
}

export default function ReceiptActions({ saleId, variant = 'outline', size = 'sm' }: Props) {
  const { profile } = useAuth();
  const { settings: printSettings } = usePrintSettings();
  const [loading, setLoading] = useState(false);

  async function loadReceipt(): Promise<ReceiptData | null> {
    if (!profile?.store_id) return null;
    setLoading(true);
    try {
      const [saleRes, itemsRes, payRes, storeRes] = await Promise.all([
        supabase.from('sales')
          .select('id, created_at, gross_total, net_total, discount_total, shipping_fee, amount_paid, amount_pending, payment_status, notes, created_by, customers(name, phone)')
          .eq('id', saleId).maybeSingle(),
        supabase.from('sale_items').select('qty, unit_price, line_total, products(name)').eq('sale_id', saleId),
        supabase.from('payments').select('method').eq('sale_id', saleId),
        supabase.from('stores').select('name, phone, whatsapp').eq('id', profile.store_id).maybeSingle(),
      ]);
      if (!saleRes.data) { toast.error('Venda não encontrada'); return null; }
      const s: any = saleRes.data;

      // Resolve seller name (sales.created_by → profiles.full_name)
      let sellerName: string | null = null;
      if (s.created_by) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('auth_user_id', s.created_by)
          .eq('store_id', profile.store_id)
          .maybeSingle();
        sellerName = prof?.full_name || null;
      }

      const data: ReceiptData = {
        storeName: storeRes.data?.name || 'Loja',
        storePhone: storeRes.data?.whatsapp || storeRes.data?.phone || null,
        saleId: s.id,
        createdAt: s.created_at,
        customerName: s.customers?.name || null,
        sellerName,
        notes: s.notes || null,
        items: (itemsRes.data || []).map((it: any) => ({
          name: it.products?.name || 'Produto',
          qty: it.qty,
          unit_price: Number(it.unit_price),
          line_total: Number(it.line_total),
        })),
        gross: Number(s.gross_total || 0),
        net: Number(s.net_total || 0),
        discount: Number(s.discount_total || 0),
        shipping: Number(s.shipping_fee || 0),
        amountPaid: Number(s.amount_paid || 0),
        amountPending: Number(s.amount_pending || 0),
        paymentStatus: s.payment_status,
        paymentMethods: Array.from(new Set((payRes.data || []).map((p: any) => p.method).filter((m: string) => m !== 'pending'))),
      };
      return data;
    } finally {
      setLoading(false);
    }
  }

  const handlePdf = async () => {
    const d = await loadReceipt(); if (!d) return;
    generateReceiptPdfA4(d).save(`venda-${d.saleId.slice(0, 8)}.pdf`);
  };
  const handleThermal = async () => {
    const d = await loadReceipt(); if (!d) return;
    printThermalReceipt(d, {
      paperWidth: printSettings.paper_width,
      copies: printSettings.copies,
      showLogo: printSettings.show_logo,
      showNotes: printSettings.show_notes,
      footerMessage: printSettings.footer_message,
    });
  };
  const handleWhatsApp = async () => {
    const d = await loadReceipt(); if (!d) return;
    const customerPhoneRes = await supabase.from('sales').select('customers(phone)').eq('id', saleId).maybeSingle();
    const phone = (customerPhoneRes.data as any)?.customers?.phone;
    shareWhatsApp(buildReceiptText(d), phone);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
          {size !== 'icon' && <span className="ml-1">Comprovante</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handlePdf}>
          <FileDown className="mr-2 h-4 w-4" /> Baixar PDF (A4)
        </DropdownMenuItem>
        {printSettings.enabled && (
          <DropdownMenuItem onClick={handleThermal}>
            <Printer className="mr-2 h-4 w-4" /> Imprimir cupom ({printSettings.paper_width})
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleWhatsApp}>
          <MessageCircle className="mr-2 h-4 w-4" /> Enviar no WhatsApp
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
