# DATABASE.md — Estokfy

41 tabelas em `public`. Multi-tenant: quase todas têm `store_id` (FK lógica para `stores`).
Todas têm RLS habilitada + GRANT para `authenticated` e `service_role`.

---

## Diagrama textual (relacionamentos principais)

```
auth.users
  └── profiles (auth_user_id) ── store_id ──► stores
                                       │
                                       ├── categories
                                       ├── suppliers
                                       ├── products ──► category, supplier
                                       │     └── stock_movements
                                       ├── customers
                                       │     ├── loyalty_credits
                                       │     │     └── loyalty_credit_uses
                                       │     └── (referenciada por sales)
                                       ├── sales ── customer, created_by(profile)
                                       │     ├── sale_items ──► products
                                       │     ├── payments
                                       │     ├── deliveries
                                       │     └── returns ── return_items ──► products
                                       ├── accounts_payable ──► suppliers
                                       │     └── cash_entries
                                       ├── cash_ledger (1:1 store)
                                       │     └── cash_entries
                                       ├── service_orders ── customer
                                       │     ├── service_order_items ──► products
                                       │     ├── service_order_payments
                                       │     ├── service_order_photos
                                       │     └── service_order_status_history
                                       ├── store_settings
                                       ├── store_pixels
                                       │     └── pixel_events ──► sales/customers/returns
                                       ├── notifications
                                       ├── audit_logs / sale_audit_logs / sale_deletion_logs / bulk_operations_log
                                       ├── ai_conversations
                                       │     ├── ai_messages
                                       │     └── ai_events
                                       ├── ai_handoffs / ai_training_data
                                       ├── report_ai_analyses
                                       ├── payment_verifications
                                       └── idempotency_keys

system_admins (global)
super_admin_logs (global, FK store_id)
```

---

## Tabelas (colunas, tipos, defaults, FKs)

### accounts_payable
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| description | text | NO |  |
| category | text | NO | 'outros'::text |
| supplier_id | uuid | YES |  |
| amount | numeric | NO |  |
| due_date | date | NO |  |
| payment_method | text | YES |  |
| status | text | NO | 'pending'::text |
| notes | text | YES |  |
| paid_at | timestamp with time zone | YES |  |
| paid_amount | numeric | YES |  |
| cash_entry_id | uuid | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |
| updated_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL

### ai_conversations
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| profile_id | uuid | NO |  |
| route | text | YES |  |
| status | text | NO | 'active'::text |
| created_at | timestamp with time zone | NO | now() |
| closed_at | timestamp with time zone | YES |  |
**FKs:**
- FOREIGN KEY (profile_id) REFERENCES profiles(id)
- FOREIGN KEY (store_id) REFERENCES stores(id)

### ai_events
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| conversation_id | uuid | NO |  |
| store_id | uuid | NO |  |
| action_type | text | NO |  |
| action_payload | jsonb | YES |  |
| confirmed | boolean | YES | false |
| result | jsonb | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
- FOREIGN KEY (store_id) REFERENCES stores(id)

### ai_handoffs
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| conversation_id | uuid | NO |  |
| store_id | uuid | NO |  |
| reason | text | NO |  |
| status | text | NO | 'pending'::text |
| assigned_to | uuid | YES |  |
| resolved_at | timestamp with time zone | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (assigned_to) REFERENCES profiles(id)
- FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
- FOREIGN KEY (store_id) REFERENCES stores(id)

### ai_messages
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| conversation_id | uuid | NO |  |
| role | text | NO |  |
| content | text | NO |  |
| redacted_content | text | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE

### ai_training_data
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | YES |  |
| intent | text | NO |  |
| category | text | NO |  |
| question_example | text | NO |  |
| answer_template | text | NO |  |
| action_type | text | YES |  |
| is_global | boolean | NO | true |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (store_id) REFERENCES stores(id)

### audit_logs
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| actor_profile_id | uuid | YES |  |
| action | text | NO |  |
| entity | text | NO |  |
| entity_id | uuid | YES |  |
| before_json | jsonb | YES |  |
| after_json | jsonb | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (actor_profile_id) REFERENCES profiles(id) ON DELETE SET NULL
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### bulk_operations_log
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| actor_profile_id | uuid | YES |  |
| operation | text | NO |  |
| total_requested | integer | NO | 0 |
| total_updated | integer | NO | 0 |
| total_failed | integer | NO | 0 |
| fields_changed | ARRAY | NO | '{}'::text[] |
| duration_ms | integer | YES |  |
| errors_json | jsonb | YES |  |
| filter_json | jsonb | YES |  |
| created_at | timestamp with time zone | NO | now() |
| status | text | NO | 'completed'::text |
| cancelled_at | timestamp with time zone | YES |  |
| cancelled_by | uuid | YES |  |
| processed_count | integer | NO | 0 |
| remaining_count | integer | NO | 0 |
| total_count | integer | NO | 0 |
| operation_id | uuid | YES | gen_random_uuid() |
| total_items | integer | NO | 0 |
| processed_items | integer | NO | 0 |
| success_items | integer | NO | 0 |
| error_items | integer | NO | 0 |
| started_at | timestamp with time zone | NO | now() |
| finished_at | timestamp with time zone | YES |  |

