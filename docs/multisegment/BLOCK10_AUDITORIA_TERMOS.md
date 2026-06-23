# AUDITORIA DE TERMOS — Block 10: Multi-segmento

**Data:** 2026-06-23  
**Status:** ✅ Concluída

---

## Objetivo

Identificar todos os termos específicos de assistência técnica/celular no sistema e classificar quais foram neutralizados, quais são dinâmicos via `useBusinessLabels`, e quais permanecem apenas para o segmento correto (`technical_assistance`).

---

## Termos identificados e status

### 1. ServiceOrders/Index.tsx

| Termo original | Contexto | Ação tomada |
|---|---|---|
| `"Ordens de Serviço"` | Título da página | ✅ Dinâmico: `labels.work_order + "s"` |
| `"Gerencie reparos, peças e entregas técnicas"` | Subtítulo | ✅ Substituído por "Gerencie atendimentos, serviços e entregas" |
| `"Nova OS"` | Botão | ✅ Dinâmico: `"Nova " + labels.work_order` |
| `"Aguard. peça"` | Card stat | ✅ Dinâmico: `"Aguard. " + labels.product` |
| `"Buscar por nº OS, cliente, aparelho..."` | Placeholder busca | ✅ Dinâmico: usa `labels.equipment.toLowerCase()` |
| `"Aparelho"` | Cabeçalho coluna tabela | ✅ Dinâmico: `labels.equipment` |

### 2. ServiceOrders/New.tsx

| Termo original | Contexto | Ação tomada |
|---|---|---|
| `"Nova Ordem de Serviço"` | Título | ✅ Dinâmico: `"Nova " + labels.work_order` |
| `"Aparelho"` | Seção do formulário | ✅ Dinâmico: `labels.os_title` |
| `"Aparelho *"` | Label do campo | ✅ Dinâmico: `labels.equipment + " *"` |
| `"Smartphone, Notebook..."` | Placeholder | ✅ Substituído por `labels.equipment` |
| `"IMEI / Serial"` | Campo | ✅ Condicional: só aparece quando `labels.show_imei === true` |
| `"Senha do aparelho"` | Campo | ✅ Condicional + dinâmico: só para segmentos com IMEI |
| `"Estado do aparelho"` | Label | ✅ Dinâmico: `"Estado do " + labels.equipment.toLowerCase()` |
| `"Tela trincada, riscos, etc"` | Placeholder textarea | ✅ Substituído por "Descreva as condições do item..." |
| `"Diagnóstico inicial"` | Seção | ✅ Renomeado para "Solicitação" |
| `"Defeito relatado *"` | Label | ✅ Dinâmico: `labels.defect + " *"` |
| `"Técnico responsável"` | Label select | ✅ Dinâmico: `labels.responsible + " responsável"` |
| `"Informe o aparelho"` | Mensagem erro | ✅ Dinâmico |
| `"Informe o defeito"` | Mensagem erro | ✅ Dinâmico |
| `"Descrição do serviço"` | Label | Mantido (neutro) |
| `"Troca de tela, limpeza de placa..."` | Placeholder | Mantido como orientação opcional |

### 3. ServiceOrders/Detail.tsx

| Termo | Status |
|---|---|
| `device`, `brand`, `model`, `imei_serial` | ⚠️ Campos do banco — schema não mudou; apenas labels visuais são dinâmicos (fora do escopo desta auditoria de términologia visual) |

### 4. AppSidebar.tsx

| Termo original | Ação tomada |
|---|---|
| `"Ordem de Serviço"` (item menu) | ✅ Dinâmico: `labels.work_order` via `useBusinessLabels` |

### 5. Settings.tsx (StoreTab)

| Item | Ação tomada |
|---|---|
| Seção "Perfil do Negócio" | ✅ Adicionada com selector de 12 segmentos |
| RPC `set_store_business_type` | ✅ Salva imediatamente ao selecionar |

### 6. OnboardingWizard.tsx

| Item | Ação tomada |
|---|---|
| Step "Qual tipo de negócio?" | ✅ Novo primeiro passo com grid de 12 opções |
| Salva via RPC | ✅ Persiste no banco ao selecionar |

### 7. SuperAdminStores.tsx

| Item | Ação tomada |
|---|---|
| Coluna "Segmento" | ✅ Adicionada com Select inline editável |
| Filtro por segmento | ✅ Dropdown de filtro adicionado |

---

## Termos que permanecem (comportamento correto)

Estes termos NÃO foram removidos — eles existem apenas onde fazem sentido ou são dados de banco:

| Termo | Motivo para manter |
|---|---|
| `imei_serial` (coluna banco) | Schema universal — campo pode existir mas UI só exibe para AT |
| `device_password` (coluna banco) | Idem — condicional na UI |
| `"Ordem de Serviço"` em labels para `technical_assistance` | Correto para esse segmento |
| `"Técnico"` como `responsible` para AT | Correto para esse segmento |
| `"Peça"` para AT e autopeças | Correto para esses segmentos |
| Status `"aguardando_peca"` | Código de status do banco — não altera sem migration de schema |

---

## Termos fora do escopo desta auditoria (próximos passos)

| Arquivo | Observação |
|---|---|
| `ServiceOrders/Detail.tsx` | Labels do detalhe da OS podem ser dinamizados (futura iteração) |
| Relatórios PDF (`ConnectReports`, `TrocasReport`) | PDF pode usar `labels.pdf_document` (futura iteração) |
| `Reports.tsx` | "peças vendidas" → `labels.items_sold` (futura iteração) |
| Dashboard tiles | "técnico" mencionado em contextos de RPC (não visual) |

---

## Cobertura

| Área | Auditado | Ações tomadas |
|---|---|---|
| ServiceOrders/Index | ✅ | 6 termos corrigidos |
| ServiceOrders/New | ✅ | 14 termos corrigidos |
| AppSidebar | ✅ | 1 termo dinâmico |
| Settings | ✅ | Seção de perfil adicionada |
| OnboardingWizard | ✅ | Novo step de tipo de negócio |
| SuperAdminStores | ✅ | Coluna + filtro + RPC edit |
| Detail.tsx | ⚠️ Parcial | Schema fields (futuro) |
| Reports.tsx | ⚠️ Parcial | Futuro |
| PDFs | ⚠️ Futuro | Usar `labels.pdf_document` |
