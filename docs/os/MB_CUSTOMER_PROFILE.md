# Personalização MB Assistência — Cadastro Estendido de Cliente

## Motivação

A MB Assistência precisa emitir OS com dados fiscais completos do cliente (Razão Social, CPF/CNPJ,
Inscrição Estadual, endereço completo) no cabeçalho, no modelo que já usam hoje. Como isso não faz
sentido para a maioria das lojas do Estokfy (assistências técnicas menores, varejo em geral), a
funcionalidade é opcional e ligada por loja, não por código de app inteiro.

## Arquitetura da flag

A flag vive em `store_settings`:

```
store_id: <uuid da loja>
category: 'mb_customer_profile'
settings: { "use_extended_customer_data": true }
```

Hoje ela é **ativada apenas para a loja cujo owner faz login com `marrassibalancas@gmail.com`**,
mas a arquitetura não depende de e-mail — é uma flag de loja como qualquer outra em `store_settings`
(mesmo mecanismo usado por `usePrintSettings`/impressão térmica e pelas configurações do Connect).

Resolução da loja por e-mail (usada só no seed inicial, migration
`20260703000001_mb_customer_profile.sql`):

```sql
public.get_store_by_owner_email(p_email text) RETURNS uuid
```

Endpoint para ativação futura por qualquer loja, pensado para uma tela de Super Admin (ainda não
construída — fora do escopo desta entrega):

```sql
public.set_extended_customer_profile_flag(p_store_id uuid, p_enabled boolean)
-- SECURITY DEFINER, gated por is_super_admin()
```

A tela de Super Admin só precisa chamar esse RPC passando o `store_id` e `true`/`false` — não é
necessário tocar em código de frontend do cadastro de cliente, OS ou PDF para habilitar em outra loja.

No frontend, o hook `src/hooks/useExtendedCustomerProfile.ts` (mesmo padrão de
`src/hooks/usePrintSettings.ts`) lê essa flag e expõe `{ enabled, loading }`. Todo o comportamento
condicional do app depende só desse hook.

## Colunas novas

**`customers`** (cadastro do cliente — nullable, sem impacto em outras lojas):

| Coluna | Descrição |
|---|---|
| `state_registration` | Inscrição Estadual |
| `address` | Endereço |
| `neighborhood` | Bairro |
| `city` | Cidade |
| `state` | UF |
| `zip_code` | CEP |

`name` é reaproveitado como "Razão Social / Nome" (relabel condicional, sem coluna nova) e `doc_id`
já existente é reaproveitado como CPF/CNPJ.

**`service_orders`** (snapshot no momento da criação, mesmo padrão de `customer_name`/`customer_phone`):

`customer_doc_id`, `customer_state_registration`, `customer_address`, `customer_neighborhood`,
`customer_city`, `customer_state`, `customer_zip_code`.

## Comportamento condicional

- **Cadastro de clientes** (`src/pages/Customers.tsx`): quando `enabled`, os 6 campos acima viram
  obrigatórios (junto com CPF/CNPJ, que sem a flag é opcional) e aparecem no formulário. Lojas sem
  a flag continuam vendo o formulário atual, sem nenhuma mudança.
- **Criação de OS** (`src/pages/ServiceOrders/New.tsx`): ao selecionar um cliente já cadastrado
  (via `CustomerSearch`), os campos estendidos são autopreenchidos a partir do cadastro, mas
  continuam editáveis num card extra ("Dados fiscais e endereço"), visível só quando `enabled`.
  Assim como `customer_name`/`customer_phone` hoje, esses campos são fixados no momento da criação
  da OS (snapshot) e não são editáveis depois — não existe tela de edição de dados do cliente na OS
  para nenhum campo, incluindo os novos.
- **PDF da OS** (`src/lib/serviceOrderPdf.ts`): a seção "Dados do cliente" detecta a presença de
  qualquer campo estendido no registro da OS (não depende do hook, já que a geração do PDF não tem
  acesso a contexto React) e, se houver, renderiza exatamente `Cliente / Endereço / Bairro / Cidade /
  UF / CEP / Telefone / Inscrição Estadual / CPF/CNPJ` (campos vazios são omitidos individualmente).
  Sem dados estendidos, o PDF continua idêntico ao layout atual (`Nome` / `Telefone`).

## Bug corrigido de passagem — OS PRO

Ao reescrever o RPC `create_service_order` para gravar os campos MB, também corrigimos um bug
pré-existente: a migration do OS PRO (`20260623000080_os_pro.sql`) adicionou as colunas `is_pro`,
`warranty_days`, `warranty_description`, `travel_cost`, `toll_cost`, `km_driven`, `km_rate`,
`other_costs`, `other_costs_desc` em `service_orders`, mas o `INSERT` do RPC nunca foi atualizado —
esses valores eram descartados silenciosamente ao criar uma OS. Agora são gravados corretamente.

## Testes realizados

- Migration aplicada em produção (`supabase db push`) e confirmada via query direta: a loja do
  owner `marrassibalancas@gmail.com` tem `store_settings.mb_customer_profile.use_extended_customer_data = true`;
  nenhuma outra loja tem linha nessa categoria.
- `npx tsc --noEmit` e `npm run lint` não introduziram erros novos nos arquivos alterados.
- Verificação visual via preview local, forçando a flag (override temporário, não commitado) para
  confirmar: formulário de cliente com os campos novos e validação obrigatória; card "Dados fiscais
  e endereço" na criação de OS com autopreenchimento; PDF com o cabeçalho estendido na ordem pedida.
- Confirmado que uma loja sem a flag mantém cadastro de cliente, tela de OS e PDF idênticos ao
  comportamento anterior.
- **Não testado**: fluxo ponta-a-ponta com o login real da MB Assistência (sem credenciais de
  acesso). Recomenda-se validar com o usuário real antes de considerar definitivamente encerrado.