### cash_entries
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| ledger_id | uuid | NO |  |
| entry_type | text | NO |  |
| category | text | NO |  |
| amount | numeric | NO |  |
| occurred_at | timestamp with time zone | NO | now() |
| reference_type | text | YES |  |
| reference_id | uuid | YES |  |
| description | text | YES |  |
| created_by | uuid | YES |  |
| payment_method | text | YES |  |
| payment_id | uuid | YES |  |
| occurred_at_minute | bigint | YES |  |
**FKs:**
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
- FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL
- FOREIGN KEY (ledger_id) REFERENCES cash_ledger(id) ON DELETE RESTRICT

### cash_ledger
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| name | text | NO |  |
| currency | text | NO | 'BRL'::text |
| is_default | boolean | NO | false |
**FKs:**
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### categories
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| name | text | NO |  |
| slug | text | YES |  |
| description | text | YES |  |
| color | text | YES | '#6B7280'::text |
| icon | text | YES | 'Tag'::text |
| is_active | boolean | NO | true |
| sort_order | integer | NO | 0 |
| created_at | timestamp with time zone | NO | now() |
| updated_at | timestamp with time zone | NO | now() |
| created_by | uuid | YES |  |
| updated_by | uuid | YES |  |
**FKs:**
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### customers
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| name | text | NO |  |
| phone | text | YES |  |
| email | text | YES |  |
| doc_id | text | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### deliveries
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| sale_id | uuid | NO |  |
| method | text | NO |  |
| status | text | NO |  |
| tracking_code | text | YES |  |
| external_delivery_id | text | YES |  |
| delivery_cost | numeric | NO | 0 |
| delivered_at | timestamp with time zone | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### idempotency_keys
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| idem_key | text | NO |  |
| action | text | NO |  |
| request_hash | text | NO |  |
| response_json | jsonb | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### loyalty_credit_uses
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| credit_id | uuid | NO |  |
| customer_id | uuid | NO |  |
| sale_id | uuid | NO |  |
| amount_applied | numeric | NO |  |
| used_at | timestamp with time zone | NO | now() |
| reverted_at | timestamp with time zone | YES |  |
**FKs:**
- FOREIGN KEY (credit_id) REFERENCES loyalty_credits(id) ON DELETE CASCADE

### loyalty_credits
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| customer_id | uuid | NO |  |
| amount_generated | numeric | NO | 0 |
| amount_used | numeric | NO | 0 |
| amount_available | numeric | YES |  |
| reason | text | NO | 'Premiação por meta de compras'::text |
| status | text | NO | 'available'::text |
| source_sale_id | uuid | YES |  |
| generated_at | timestamp with time zone | NO | now() |
| expires_at | timestamp with time zone | YES |  |
| cancelled_at | timestamp with time zone | YES |  |
| created_at | timestamp with time zone | NO | now() |

### notifications
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| profile_id | uuid | YES |  |
| type | text | NO |  |
| severity | text | NO | 'info'::text |
| title | text | NO |  |
| description | text | YES |  |
| link | text | YES |  |
| entity_type | text | YES |  |
| entity_id | uuid | YES |  |
| dedupe_key | text | YES |  |
| read_at | timestamp with time zone | YES |  |
| created_at | timestamp with time zone | NO | now() |

### payment_verifications
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| user_id | uuid | NO |  |
| email | text | NO |  |
| plan_id | text | NO | 'basic'::text |
| expected_amount | numeric | NO | 49.90 |
| uploaded_file_url | text | YES |  |
| payment_status | text | NO | 'pending'::text |
| ai_confidence | numeric | YES |  |
| ai_reason | text | YES |  |
| extracted_name | text | YES |  |
| extracted_amount | numeric | YES |  |
| extracted_date | text | YES |  |
| extracted_pix_key | text | YES |  |
| match_result | text | YES |  |
| reviewer_type | text | YES |  |
| reviewed_at | timestamp with time zone | YES |  |
| created_at | timestamp with time zone | NO | now() |
| updated_at | timestamp with time zone | NO | now() |
| date_is_recent | boolean | YES |  |
| date_validation_result | text | YES |  |
**FKs:**
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### payments
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| sale_id | uuid | NO |  |
| method | text | NO |  |
| amount | numeric | NO |  |
| provider | text | YES |  |
| external_tx_id | text | YES |  |
| paid_at | timestamp with time zone | NO | now() |
| note | text | YES |  |
| created_by | uuid | YES |  |
| idempotency_key | text | YES |  |
| paid_at_minute | bigint | YES |  |
**FKs:**
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
- FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE

