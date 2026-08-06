-- =====================================================================
-- Rede de segurança: alertar IMEDIATAMENTE se uma venda paga voltar a
-- ficar em aberto.
--
-- Contexto: relato de clientes de que uma venda quitada volta a aparecer
-- em "Contas a Receber" no dia seguinte. A causa raiz (editar uma venda
-- paga pelo EditSaleDialog trocando o Status sem perceber a consequência)
-- já foi corrigida em duas camadas: trava de UI (commit 771c3a8) + a RPC
-- edit_sale_atomic já exige p_confirm_revert_payment = true para esse
-- caminho, senão lança CONFIRM_REVERT_PAYMENT_REQUIRED e nada muda
-- (coberto por supabase/tests/accounts_receivable_regression_tests.sql).
--
-- Este trigger é a segunda camada, independente de qual RPC ou fluxo
-- causou a mudança (presente ou futuro): qualquer UPDATE em public.sales
-- que faça payment_status sair de 'paid' gera uma notificação 'critical'
-- na hora, visível no sino de notificações do app (useNotifications faz
-- polling a cada 60s). Se isso acontecer de novo — mesmo por um caminho
-- que ainda não auditamos — o dono da loja fica sabendo no mesmo minuto,
-- em vez de descobrir dias depois pelo cliente.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.trg_alert_paid_sale_reverted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_name text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.payment_status = 'paid'
     AND NEW.payment_status IS DISTINCT FROM 'paid' THEN

    SELECT c.name INTO v_customer_name
      FROM public.customers c WHERE c.id = NEW.customer_id;

    INSERT INTO public.notifications(
      store_id, type, severity, title, description, link, entity_type, entity_id
    ) VALUES (
      NEW.store_id,
      'sale_payment_reverted',
      'critical',
      'Pagamento revertido — venda ' || to_char(COALESCE(OLD.amount_paid, OLD.net_total), 'FM999G999G990D00'),
      'A venda #' || substr(NEW.id::text, 1, 8)
        || COALESCE(' de ' || v_customer_name, '')
        || ' estava paga e passou para "'
        || CASE NEW.payment_status WHEN 'partial' THEN 'parcial' ELSE 'pendente' END
        || '". Se isso não foi uma ação intencional (estorno), verifique o histórico de edições da venda.',
      '/contas-a-receber',
      'sale',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_alert_payment_reverted ON public.sales;
CREATE TRIGGER trg_sales_alert_payment_reverted
  AFTER UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_alert_paid_sale_reverted();
