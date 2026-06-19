# MIGRATION_GUIDE.md — Estokfy

Guia para reconstruir o projeto fora do Lovable.

---

## 1. Pré-requisitos
- Node.js ≥ 20, npm/bun/pnpm.
- Conta Supabase (projeto novo) — ou self-hosted Postgres ≥ 15 com extensões `pgcrypto`, `pg_trgm`, `uuid-ossp`.
- Conta Supabase CLI: `npm i -g supabase`.
- Deno ≥ 1.40 (para rodar/deploy edge functions localmente).
- (Opcional) Conta no Lovable AI Gateway ou troque por OpenAI/Anthropic na edge `ai-support-chat`.

## 2. Dependências NPM
Veja `package.json`. Principais:
```
react 18, react-dom 18, react-router-dom 6, typescript 5, vite 5,
@supabase/supabase-js 2, @tanstack/react-query 5,
@radix-ui/* (shadcn), tailwindcss 3, tailwind-merge, tailwindcss-animate,
class-variance-authority, clsx, lucide-react,
react-hook-form, @hookform/resolvers, zod,
date-fns 3, framer-motion, recharts, sonner,
jspdf, jspdf-autotable, xlsx, idb, cmdk, vaul,
react-day-picker, embla-carousel-react, react-markdown, next-themes
```
Instalar: `npm install` (ou `bun install`).

## 3. Variáveis de ambiente

`.env` (frontend, prefixo `VITE_`):
```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon_key>
VITE_SUPABASE_PROJECT_ID=<ref>
```

Secrets das Edge Functions (`supabase secrets set`):
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
LOVABLE_API_KEY            # ou troque por OPENAI_API_KEY/ANTHROPIC_API_KEY
```

## 4. Estrutura do Supabase

### 4.1 Extensões
```sql
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists "uuid-ossp";
```

### 4.2 Auth
- Habilitar Email/Password (sem confirmação automática se desejar fluxo manual).
- (Opcional) Google OAuth.
- Configurar URLs de redirect (`http://localhost:5173`, domínio prod).

### 4.3 Schema
Aplicar todas as migrações em ordem cronológica:
```
supabase db push
```
Ou rodar `supabase/migrations/*.sql` manualmente em ordem alfabética (são datetime-prefixed).

Conteúdo: 41 tabelas em `public`, ~50 RPCs, ~8 triggers, RLS + GRANT em todas. Detalhes em `DATABASE.md` e `SUPABASE.md`.

### 4.4 Buckets de Storage
Criar (no painel ou via SQL `insert into storage.buckets`):
- `product-images` — **público**.
- `payment-receipts` — privado.
- `purchase-receipts` — privado.

Policies de storage (exemplos):
```sql
-- product-images: leitura pública, upload por usuários autenticados da loja
create policy "public read product-images"
on storage.objects for select
using (bucket_id = 'product-images');

create policy "auth upload product-images"
on storage.objects for insert to authenticated
with check (bucket_id = 'product-images');

-- payment/purchase-receipts: somente owner do path
create policy "store receipts read"
on storage.objects for select to authenticated
using (bucket_id in ('payment-receipts','purchase-receipts')
       and (storage.foldername(name))[1] = (select store_id::text from public.profiles where auth_user_id = auth.uid()));
```

### 4.5 Edge Functions
Deploy:
```
supabase functions deploy ai-support-chat
supabase functions deploy employees-invite
supabase functions deploy employees-admin
supabase functions deploy sales-create
supabase functions deploy sales-settle-payment
supabase functions deploy returns-create
supabase functions deploy stock-adjust
supabase functions deploy reports-summary
supabase functions deploy reports-detailed
supabase functions deploy reports-ai-analysis
supabase functions deploy verify-payment
supabase functions deploy pixel-events --no-verify-jwt
```
`pixel-events` é a única **pública** (sem JWT).

### 4.6 Seeds
- Inserir email do super admin: `insert into public.system_admins(email,is_active) values ('seu@email.com', true);`
- A primeira conta criada via signup dispara `bootstrap_new_store` automaticamente.

## 5. Ordem correta de implantação
1. Criar projeto Supabase (ou subir Postgres).
2. Habilitar extensões.
3. Configurar Auth (provedores + URLs).
4. Aplicar migrações (`supabase db push`).
5. Criar buckets + policies de storage.
6. Definir secrets das edge functions.
7. Deploy das edge functions.
8. Inserir registros em `system_admins`.
9. Configurar `.env` do frontend.
10. `npm install && npm run dev` — testar signup → bootstrap.
11. Build prod: `npm run build` → servir `dist/` (Vercel/Netlify/qualquer estático).

## 6. Produção — checklist
- [ ] HTTPS + domínio configurado.
- [ ] CORS das edges liberado para o domínio.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` jamais exposta no frontend.
- [ ] Backup automático do Postgres habilitado.
- [ ] Monitorar logs das edges (`supabase functions logs <name>`).
- [ ] Configurar provedor de email para confirmação/reset (caso ative).
- [ ] Rate limit no Supabase Auth (já default).
- [ ] Política de senha (mínimo 6 — ajustar para 8+ se quiser).
- [ ] Revisar políticas RLS uma a uma.

## 7. Substituições possíveis

| Hoje | Alternativa |
|---|---|
| Lovable AI Gateway | OpenAI / Anthropic / Gemini direto — ajustar `ai-support-chat`. |
| Supabase | Postgres self-hosted + PostgREST + GoTrue (mais trabalhoso). |
| jspdf | pdfmake / puppeteer (server-side). |
| react-query | swr (não recomendado, queda de features). |

## 8. Arquivos auto-gerados (não editar)
- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/types.ts` (regenerar: `supabase gen types typescript --linked > src/integrations/supabase/types.ts`)
- `.env` (variáveis VITE_SUPABASE_*)
- `supabase/config.toml`