### pixel_events
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| pixel_id | text | NO |  |
| event_type | text | NO |  |
| external_event_id | text | YES |  |
| external_order_id | text | YES |  |
| external_customer_id | text | YES |  |
| payload_json | jsonb | NO | '{}'::jsonb |
| processing_status | text | NO | 'pending'::text |
| error_message | text | YES |  |
| sale_id | uuid | YES |  |
| customer_id | uuid | YES |  |
| return_id | uuid | YES |  |
| received_at | timestamp with time zone | NO | now() |
| processed_at | timestamp with time zone | YES |  |
**FKs:**
- FOREIGN KEY (sale_id) REFERENCES sales(id)
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
- FOREIGN KEY (customer_id) REFERENCES customers(id)
- FOREIGN KEY (return_id) REFERENCES returns(id)

### products
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| category_id | uuid | YES |  |
| sku | text | YES |  |
| barcode | text | YES |  |
| name | text | NO |  |
| brand | text | YES |  |
| model | text | YES |  |
| cost_price | numeric | NO | 0 |
| sale_price | numeric | NO | 0 |
| minimum_stock | integer | NO | 0 |
| on_hand | integer | NO | 0 |
| is_active | boolean | NO | true |
| image_path | text | YES |  |
| created_at | timestamp with time zone | NO | now() |
| updated_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### profiles
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| auth_user_id | uuid | NO |  |
| full_name | text | YES |  |
| role | text | NO |  |
| is_active | boolean | NO | true |
| created_at | timestamp with time zone | NO | now() |
| show_onboarding_guide | boolean | NO | true |
| phone | text | YES |  |
**FKs:**
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### report_ai_analyses
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| created_by | uuid | YES |  |
| report_type | text | NO | 'detailed'::text |
| period_start | date | NO |  |
| period_end | date | NO |  |
| analysis_text | text | NO |  |
| metadata | jsonb | YES | '{}'::jsonb |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (created_by) REFERENCES profiles(id)
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### return_items
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| return_id | uuid | NO |  |
| sale_item_id | uuid | YES |  |
| product_id | uuid | NO |  |
| qty | integer | NO |  |
| restock | boolean | NO | false |
| refund_amount | numeric | NO | 0 |
**FKs:**
- FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
- FOREIGN KEY (return_id) REFERENCES returns(id) ON DELETE CASCADE
- FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE SET NULL

### returns
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| sale_id | uuid | YES |  |
| status | text | NO |  |
| reason | text | NO |  |
| notes | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
- FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL
- FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL

### sale_audit_logs
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| sale_id | uuid | NO |  |
| actor_profile_id | uuid | YES |  |
| actor_user_id | uuid | YES |  |
| reason | text | NO |  |
| changes | jsonb | NO | '{}'::jsonb |
| before_json | jsonb | YES |  |
| after_json | jsonb | YES |  |
| created_at | timestamp with time zone | NO | now() |

### sale_deletion_logs
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| sale_id | uuid | NO |  |
| store_id | uuid | NO |  |
| deleted_by | uuid | YES |  |
| deleted_by_user_id | uuid | YES |  |
| deleted_at | timestamp with time zone | NO | now() |
| deletion_reason | text | NO |  |
| original_sale_data | jsonb | NO |  |
| original_items | jsonb | NO | '[]'::jsonb |
| original_payments | jsonb | NO | '[]'::jsonb |
| original_total | numeric | NO | 0 |
| original_amount_paid | numeric | NO | 0 |
| original_payment_status | text | YES |  |
| original_payment_method | text | YES |  |
| original_customer_id | uuid | YES |  |
| impacts | jsonb | NO | '{}'::jsonb |
**FKs:**
- FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### sale_items
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| sale_id | uuid | NO |  |
| product_id | uuid | NO |  |
| qty | integer | NO |  |
| unit_price | numeric | NO | 0 |
| unit_cost | numeric | NO | 0 |
| line_total | numeric | NO | 0 |
| product_name_snapshot | text | YES |  |
| product_sku_snapshot | text | YES |  |
| product_category_snapshot | text | YES |  |
**FKs:**
- FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
- FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT

### sales
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| customer_id | uuid | YES |  |
| status | text | NO |  |
| gross_total | numeric | NO | 0 |
| discount_total | numeric | NO | 0 |
| shipping_fee | numeric | NO | 0 |
| net_total | numeric | NO | 0 |
| cost_total | numeric | NO | 0 |
| profit_gross | numeric | NO | 0 |
| notes | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |
| payment_status | text | NO | 'paid'::text |
| amount_paid | numeric | NO | 0 |
| amount_pending | numeric | NO | 0 |
| due_date | date | YES |  |
| deleted_at | timestamp with time zone | YES |  |
| deleted_by | uuid | YES |  |
| deletion_reason | text | YES |  |
| sale_date | date | NO | ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date |
| registered_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL
- FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
- FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL

