# Relatório Técnico — OS PRO (Ordem de Serviço Universal)

**Data:** 2026-06-23  
**Versão:** 1.0  
**Migration:** `supabase/migrations/20260623000080_os_pro.sql`

---

## 1. Visão geral

O OS PRO é uma extensão do módulo de Ordem de Serviço existente para atender assistências técnicas profissionais (Marassi Balanças, manutenção industrial, refrigeração, informática, eletrônica, automotiva) com suporte a:

- **Múltiplos equipamentos** por OS
- **Marca, modelo, nº de série, patrimônio/inventário** por equipamento
- **Campo detalhado de serviços executados**
- **Tabela de materiais** integrada ao estoque (via `service_order_items` já existente)
- **Cálculo automático** de todos os custos
- **Garantia** com prazo e descrição
- **Assinatura digital** de técnico e cliente (canvas + base64)
- **Upload de fotos** antes/depois com classificação
- **PDF profissional A4** completo
- **Histórico completo** de alterações de status

**Compatibilidade:** `business_type` = `technical_assistance`, `services`, `industrial`, `automotive`  
**Retrocompatibilidade:** 100% — nenhuma coluna ou tabela existente foi removida ou alterada de forma destrutiva.

---

## 2. Schema — mudanças no banco de dados

### 2.1 Novas colunas em `service_orders`

| Coluna | Tipo | Default | Descrição |
|--------|------|---------|-----------|
| `is_pro` | `boolean` | `false` | Flag que ativa o modo PRO na UI |
| `warranty_days` | `integer` | `NULL` | Prazo de garantia em dias |
| `warranty_description` | `text` | `NULL` | Texto descritivo da garantia |
| `travel_cost` | `numeric` | `0` | Custo de deslocamento (R$) |
| `toll_cost` | `numeric` | `0` | Custo de pedágio (R$) |
| `km_driven` | `numeric` | `0` | Quilômetros rodados |
| `km_rate` | `numeric` | `0` | Valor por km (R$) |
| `other_costs` | `numeric` | `0` | Outros custos extras |
| `other_costs_desc` | `text` | `NULL` | Descrição dos outros custos |
| `executed_services_notes` | `text` | `NULL` | Relatório detalhado de serviços executados |
| `technician_signature_url` | `text` | `NULL` | Assinatura do técnico (base64 data URL) |
| `client_signature_url` | `text` | `NULL` | Assinatura do cliente (base64 data URL) |

### 2.2 Nova coluna em `service_order_photos`

| Coluna | Tipo | Constraint |
|--------|------|------------|
| `photo_type` | `text NOT NULL DEFAULT 'other'` | `CHECK (photo_type IN ('before','after','other'))` |

### 2.3 Nova tabela `service_order_equipment`

```sql
CREATE TABLE public.service_order_equipment (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         uuid NOT NULL,
  service_order_id uuid NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  device           text NOT NULL,
  brand            text,
  model            text,
  serial_number    text,
  inventory_number text,
  condition        text,
  accessories      text,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
```

**RLS:** mesmo padrão do módulo OS (select = qualquer membro da loja, insert/update = owner/admin/manager/sales/stock, delete = owner/admin/manager/stock).

### 2.4 Storage bucket `service-order-photos`

- Público (URLs acessíveis sem auth para exibição)
- Limite de 10 MB por arquivo
- MIME types aceitos: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- Path pattern: `{store_id}/{os_id}/{timestamp}.{ext}`

---

## 3. RPCs adicionadas

| RPC | Assinatura | Descrição |
|-----|-----------|-----------|
| `so_add_equipment` | `(p_os uuid, p_payload jsonb) → uuid` | Insere equipamento adicional |
| `so_remove_equipment` | `(p_eq_id uuid) → void` | Remove equipamento |
| `so_update_signatures` | `(p_os uuid, p_tech_sig text, p_client_sig text) → void` | Salva assinaturas |
| `so_update_warranty` | `(p_os uuid, p_days integer, p_description text) → void` | Atualiza garantia |
| `so_update_extra_costs` | `(p_os uuid, p_travel numeric, p_toll numeric, p_km numeric, p_km_rate numeric, p_other numeric, p_other_desc text) → void` | Atualiza custos + recalc totals |
| `so_update_executed_notes` | `(p_os uuid, p_notes text) → void` | Salva notas de serviços executados |
| `so_add_photo_pro` | `(p_os uuid, p_storage_path text, p_caption text, p_photo_type text) → uuid` | Adiciona foto com tipo antes/depois |

### 3.1 `so_recalc_totals` — fórmula atualizada

**Antes:**
```
total = GREATEST(labor + parts - discount, 0)
```

**Agora:**
```
total = GREATEST(labor + parts + travel_cost + toll_cost + (km_driven × km_rate) + other_costs - discount, 0)
```

Todos os existentes OS com `travel_cost = toll_cost = km_driven = other_costs = 0` (default) terão o mesmo total calculado.

---

## 4. Arquivos de frontend modificados/criados

### 4.1 Novos componentes

| Arquivo | Descrição |
|---------|-----------|
| `src/components/service-orders/SignaturePad.tsx` | Canvas de assinatura digital com mouse + touch |

