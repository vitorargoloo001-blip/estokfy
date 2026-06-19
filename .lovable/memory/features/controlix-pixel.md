---
name: Controlix Pixel
description: Sistema de pixel/tracking por loja para receber eventos de vendas, cancelamentos e clientes de sites externos
type: feature
---

## Tables
- `store_pixels` — pixel exclusivo por store_id com pixel_id, public_key, secret_key, allowed_domains, is_active
- `pixel_events` — eventos recebidos com event_type, external_event_id/order_id/customer_id, payload_json, processing_status, sale_id, customer_id, return_id

## Edge Function
- `pixel-events` — POST endpoint público (sem JWT), valida pixel_id + secret_key via headers (x-pixel-id, x-pixel-key)
- Suporta: purchase_approved, purchase_cancelled, refund_created/completed, exchange_created, customer_created, payment_approved/failed
- Idempotência via external_event_id
- Processa: cria/localiza cliente, cria venda, cancela venda, cria devolução
- Usa service_role_key (bypass RLS)

## Frontend
- `/pixel` — Página PixelSettings com 3 tabs: Configuração, Instalação (snippet), Eventos (monitoramento)
- Sidebar e MobileNav com link "Controlix Pixel" (ícone Zap)

## RLS
- store_pixels: SELECT/INSERT/UPDATE para owner/admin da loja, SELECT para super_admin
- pixel_events: SELECT para usuários da loja, SELECT para super_admin