### service_order_items
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| service_order_id | uuid | NO |  |
| item_type | text | NO |  |
| product_id | uuid | YES |  |
| description | text | NO |  |
| qty | numeric | NO | 1 |
| unit_price | numeric | NO | 0 |
| total | numeric | NO | 0 |
| stock_movement_id | uuid | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (service_order_id) REFERENCES service_orders(id) ON DELETE CASCADE

### service_order_payments
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| service_order_id | uuid | NO |  |
| amount | numeric | NO |  |
| method | text | NO |  |
| note | text | YES |  |
| paid_at | timestamp with time zone | NO | now() |
| cash_entry_id | uuid | YES |  |
| receivable_id | uuid | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (service_order_id) REFERENCES service_orders(id) ON DELETE CASCADE

### service_order_photos
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| service_order_id | uuid | NO |  |
| storage_path | text | NO |  |
| caption | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (service_order_id) REFERENCES service_orders(id) ON DELETE CASCADE

### service_order_status_history
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| service_order_id | uuid | NO |  |
| from_status | text | YES |  |
| to_status | text | NO |  |
| note | text | YES |  |
| actor_profile_id | uuid | YES |  |
| actor_user_id | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (service_order_id) REFERENCES service_orders(id) ON DELETE CASCADE

### service_orders
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| os_number | integer | NO |  |
| customer_id | uuid | YES |  |
| customer_name | text | NO |  |
| customer_phone | text | YES |  |
| device | text | NO |  |
| brand | text | YES |  |
| model | text | YES |  |
| imei_serial | text | YES |  |
| device_password | text | YES |  |
| accessories | text | YES |  |
| device_condition | text | YES |  |
| reported_issue | text | NO |  |
| internal_notes | text | YES |  |
| priority | text | NO | 'normal'::text |
| technician_profile_id | uuid | YES |  |
| entry_date | timestamp with time zone | NO | now() |
| estimated_delivery | date | YES |  |
| delivered_at | timestamp with time zone | YES |  |
| status | text | NO | 'aberta'::text |
| labor_amount | numeric | NO | 0 |
| parts_amount | numeric | NO | 0 |
| discount | numeric | NO | 0 |
| total_amount | numeric | NO | 0 |
| paid_amount | numeric | NO | 0 |
| pending_amount | numeric | NO | 0 |
| terms_snapshot | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |
| updated_at | timestamp with time zone | NO | now() |
| cancelled_at | timestamp with time zone | YES |  |

### stock_movements
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| product_id | uuid | NO |  |
| movement_type | text | NO |  |
| qty | integer | NO |  |
| unit_cost | numeric | YES |  |
| reference_type | text | YES |  |
| reference_id | uuid | YES |  |
| reason | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |
| supplier_id | uuid | YES |  |
| payment_method | text | YES |  |
| receipt_path | text | YES |  |
| total_amount | numeric | YES |  |
**FKs:**
- FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
- FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL
- FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### store_pixels
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| pixel_id | text | NO | encode(extensions.gen_random_bytes(12), 'hex'::text) |
| public_key | text | NO | encode(extensions.gen_random_bytes(16), 'hex'::text) |
| secret_key | text | NO | encode(extensions.gen_random_bytes(32), 'hex'::text) |
| is_active | boolean | NO | true |
| allowed_domains | ARRAY | NO | '{}'::text[] |
| created_at | timestamp with time zone | NO | now() |
| updated_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### store_settings
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| category | text | NO |  |
| settings | jsonb | NO | '{}'::jsonb |
| updated_at | timestamp with time zone | NO | now() |
| updated_by | uuid | YES |  |
| os_terms_text | text | YES | 'O cliente declara estar ciente das condições do aparelho no momento da entrada, dos serviços solicitados e dos prazos informados. A retirada do aparelho só será realizada mediante confirmação de pagamento quando houver valor pendente.'::text |
**FKs:**
- FOREIGN KEY (updated_by) REFERENCES profiles(id)
- FOREIGN KEY (store_id) REFERENCES stores(id)

### stores
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| city | text | YES |  |
| state | text | YES |  |
| created_at | timestamp with time zone | NO | now() |
| trade_name | text | YES |  |
| legal_name | text | YES |  |
| cnpj | text | YES |  |
| state_registration | text | YES |  |
| phone | text | YES |  |
| whatsapp | text | YES |  |
| email | text | YES |  |
| address | text | YES |  |
| zip_code | text | YES |  |
| logo_path | text | YES |  |
| primary_color | text | YES | '#3B82F6'::text |
| secondary_color | text | YES | '#1E40AF'::text |
| plan | text | NO | 'basic'::text |
| subscription_status | text | NO | 'active'::text |
| access_enabled | boolean | NO | true |
| trial_ends_at | timestamp with time zone | YES |  |
| expires_at | timestamp with time zone | YES |  |
| notes | text | YES |  |

