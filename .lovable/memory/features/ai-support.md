---
name: AI Support Chat
description: Chat drawer with Lovable AI, action confirmation, handoff, 30 seed intents, 5 tables
type: feature
---
- Tables: ai_conversations, ai_messages, ai_events, ai_handoffs, ai_training_data
- Edge function: ai-support-chat (POST, JWT auth, Lovable AI gateway, google/gemini-3-flash-preview)
- System prompt: temp 0.2, max 600 tokens, 10 msg context + route + role
- Actions: sales-create, stock-adjust, returns-create, reports-summary (with confirmation flow)
- Handoff: creates ai_handoffs row when uncertain
- Redaction: CPF, card numbers, long tokens masked
- UI: AISupportChat drawer in AppLayout, chips [Vender][Troca][Estoque][Entrega][Fechar caixa]
- RLS: user sees only own conversations; owner/admin see handoffs and training data
