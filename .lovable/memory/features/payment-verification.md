---
name: Payment Verification Flow
description: Pix receipt verification with AI classification + mandatory admin approval before granting access
type: feature
---
## Flow
1. User creates account → bootstrap creates store with access_enabled=false, subscription_status=pending_payment
2. User verifies email
3. User uploads Pix receipt at /verificacao-pagamento
4. Edge function verify-payment analyzes receipt with AI (gemini-2.5-flash)
5. AI CLASSIFIES only (looks_valid/looks_invalid/needs_review) — NEVER grants access
6. Status always set to waiting_admin_approval after AI analysis
7. Admin reviews at /super-admin/payment-verifications → approve/reject/request resubmission
8. Only admin approval sets access_enabled=true

## CRITICAL RULE
AI does NOT approve or grant access. Only admin manual approval does.

## Statuses
- pending: no receipt uploaded
- under_review: AI analyzing
- waiting_admin_approval: AI done, waiting admin decision
- approved_by_admin: admin approved, access granted
- rejected: admin rejected
- needs_resubmission: admin requested new receipt

## Tables
- payment_verifications: store_id, user_id, email, plan_id, expected_amount, payment_status, ai_* fields, date_is_recent, date_validation_result
- Storage bucket: payment-receipts (private)

## Pix Recipient Data
- Name: VITOR DE OLIVEIRA ARGOLO
- CPF/Pix key: 587.686.978-30
- Bank: BANCO INTER

## Admin Panel
- /super-admin/payment-verifications — list with filters, view receipt, approve/reject/resubmit
- All actions logged to super_admin_logs