### super_admin_logs
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| admin_user_id | uuid | NO |  |
| store_id | uuid | YES |  |
| action | text | NO |  |
| before_json | jsonb | YES |  |
| after_json | jsonb | YES |  |
| notes | text | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (store_id) REFERENCES stores(id)

### suppliers
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| store_id | uuid | NO |  |
| name | text | NO |  |
| phone | text | YES |  |
| email | text | YES |  |
| notes | text | YES |  |
| created_at | timestamp with time zone | NO | now() |
**FKs:**
- FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE

### system_admins
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| email | text | NO |  |
| is_active | boolean | NO | true |
| created_at | timestamp with time zone | NO | now() |


---

## Índices principais

```
accounts_payable_pkey|accounts_payable|CREATE UNIQUE INDEX accounts_payable_pkey ON public.accounts_payable USING btree (id)
idx_payable_store_status|accounts_payable|CREATE INDEX idx_payable_store_status ON public.accounts_payable USING btree (store_id, status, due_date)
idx_ai_conv_store_created|ai_conversations|CREATE INDEX idx_ai_conv_store_created ON public.ai_conversations USING btree (store_id, created_at DESC)
ai_conversations_pkey|ai_conversations|CREATE UNIQUE INDEX ai_conversations_pkey ON public.ai_conversations USING btree (id)
idx_ai_events_conv|ai_events|CREATE INDEX idx_ai_events_conv ON public.ai_events USING btree (conversation_id)
ai_events_pkey|ai_events|CREATE UNIQUE INDEX ai_events_pkey ON public.ai_events USING btree (id)
ai_handoffs_pkey|ai_handoffs|CREATE UNIQUE INDEX ai_handoffs_pkey ON public.ai_handoffs USING btree (id)
idx_ai_msg_conv|ai_messages|CREATE INDEX idx_ai_msg_conv ON public.ai_messages USING btree (conversation_id, created_at)
ai_messages_pkey|ai_messages|CREATE UNIQUE INDEX ai_messages_pkey ON public.ai_messages USING btree (id)
ai_training_data_pkey|ai_training_data|CREATE UNIQUE INDEX ai_training_data_pkey ON public.ai_training_data USING btree (id)
audit_logs_pkey|audit_logs|CREATE UNIQUE INDEX audit_logs_pkey ON public.audit_logs USING btree (id)
idx_audit_store_time|audit_logs|CREATE INDEX idx_audit_store_time ON public.audit_logs USING btree (store_id, created_at DESC)
bulk_operations_log_pkey|bulk_operations_log|CREATE UNIQUE INDEX bulk_operations_log_pkey ON public.bulk_operations_log USING btree (id)
idx_bulk_log_store_created|bulk_operations_log|CREATE INDEX idx_bulk_log_store_created ON public.bulk_operations_log USING btree (store_id, created_at DESC)
idx_bulk_log_operation_id|bulk_operations_log|CREATE INDEX idx_bulk_log_operation_id ON public.bulk_operations_log USING btree (operation_id)
cash_entries_payment_uniq|cash_entries|CREATE UNIQUE INDEX cash_entries_payment_uniq ON public.cash_entries USING btree (payment_id) WHERE (payment_id IS NOT NULL)
cash_entries_pkey|cash_entries|CREATE UNIQUE INDEX cash_entries_pkey ON public.cash_entries USING btree (id)
cash_entries_store_occurred_at_idx|cash_entries|CREATE INDEX cash_entries_store_occurred_at_idx ON public.cash_entries USING btree (store_id, occurred_at DESC)
cash_entries_sale_dedup_uniq|cash_entries|CREATE UNIQUE INDEX cash_entries_sale_dedup_uniq ON public.cash_entries USING btree (store_id, reference_type, reference_id, amount, occurred_at_minute) WHERE (reference_id IS NOT NULL)
idx_cash_entries_store_time|cash_entries|CREATE INDEX idx_cash_entries_store_time ON public.cash_entries USING btree (store_id, occurred_at DESC)
idx_cash_entries_store_occurred_at|cash_entries|CREATE INDEX idx_cash_entries_store_occurred_at ON public.cash_entries USING btree (store_id, occurred_at)
cash_ledger_store_id_name_key|cash_ledger|CREATE UNIQUE INDEX cash_ledger_store_id_name_key ON public.cash_ledger USING btree (store_id, name)
cash_ledger_pkey|cash_ledger|CREATE UNIQUE INDEX cash_ledger_pkey ON public.cash_ledger USING btree (id)
categories_pkey|categories|CREATE UNIQUE INDEX categories_pkey ON public.categories USING btree (id)
categories_store_id_name_key|categories|CREATE UNIQUE INDEX categories_store_id_name_key ON public.categories USING btree (store_id, name)
categories_name_store_unique|categories|CREATE UNIQUE INDEX categories_name_store_unique ON public.categories USING btree (store_id, name)
idx_customers_store_name|customers|CREATE INDEX idx_customers_store_name ON public.customers USING btree (store_id, name)
customers_pkey|customers|CREATE UNIQUE INDEX customers_pkey ON public.customers USING btree (id)
idx_deliveries_sale|deliveries|CREATE INDEX idx_deliveries_sale ON public.deliveries USING btree (sale_id)
deliveries_pkey|deliveries|CREATE UNIQUE INDEX deliveries_pkey ON public.deliveries USING btree (id)
idempotency_keys_pkey|idempotency_keys|CREATE UNIQUE INDEX idempotency_keys_pkey ON public.idempotency_keys USING btree (id)
idempotency_keys_store_id_idem_key_key|idempotency_keys|CREATE UNIQUE INDEX idempotency_keys_store_id_idem_key_key ON public.idempotency_keys USING btree (store_id, idem_key)
idx_lcu_credit|loyalty_credit_uses|CREATE INDEX idx_lcu_credit ON public.loyalty_credit_uses USING btree (credit_id)
loyalty_credit_uses_pkey|loyalty_credit_uses|CREATE UNIQUE INDEX loyalty_credit_uses_pkey ON public.loyalty_credit_uses USING btree (id)
idx_lcu_sale|loyalty_credit_uses|CREATE INDEX idx_lcu_sale ON public.loyalty_credit_uses USING btree (sale_id)
idx_lc_status|loyalty_credits|CREATE INDEX idx_lc_status ON public.loyalty_credits USING btree (store_id, status)
loyalty_credits_pkey|loyalty_credits|CREATE UNIQUE INDEX loyalty_credits_pkey ON public.loyalty_credits USING btree (id)
idx_lc_store_customer|loyalty_credits|CREATE INDEX idx_lc_store_customer ON public.loyalty_credits USING btree (store_id, customer_id)
idx_notifications_store|notifications|CREATE INDEX idx_notifications_store ON public.notifications USING btree (store_id, created_at DESC)
notifications_pkey|notifications|CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id)
uq_notifications_dedupe|notifications|CREATE UNIQUE INDEX uq_notifications_dedupe ON public.notifications USING btree (store_id, dedupe_key) WHERE (dedupe_key IS NOT NULL)
idx_notifications_unread|notifications|CREATE INDEX idx_notifications_unread ON public.notifications USING btree (store_id, read_at) WHERE (read_at IS NULL)
payment_verifications_pkey|payment_verifications|CREATE UNIQUE INDEX payment_verifications_pkey ON public.payment_verifications USING btree (id)
idx_payments_store_paid_at|payments|CREATE INDEX idx_payments_store_paid_at ON public.payments USING btree (store_id, paid_at)
payments_idem_key_uniq|payments|CREATE UNIQUE INDEX payments_idem_key_uniq ON public.payments USING btree (store_id, idempotency_key) WHERE (idempotency_key IS NOT NULL)
payments_sale_dedup_uniq|payments|CREATE UNIQUE INDEX payments_sale_dedup_uniq ON public.payments USING btree (sale_id, method, amount, paid_at_minute) WHERE (sale_id IS NOT NULL)
payments_store_paid_at_idx|payments|CREATE INDEX payments_store_paid_at_idx ON public.payments USING btree (store_id, paid_at DESC)
idx_payments_sale|payments|CREATE INDEX idx_payments_sale ON public.payments USING btree (sale_id)
payments_pkey|payments|CREATE UNIQUE INDEX payments_pkey ON public.payments USING btree (id)
pixel_events_pkey|pixel_events|CREATE UNIQUE INDEX pixel_events_pkey ON public.pixel_events USING btree (id)
idx_pixel_events_external_order|pixel_events|CREATE INDEX idx_pixel_events_external_order ON public.pixel_events USING btree (store_id, external_order_id)
idx_pixel_events_external_event|pixel_events|CREATE INDEX idx_pixel_events_external_event ON public.pixel_events USING btree (external_event_id)
idx_pixel_events_pixel_id|pixel_events|CREATE INDEX idx_pixel_events_pixel_id ON public.pixel_events USING btree (pixel_id)
idx_pixel_events_status|pixel_events|CREATE INDEX idx_pixel_events_status ON public.pixel_events USING btree (processing_status)
idx_pixel_events_received|pixel_events|CREATE INDEX idx_pixel_events_received ON public.pixel_events USING btree (received_at DESC)
idx_pixel_events_store_id|pixel_events|CREATE INDEX idx_pixel_events_store_id ON public.pixel_events USING btree (store_id)
idx_products_bulk_filter|products|CREATE INDEX idx_products_bulk_filter ON public.products USING btree (store_id, is_active, category_id, brand, id)
idx_products_store_name|products|CREATE INDEX idx_products_store_name ON public.products USING btree (store_id, name)
products_pkey|products|CREATE UNIQUE INDEX products_pkey ON public.products USING btree (id)
products_store_id_sku_key|products|CREATE UNIQUE INDEX products_store_id_sku_key ON public.products USING btree (store_id, sku) WHERE ((sku IS NOT NULL) AND (sku <> ''::text))
idx_products_store_onhand|products|CREATE INDEX idx_products_store_onhand ON public.products USING btree (store_id, on_hand)
products_store_barcode_unique|products|CREATE UNIQUE INDEX products_store_barcode_unique ON public.products USING btree (store_id, barcode) WHERE ((barcode IS NOT NULL) AND (length(btrim(barcode)) > 0))
idx_products_store_brand_model|products|CREATE INDEX idx_products_store_brand_model ON public.products USING btree (store_id, brand, model)
profiles_pkey|profiles|CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id)
profiles_auth_user_id_key|profiles|CREATE UNIQUE INDEX profiles_auth_user_id_key ON public.profiles USING btree (auth_user_id)
idx_profiles_store|profiles|CREATE INDEX idx_profiles_store ON public.profiles USING btree (store_id)
report_ai_analyses_pkey|report_ai_analyses|CREATE UNIQUE INDEX report_ai_analyses_pkey ON public.report_ai_analyses USING btree (id)
idx_rai_store_period|report_ai_analyses|CREATE INDEX idx_rai_store_period ON public.report_ai_analyses USING btree (store_id, period_start, period_end, created_at DESC)
idx_return_items_return|return_items|CREATE INDEX idx_return_items_return ON public.return_items USING btree (return_id)
return_items_pkey|return_items|CREATE UNIQUE INDEX return_items_pkey ON public.return_items USING btree (id)
returns_pkey|returns|CREATE UNIQUE INDEX returns_pkey ON public.returns USING btree (id)
sale_audit_logs_sale_idx|sale_audit_logs|CREATE INDEX sale_audit_logs_sale_idx ON public.sale_audit_logs USING btree (sale_id, created_at DESC)
sale_audit_logs_pkey|sale_audit_logs|CREATE UNIQUE INDEX sale_audit_logs_pkey ON public.sale_audit_logs USING btree (id)
sale_audit_logs_store_idx|sale_audit_logs|CREATE INDEX sale_audit_logs_store_idx ON public.sale_audit_logs USING btree (store_id, created_at DESC)
idx_sdl_store_deleted_at|sale_deletion_logs|CREATE INDEX idx_sdl_store_deleted_at ON public.sale_deletion_logs USING btree (store_id, deleted_at DESC)
sale_deletion_logs_pkey|sale_deletion_logs|CREATE UNIQUE INDEX sale_deletion_logs_pkey ON public.sale_deletion_logs USING btree (id)
sale_items_dedup_uniq|sale_items|CREATE UNIQUE INDEX sale_items_dedup_uniq ON public.sale_items USING btree (sale_id, product_id, qty, unit_price)
sale_items_pkey|sale_items|CREATE UNIQUE INDEX sale_items_pkey ON public.sale_items USING btree (id)
idx_sale_items_sale|sale_items|CREATE INDEX idx_sale_items_sale ON public.sale_items USING btree (sale_id)
idx_sale_items_sale_id|sale_items|CREATE INDEX idx_sale_items_sale_id ON public.sale_items USING btree (sale_id)
idx_sales_store_sale_date_active|sales|CREATE INDEX idx_sales_store_sale_date_active ON public.sales USING btree (store_id, sale_date) WHERE (deleted_at IS NULL)
idx_sales_notes_trgm|sales|CREATE INDEX idx_sales_notes_trgm ON public.sales USING gin (notes gin_trgm_ops) WHERE (notes IS NOT NULL)
idx_sales_status_active|sales|CREATE INDEX idx_sales_status_active ON public.sales USING btree (store_id, status) WHERE (deleted_at IS NULL)
idx_sales_deleted_at|sales|CREATE INDEX idx_sales_deleted_at ON public.sales USING btree (store_id, deleted_at)
idx_sales_store_created_at|sales|CREATE INDEX idx_sales_store_created_at ON public.sales USING btree (store_id, created_at)
idx_sales_due_date|sales|CREATE INDEX idx_sales_due_date ON public.sales USING btree (store_id, due_date) WHERE (payment_status <> 'paid'::text)
idx_sales_store_payment_status|sales|CREATE INDEX idx_sales_store_payment_status ON public.sales USING btree (store_id, payment_status)
sales_pkey|sales|CREATE UNIQUE INDEX sales_pkey ON public.sales USING btree (id)
idx_sales_store_time|sales|CREATE INDEX idx_sales_store_time ON public.sales USING btree (store_id, created_at DESC)
idx_sales_store_sale_date|sales|CREATE INDEX idx_sales_store_sale_date ON public.sales USING btree (store_id, sale_date)
sales_store_created_at_idx|sales|CREATE INDEX sales_store_created_at_idx ON public.sales USING btree (store_id, created_at DESC)
idx_soi_store|service_order_items|CREATE INDEX idx_soi_store ON public.service_order_items USING btree (store_id)
idx_soi_os|service_order_items|CREATE INDEX idx_soi_os ON public.service_order_items USING btree (service_order_id)
service_order_items_pkey|service_order_items|CREATE UNIQUE INDEX service_order_items_pkey ON public.service_order_items USING btree (id)
idx_sop2_os|service_order_payments|CREATE INDEX idx_sop2_os ON public.service_order_payments USING btree (service_order_id)
idx_sop2_store|service_order_payments|CREATE INDEX idx_sop2_store ON public.service_order_payments USING btree (store_id, paid_at DESC)
service_order_payments_pkey|service_order_payments|CREATE UNIQUE INDEX service_order_payments_pkey ON public.service_order_payments USING btree (id)
service_order_photos_pkey|service_order_photos|CREATE UNIQUE INDEX service_order_photos_pkey ON public.service_order_photos USING btree (id)
idx_sop_os|service_order_photos|CREATE INDEX idx_sop_os ON public.service_order_photos USING btree (service_order_id)
service_order_status_history_pkey|service_order_status_history|CREATE UNIQUE INDEX service_order_status_history_pkey ON public.service_order_status_history USING btree (id)
idx_sosh_os|service_order_status_history|CREATE INDEX idx_sosh_os ON public.service_order_status_history USING btree (service_order_id, created_at DESC)
idx_so_store_tech|service_orders|CREATE INDEX idx_so_store_tech ON public.service_orders USING btree (store_id, technician_profile_id)
service_orders_pkey|service_orders|CREATE UNIQUE INDEX service_orders_pkey ON public.service_orders USING btree (id)
idx_so_store_status|service_orders|CREATE INDEX idx_so_store_status ON public.service_orders USING btree (store_id, status)
idx_so_entry|service_orders|CREATE INDEX idx_so_entry ON public.service_orders USING btree (store_id, entry_date DESC)
service_orders_store_id_os_number_key|service_orders|CREATE UNIQUE INDEX service_orders_store_id_os_number_key ON public.service_orders USING btree (store_id, os_number)
idx_so_store_customer|service_orders|CREATE INDEX idx_so_store_customer ON public.service_orders USING btree (store_id, customer_id)
stock_movements_pkey|stock_movements|CREATE UNIQUE INDEX stock_movements_pkey ON public.stock_movements USING btree (id)
idx_stock_movements_store_product_time|stock_movements|CREATE INDEX idx_stock_movements_store_product_time ON public.stock_movements USING btree (store_id, product_id, created_at DESC)
idx_stock_movements_store_type_date|stock_movements|CREATE INDEX idx_stock_movements_store_type_date ON public.stock_movements USING btree (store_id, movement_type, created_at DESC)
idx_stock_movements_supplier|stock_movements|CREATE INDEX idx_stock_movements_supplier ON public.stock_movements USING btree (supplier_id)
store_pixels_pixel_id_key|store_pixels|CREATE UNIQUE INDEX store_pixels_pixel_id_key ON public.store_pixels USING btree (pixel_id)
store_pixels_public_key_key|store_pixels|CREATE UNIQUE INDEX store_pixels_public_key_key ON public.store_pixels USING btree (public_key)
idx_store_pixels_public_key|store_pixels|CREATE INDEX idx_store_pixels_public_key ON public.store_pixels USING btree (public_key)
idx_store_pixels_store_id|store_pixels|CREATE INDEX idx_store_pixels_store_id ON public.store_pixels USING btree (store_id)
idx_store_pixels_pixel_id|store_pixels|CREATE INDEX idx_store_pixels_pixel_id ON public.store_pixels USING btree (pixel_id)
store_pixels_pkey|store_pixels|CREATE UNIQUE INDEX store_pixels_pkey ON public.store_pixels USING btree (id)
store_settings_pkey|store_settings|CREATE UNIQUE INDEX store_settings_pkey ON public.store_settings USING btree (id)
store_settings_store_id_category_key|store_settings|CREATE UNIQUE INDEX store_settings_store_id_category_key ON public.store_settings USING btree (store_id, category)
idx_store_settings_lookup|store_settings|CREATE INDEX idx_store_settings_lookup ON public.store_settings USING btree (store_id, category)
stores_pkey|stores|CREATE UNIQUE INDEX stores_pkey ON public.stores USING btree (id)
super_admin_logs_pkey|super_admin_logs|CREATE UNIQUE INDEX super_admin_logs_pkey ON public.super_admin_logs USING btree (id)
suppliers_pkey|suppliers|CREATE UNIQUE INDEX suppliers_pkey ON public.suppliers USING btree (id)
suppliers_store_id_name_key|suppliers|CREATE UNIQUE INDEX suppliers_store_id_name_key ON public.suppliers USING btree (store_id, name)
system_admins_pkey|system_admins|CREATE UNIQUE INDEX system_admins_pkey ON public.system_admins USING btree (id)
system_admins_email_key|system_admins|CREATE UNIQUE INDEX system_admins_email_key ON public.system_admins USING btree (email)
```