**SignaturePad** — implementação nativa (sem biblioteca externa):
- `<canvas>` 400×120px com eventos `onMouseDown/Move/Up` e `onTouchStart/Move/End`
- Exporta `dataUrl: string | null` via prop `onChange`
- Botão "Limpar" integrado
- Prop `readOnly` para exibição somente-leitura
- `useRef` para `drawing` e `lastPos` (sem re-renders durante o desenho)

### 4.2 Arquivos modificados

| Arquivo | O que mudou |
|---------|-------------|
| `src/pages/ServiceOrders/New.tsx` | Toggle PRO, múltiplos equipamentos (add/remove rows), custos extras (collapsible), garantia |
| `src/pages/ServiceOrders/Detail.tsx` | Reescrito com Tabs (Detalhes/Equipamentos/Serviços/Financeiro/Fotos/Assinaturas/Histórico), SignaturePad, PhotoUploadSection, dialogs para cada seção PRO |
| `src/lib/serviceOrderPdf.ts` | PDF profissional A4 completo com header dark, múltiplos equipamentos, breakdown de custos, garantia, assinaturas base64, rodapé com paginação |

---

## 5. Fluxo de dados — OS PRO

```
Criar OS (New.tsx)
  → create_service_order({ ...fields, is_pro: true, warranty_*, travel_*, ... })
  → [se múltiplos equipamentos] so_add_equipment × N
  → navigate('/os/{id}')

Detail.tsx — aba Equipamentos
  → service_order_equipment (select ordered by sort_order)
  → so_add_equipment / so_remove_equipment

Detail.tsx — aba Serviços e Peças
  → service_order_items (existente)
  → so_add_service / so_add_part / so_remove_item

Detail.tsx — aba Financeiro
  → so_settle_payment (existente, inclui cash_entries)
  → so_update_extra_costs → so_recalc_totals (novo cálculo inclui custos extras)

Detail.tsx — aba Fotos
  → supabase.storage('service-order-photos').upload(path)
  → so_add_photo_pro (DB record com photo_type)
  → exibe agrupado por: Antes / Depois / Outras

Detail.tsx — aba Assinaturas
  → SignaturePad (canvas) → base64 dataUrl
  → so_update_signatures

PDF (generateServiceOrderPDF)
  → incluem: equipamentos[0..N], custo breakdown, garantia, sig base64 (addImage)
```

---

## 6. Modo PRO vs. modo básico

| Feature | Básico (`is_pro = false`) | PRO (`is_pro = true`) |
|---------|--------------------------|----------------------|
| Equipamentos | 1 (campos inline na OS) | N (tabela `service_order_equipment`) |
| Custos extras | Não exibidos | Deslocamento, pedágio, km, outros |
| Garantia | Não exibida | Prazo em dias + descrição |
| Fotos | Não agrupadas | Antes / Depois / Outras |
| Assinaturas | Canvas não exibido | SignaturePad para técnico + cliente |
| Tabs extras na Detail | Não exibidas | Equipamentos, Fotos, Assinaturas |
| PDF | Básico (sem extras) | Completo com todos os campos PRO |

OS existentes (criadas antes deste deploy) têm `is_pro = false` e continuam funcionando normalmente na Detail com layout básico (sem tabs extras).

---

## 7. Segurança e multi-tenant

- Todas as RPCs novas usam `SECURITY DEFINER` com `get_my_store_id()` e `get_my_role()`
- `service_order_equipment` tem RLS com a mesma política de `service_order_items`
- Fotos no Storage: upload exige `get_my_role() IN (owner/admin/manager/sales/stock)`
- Assinaturas (base64) ficam na coluna `text` da própria OS — mesmas políticas RLS de `service_orders`
- Nenhum dado cross-tenant é possível pelas RPCs (todas verificam `store_id = get_my_store_id()`)

---

## 8. Checklist de deploy

- [x] Migration `20260623000080_os_pro.sql` criada
- [x] `service_order_equipment` com RLS
- [x] `service_order_photos.photo_type` adicionado
- [x] `so_recalc_totals` atualizado (retrocompatível)
- [x] 7 novas RPCs criadas
- [x] Storage bucket `service-order-photos`
- [x] `SignaturePad.tsx` criado
- [x] `New.tsx` atualizado com modo PRO
- [x] `Detail.tsx` reescrito com todas as features PRO
- [x] `serviceOrderPdf.ts` reescrito (A4 profissional)
- [ ] Aplicar migration no prod (`_migracao/apply-connect-v1-migrations.mjs`)
- [ ] Build (`npm run build`) sem erros TypeScript
- [ ] Git push → Cloudflare Pages deploy
- [ ] Validação em produção

---

## 9. Compatibilidade com business_type

O campo `is_pro` é independente de `business_type`. A recomendação de uso é:

| `business_type` | Uso sugerido |
|-----------------|-------------|
| `retail` | `is_pro = false` (OS simples para celulares) |
| `technical_assistance` | `is_pro = true` (múltiplos equipamentos, garantia) |
| `services` | `is_pro = true` (custos de deslocamento, relatório técnico) |
| `industrial` | `is_pro = true` (patrimônio/inventário, fotos antes/depois) |
| `automotive` | `is_pro = true` (múltiplos componentes, km, deslocamento) |

O toggle PRO fica visível para todos os `business_type` no formulário de nova OS, mas pode ser restrito por `business_type` no futuro sem breaking changes.
