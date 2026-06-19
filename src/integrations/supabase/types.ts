export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts_payable: {
        Row: {
          amount: number
          cash_entry_id: string | null
          category: string
          created_at: string
          created_by: string | null
          description: string
          due_date: string
          id: string
          notes: string | null
          paid_amount: number | null
          paid_at: string | null
          payment_method: string | null
          status: string
          store_id: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          cash_entry_id?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description: string
          due_date: string
          id?: string
          notes?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payment_method?: string | null
          status?: string
          store_id: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          cash_entry_id?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string
          id?: string
          notes?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payment_method?: string | null
          status?: string
          store_id?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_payable_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversations: {
        Row: {
          closed_at: string | null
          created_at: string
          id: string
          profile_id: string
          route: string | null
          status: string
          store_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          id?: string
          profile_id: string
          route?: string | null
          status?: string
          store_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          id?: string
          profile_id?: string
          route?: string | null
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_conversations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_events: {
        Row: {
          action_payload: Json | null
          action_type: string
          confirmed: boolean | null
          conversation_id: string
          created_at: string
          id: string
          result: Json | null
          store_id: string
        }
        Insert: {
          action_payload?: Json | null
          action_type: string
          confirmed?: boolean | null
          conversation_id: string
          created_at?: string
          id?: string
          result?: Json | null
          store_id: string
        }
        Update: {
          action_payload?: Json | null
          action_type?: string
          confirmed?: boolean | null
          conversation_id?: string
          created_at?: string
          id?: string
          result?: Json | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_handoffs: {
        Row: {
          assigned_to: string | null
          conversation_id: string
          created_at: string
          id: string
          reason: string
          resolved_at: string | null
          status: string
          store_id: string
        }
        Insert: {
          assigned_to?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          reason: string
          resolved_at?: string | null
          status?: string
          store_id: string
        }
        Update: {
          assigned_to?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          reason?: string
          resolved_at?: string | null
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_handoffs_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_handoffs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_handoffs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          redacted_content: string | null
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          redacted_content?: string | null
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          redacted_content?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_training_data: {
        Row: {
          action_type: string | null
          answer_template: string
          category: string
          created_at: string
          id: string
          intent: string
          is_global: boolean
          question_example: string
          store_id: string | null
        }
        Insert: {
          action_type?: string | null
          answer_template: string
          category: string
          created_at?: string
          id?: string
          intent: string
          is_global?: boolean
          question_example: string
          store_id?: string | null
        }
        Update: {
          action_type?: string | null
          answer_template?: string
          category?: string
          created_at?: string
          id?: string
          intent?: string
          is_global?: boolean
          question_example?: string
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_training_data_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_profile_id: string | null
          after_json: Json | null
          before_json: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          store_id: string
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          store_id: string
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_operations_log: {
        Row: {
          actor_profile_id: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          duration_ms: number | null
          error_items: number
          errors_json: Json | null
          fields_changed: string[]
          filter_json: Json | null
          finished_at: string | null
          id: string
          operation: string
          operation_id: string | null
          processed_count: number
          processed_items: number
          remaining_count: number
          started_at: string
          status: string
          store_id: string
          success_items: number
          total_count: number
          total_failed: number
          total_items: number
          total_requested: number
          total_updated: number
        }
        Insert: {
          actor_profile_id?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          duration_ms?: number | null
          error_items?: number
          errors_json?: Json | null
          fields_changed?: string[]
          filter_json?: Json | null
          finished_at?: string | null
          id?: string
          operation: string
          operation_id?: string | null
          processed_count?: number
          processed_items?: number
          remaining_count?: number
          started_at?: string
          status?: string
          store_id: string
          success_items?: number
          total_count?: number
          total_failed?: number
          total_items?: number
          total_requested?: number
          total_updated?: number
        }
        Update: {
          actor_profile_id?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          duration_ms?: number | null
          error_items?: number
          errors_json?: Json | null
          fields_changed?: string[]
          filter_json?: Json | null
          finished_at?: string | null
          id?: string
          operation?: string
          operation_id?: string | null
          processed_count?: number
          processed_items?: number
          remaining_count?: number
          started_at?: string
          status?: string
          store_id?: string
          success_items?: number
          total_count?: number
          total_failed?: number
          total_items?: number
          total_requested?: number
          total_updated?: number
        }
        Relationships: []
      }
      cash_entries: {
        Row: {
          amount: number
          category: string
          created_by: string | null
          description: string | null
          entry_type: string
          id: string
          ledger_id: string
          occurred_at: string
          occurred_at_minute: number | null
          payment_id: string | null
          payment_method: string | null
          reference_id: string | null
          reference_type: string | null
          store_id: string
        }
        Insert: {
          amount: number
          category: string
          created_by?: string | null
          description?: string | null
          entry_type: string
          id?: string
          ledger_id: string
          occurred_at?: string
          occurred_at_minute?: number | null
          payment_id?: string | null
          payment_method?: string | null
          reference_id?: string | null
          reference_type?: string | null
          store_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_by?: string | null
          description?: string | null
          entry_type?: string
          id?: string
          ledger_id?: string
          occurred_at?: string
          occurred_at_minute?: number | null
          payment_id?: string | null
          payment_method?: string | null
          reference_id?: string | null
          reference_type?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_entries_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "cash_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_entries_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_ledger: {
        Row: {
          currency: string
          id: string
          is_default: boolean
          name: string
          store_id: string
        }
        Insert: {
          currency?: string
          id?: string
          is_default?: boolean
          name: string
          store_id: string
        }
        Update: {
          currency?: string
          id?: string
          is_default?: boolean
          name?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_ledger_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          slug: string | null
          sort_order: number
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug?: string | null
          sort_order?: number
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string | null
          sort_order?: number
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          doc_id: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          store_id: string
        }
        Insert: {
          created_at?: string
          doc_id?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          store_id: string
        }
        Update: {
          created_at?: string
          doc_id?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          created_at: string
          delivered_at: string | null
          delivery_cost: number
          external_delivery_id: string | null
          id: string
          method: string
          sale_id: string
          status: string
          store_id: string
          tracking_code: string | null
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          delivery_cost?: number
          external_delivery_id?: string | null
          id?: string
          method: string
          sale_id: string
          status: string
          store_id: string
          tracking_code?: string | null
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          delivery_cost?: number
          external_delivery_id?: string | null
          id?: string
          method?: string
          sale_id?: string
          status?: string
          store_id?: string
          tracking_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          action: string
          created_at: string
          id: string
          idem_key: string
          request_hash: string
          response_json: Json | null
          store_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          idem_key: string
          request_hash: string
          response_json?: Json | null
          store_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          idem_key?: string
          request_hash?: string
          response_json?: Json | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_credit_uses: {
        Row: {
          amount_applied: number
          credit_id: string
          customer_id: string
          id: string
          reverted_at: string | null
          sale_id: string
          store_id: string
          used_at: string
        }
        Insert: {
          amount_applied: number
          credit_id: string
          customer_id: string
          id?: string
          reverted_at?: string | null
          sale_id: string
          store_id: string
          used_at?: string
        }
        Update: {
          amount_applied?: number
          credit_id?: string
          customer_id?: string
          id?: string
          reverted_at?: string | null
          sale_id?: string
          store_id?: string
          used_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_credit_uses_credit_id_fkey"
            columns: ["credit_id"]
            isOneToOne: false
            referencedRelation: "loyalty_credits"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_credits: {
        Row: {
          amount_available: number | null
          amount_generated: number
          amount_used: number
          cancelled_at: string | null
          created_at: string
          customer_id: string
          expires_at: string | null
          generated_at: string
          id: string
          reason: string
          source_sale_id: string | null
          status: string
          store_id: string
        }
        Insert: {
          amount_available?: number | null
          amount_generated?: number
          amount_used?: number
          cancelled_at?: string | null
          created_at?: string
          customer_id: string
          expires_at?: string | null
          generated_at?: string
          id?: string
          reason?: string
          source_sale_id?: string | null
          status?: string
          store_id: string
        }
        Update: {
          amount_available?: number | null
          amount_generated?: number
          amount_used?: number
          cancelled_at?: string | null
          created_at?: string
          customer_id?: string
          expires_at?: string | null
          generated_at?: string
          id?: string
          reason?: string
          source_sale_id?: string | null
          status?: string
          store_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          dedupe_key: string | null
          description: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          link: string | null
          profile_id: string | null
          read_at: string | null
          severity: string
          store_id: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          dedupe_key?: string | null
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          profile_id?: string | null
          read_at?: string | null
          severity?: string
          store_id: string
          title: string
          type: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string | null
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          profile_id?: string | null
          read_at?: string | null
          severity?: string
          store_id?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      payment_verifications: {
        Row: {
          ai_confidence: number | null
          ai_reason: string | null
          created_at: string
          date_is_recent: boolean | null
          date_validation_result: string | null
          email: string
          expected_amount: number
          extracted_amount: number | null
          extracted_date: string | null
          extracted_name: string | null
          extracted_pix_key: string | null
          id: string
          match_result: string | null
          payment_status: string
          plan_id: string
          reviewed_at: string | null
          reviewer_type: string | null
          store_id: string
          updated_at: string
          uploaded_file_url: string | null
          user_id: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_reason?: string | null
          created_at?: string
          date_is_recent?: boolean | null
          date_validation_result?: string | null
          email: string
          expected_amount?: number
          extracted_amount?: number | null
          extracted_date?: string | null
          extracted_name?: string | null
          extracted_pix_key?: string | null
          id?: string
          match_result?: string | null
          payment_status?: string
          plan_id?: string
          reviewed_at?: string | null
          reviewer_type?: string | null
          store_id: string
          updated_at?: string
          uploaded_file_url?: string | null
          user_id: string
        }
        Update: {
          ai_confidence?: number | null
          ai_reason?: string | null
          created_at?: string
          date_is_recent?: boolean | null
          date_validation_result?: string | null
          email?: string
          expected_amount?: number
          extracted_amount?: number | null
          extracted_date?: string | null
          extracted_name?: string | null
          extracted_pix_key?: string | null
          id?: string
          match_result?: string | null
          payment_status?: string
          plan_id?: string
          reviewed_at?: string | null
          reviewer_type?: string | null
          store_id?: string
          updated_at?: string
          uploaded_file_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_verifications_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_by: string | null
          external_tx_id: string | null
          id: string
          idempotency_key: string | null
          method: string
          note: string | null
          paid_at: string
          paid_at_minute: number | null
          provider: string | null
          sale_id: string
          store_id: string
        }
        Insert: {
          amount: number
          created_by?: string | null
          external_tx_id?: string | null
          id?: string
          idempotency_key?: string | null
          method: string
          note?: string | null
          paid_at?: string
          paid_at_minute?: number | null
          provider?: string | null
          sale_id: string
          store_id: string
        }
        Update: {
          amount?: number
          created_by?: string | null
          external_tx_id?: string | null
          id?: string
          idempotency_key?: string | null
          method?: string
          note?: string | null
          paid_at?: string
          paid_at_minute?: number | null
          provider?: string | null
          sale_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pixel_events: {
        Row: {
          customer_id: string | null
          error_message: string | null
          event_type: string
          external_customer_id: string | null
          external_event_id: string | null
          external_order_id: string | null
          id: string
          payload_json: Json
          pixel_id: string
          processed_at: string | null
          processing_status: string
          received_at: string
          return_id: string | null
          sale_id: string | null
          store_id: string
        }
        Insert: {
          customer_id?: string | null
          error_message?: string | null
          event_type: string
          external_customer_id?: string | null
          external_event_id?: string | null
          external_order_id?: string | null
          id?: string
          payload_json?: Json
          pixel_id: string
          processed_at?: string | null
          processing_status?: string
          received_at?: string
          return_id?: string | null
          sale_id?: string | null
          store_id: string
        }
        Update: {
          customer_id?: string | null
          error_message?: string | null
          event_type?: string
          external_customer_id?: string | null
          external_event_id?: string | null
          external_order_id?: string | null
          id?: string
          payload_json?: Json
          pixel_id?: string
          processed_at?: string | null
          processing_status?: string
          received_at?: string
          return_id?: string | null
          sale_id?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pixel_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pixel_events_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pixel_events_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pixel_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          brand: string | null
          category_id: string | null
          cost_price: number
          created_at: string
          id: string
          image_path: string | null
          is_active: boolean
          minimum_stock: number
          model: string | null
          name: string
          on_hand: number
          sale_price: number
          sku: string | null
          store_id: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          brand?: string | null
          category_id?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          image_path?: string | null
          is_active?: boolean
          minimum_stock?: number
          model?: string | null
          name: string
          on_hand?: number
          sale_price?: number
          sku?: string | null
          store_id: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          brand?: string | null
          category_id?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          image_path?: string | null
          is_active?: boolean
          minimum_stock?: number
          model?: string | null
          name?: string
          on_hand?: number
          sale_price?: number
          sku?: string | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auth_user_id: string
          created_at: string
          full_name: string | null
          id: string
          is_active: boolean
          phone: string | null
          role: string
          show_onboarding_guide: boolean
          store_id: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
          role: string
          show_onboarding_guide?: boolean
          store_id: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: string
          show_onboarding_guide?: boolean
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      report_ai_analyses: {
        Row: {
          analysis_text: string
          created_at: string
          created_by: string | null
          id: string
          metadata: Json | null
          period_end: string
          period_start: string
          report_type: string
          store_id: string
        }
        Insert: {
          analysis_text: string
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json | null
          period_end: string
          period_start: string
          report_type?: string
          store_id: string
        }
        Update: {
          analysis_text?: string
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json | null
          period_end?: string
          period_start?: string
          report_type?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_ai_analyses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_ai_analyses_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      return_items: {
        Row: {
          id: string
          product_id: string
          qty: number
          refund_amount: number
          restock: boolean
          return_id: string
          sale_item_id: string | null
        }
        Insert: {
          id?: string
          product_id: string
          qty: number
          refund_amount?: number
          restock?: boolean
          return_id: string
          sale_item_id?: string | null
        }
        Update: {
          id?: string
          product_id?: string
          qty?: number
          refund_amount?: number
          restock?: boolean
          return_id?: string
          sale_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          reason: string
          sale_id: string | null
          status: string
          store_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          reason: string
          sale_id?: string | null
          status: string
          store_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          reason?: string
          sale_id?: string | null
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "returns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_audit_logs: {
        Row: {
          actor_profile_id: string | null
          actor_user_id: string | null
          after_json: Json | null
          before_json: Json | null
          changes: Json
          created_at: string
          id: string
          reason: string
          sale_id: string
          store_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          actor_user_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          changes?: Json
          created_at?: string
          id?: string
          reason: string
          sale_id: string
          store_id: string
        }
        Update: {
          actor_profile_id?: string | null
          actor_user_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          changes?: Json
          created_at?: string
          id?: string
          reason?: string
          sale_id?: string
          store_id?: string
        }
        Relationships: []
      }
      sale_deletion_logs: {
        Row: {
          deleted_at: string
          deleted_by: string | null
          deleted_by_user_id: string | null
          deletion_reason: string
          id: string
          impacts: Json
          original_amount_paid: number
          original_customer_id: string | null
          original_items: Json
          original_payment_method: string | null
          original_payment_status: string | null
          original_payments: Json
          original_sale_data: Json
          original_total: number
          sale_id: string
          store_id: string
        }
        Insert: {
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_user_id?: string | null
          deletion_reason: string
          id?: string
          impacts?: Json
          original_amount_paid?: number
          original_customer_id?: string | null
          original_items?: Json
          original_payment_method?: string | null
          original_payment_status?: string | null
          original_payments?: Json
          original_sale_data: Json
          original_total?: number
          sale_id: string
          store_id: string
        }
        Update: {
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_user_id?: string | null
          deletion_reason?: string
          id?: string
          impacts?: Json
          original_amount_paid?: number
          original_customer_id?: string | null
          original_items?: Json
          original_payment_method?: string | null
          original_payment_status?: string | null
          original_payments?: Json
          original_sale_data?: Json
          original_total?: number
          sale_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_deletion_logs_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_deletion_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          id: string
          line_total: number
          product_category_snapshot: string | null
          product_id: string
          product_name_snapshot: string | null
          product_sku_snapshot: string | null
          qty: number
          sale_id: string
          unit_cost: number
          unit_price: number
        }
        Insert: {
          id?: string
          line_total?: number
          product_category_snapshot?: string | null
          product_id: string
          product_name_snapshot?: string | null
          product_sku_snapshot?: string | null
          qty: number
          sale_id: string
          unit_cost?: number
          unit_price?: number
        }
        Update: {
          id?: string
          line_total?: number
          product_category_snapshot?: string | null
          product_id?: string
          product_name_snapshot?: string | null
          product_sku_snapshot?: string | null
          qty?: number
          sale_id?: string
          unit_cost?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          amount_paid: number
          amount_pending: number
          cost_total: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          discount_total: number
          due_date: string | null
          gross_total: number
          id: string
          net_total: number
          notes: string | null
          payment_status: string
          profit_gross: number
          registered_at: string
          sale_date: string
          shipping_fee: number
          status: string
          store_id: string
        }
        Insert: {
          amount_paid?: number
          amount_pending?: number
          cost_total?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          discount_total?: number
          due_date?: string | null
          gross_total?: number
          id?: string
          net_total?: number
          notes?: string | null
          payment_status?: string
          profit_gross?: number
          registered_at?: string
          sale_date?: string
          shipping_fee?: number
          status: string
          store_id: string
        }
        Update: {
          amount_paid?: number
          amount_pending?: number
          cost_total?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          discount_total?: number
          due_date?: string | null
          gross_total?: number
          id?: string
          net_total?: number
          notes?: string | null
          payment_status?: string
          profit_gross?: number
          registered_at?: string
          sale_date?: string
          shipping_fee?: number
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      service_order_items: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          id: string
          item_type: string
          product_id: string | null
          qty: number
          service_order_id: string
          stock_movement_id: string | null
          store_id: string
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          item_type: string
          product_id?: string | null
          qty?: number
          service_order_id: string
          stock_movement_id?: string | null
          store_id: string
          total?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          item_type?: string
          product_id?: string | null
          qty?: number
          service_order_id?: string
          stock_movement_id?: string | null
          store_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_order_items_service_order_id_fkey"
            columns: ["service_order_id"]
            isOneToOne: false
            referencedRelation: "service_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      service_order_payments: {
        Row: {
          amount: number
          cash_entry_id: string | null
          created_at: string
          created_by: string | null
          id: string
          method: string
          note: string | null
          paid_at: string
          receivable_id: string | null
          service_order_id: string
          store_id: string
        }
        Insert: {
          amount: number
          cash_entry_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          method: string
          note?: string | null
          paid_at?: string
          receivable_id?: string | null
          service_order_id: string
          store_id: string
        }
        Update: {
          amount?: number
          cash_entry_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          note?: string | null
          paid_at?: string
          receivable_id?: string | null
          service_order_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_order_payments_service_order_id_fkey"
            columns: ["service_order_id"]
            isOneToOne: false
            referencedRelation: "service_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      service_order_photos: {
        Row: {
          caption: string | null
          created_at: string
          created_by: string | null
          id: string
          service_order_id: string
          storage_path: string
          store_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          service_order_id: string
          storage_path: string
          store_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          service_order_id?: string
          storage_path?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_order_photos_service_order_id_fkey"
            columns: ["service_order_id"]
            isOneToOne: false
            referencedRelation: "service_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      service_order_status_history: {
        Row: {
          actor_profile_id: string | null
          actor_user_id: string | null
          created_at: string
          from_status: string | null
          id: string
          note: string | null
          service_order_id: string
          store_id: string
          to_status: string
        }
        Insert: {
          actor_profile_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          service_order_id: string
          store_id: string
          to_status: string
        }
        Update: {
          actor_profile_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          note?: string | null
          service_order_id?: string
          store_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_order_status_history_service_order_id_fkey"
            columns: ["service_order_id"]
            isOneToOne: false
            referencedRelation: "service_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      service_orders: {
        Row: {
          accessories: string | null
          brand: string | null
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          delivered_at: string | null
          device: string
          device_condition: string | null
          device_password: string | null
          discount: number
          entry_date: string
          estimated_delivery: string | null
          id: string
          imei_serial: string | null
          internal_notes: string | null
          labor_amount: number
          model: string | null
          os_number: number
          paid_amount: number
          parts_amount: number
          pending_amount: number
          priority: string
          reported_issue: string
          status: string
          store_id: string
          technician_profile_id: string | null
          terms_snapshot: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          accessories?: string | null
          brand?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          delivered_at?: string | null
          device: string
          device_condition?: string | null
          device_password?: string | null
          discount?: number
          entry_date?: string
          estimated_delivery?: string | null
          id?: string
          imei_serial?: string | null
          internal_notes?: string | null
          labor_amount?: number
          model?: string | null
          os_number: number
          paid_amount?: number
          parts_amount?: number
          pending_amount?: number
          priority?: string
          reported_issue: string
          status?: string
          store_id: string
          technician_profile_id?: string | null
          terms_snapshot?: string | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          accessories?: string | null
          brand?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          delivered_at?: string | null
          device?: string
          device_condition?: string | null
          device_password?: string | null
          discount?: number
          entry_date?: string
          estimated_delivery?: string | null
          id?: string
          imei_serial?: string | null
          internal_notes?: string | null
          labor_amount?: number
          model?: string | null
          os_number?: number
          paid_amount?: number
          parts_amount?: number
          pending_amount?: number
          priority?: string
          reported_issue?: string
          status?: string
          store_id?: string
          technician_profile_id?: string | null
          terms_snapshot?: string | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          movement_type: string
          payment_method: string | null
          product_id: string
          qty: number
          reason: string | null
          receipt_path: string | null
          reference_id: string | null
          reference_type: string | null
          store_id: string
          supplier_id: string | null
          total_amount: number | null
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type: string
          payment_method?: string | null
          product_id: string
          qty: number
          reason?: string | null
          receipt_path?: string | null
          reference_id?: string | null
          reference_type?: string | null
          store_id: string
          supplier_id?: string | null
          total_amount?: number | null
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type?: string
          payment_method?: string | null
          product_id?: string
          qty?: number
          reason?: string | null
          receipt_path?: string | null
          reference_id?: string | null
          reference_type?: string | null
          store_id?: string
          supplier_id?: string | null
          total_amount?: number | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      store_pixels: {
        Row: {
          allowed_domains: string[]
          created_at: string
          id: string
          is_active: boolean
          pixel_id: string
          public_key: string
          secret_key: string
          store_id: string
          updated_at: string
        }
        Insert: {
          allowed_domains?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          pixel_id?: string
          public_key?: string
          secret_key?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          allowed_domains?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          pixel_id?: string
          public_key?: string
          secret_key?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_pixels_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_settings: {
        Row: {
          category: string
          id: string
          os_terms_text: string | null
          settings: Json
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          id?: string
          os_terms_text?: string | null
          settings?: Json
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          id?: string
          os_terms_text?: string | null
          settings?: Json
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_settings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          access_enabled: boolean
          address: string | null
          city: string | null
          cnpj: string | null
          created_at: string
          email: string | null
          expires_at: string | null
          id: string
          legal_name: string | null
          logo_path: string | null
          name: string
          notes: string | null
          phone: string | null
          plan: string
          primary_color: string | null
          secondary_color: string | null
          state: string | null
          state_registration: string | null
          subscription_status: string
          trade_name: string | null
          trial_ends_at: string | null
          whatsapp: string | null
          zip_code: string | null
        }
        Insert: {
          access_enabled?: boolean
          address?: string | null
          city?: string | null
          cnpj?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          legal_name?: string | null
          logo_path?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          plan?: string
          primary_color?: string | null
          secondary_color?: string | null
          state?: string | null
          state_registration?: string | null
          subscription_status?: string
          trade_name?: string | null
          trial_ends_at?: string | null
          whatsapp?: string | null
          zip_code?: string | null
        }
        Update: {
          access_enabled?: boolean
          address?: string | null
          city?: string | null
          cnpj?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          legal_name?: string | null
          logo_path?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          plan?: string
          primary_color?: string | null
          secondary_color?: string | null
          state?: string | null
          state_registration?: string | null
          subscription_status?: string
          trade_name?: string | null
          trial_ends_at?: string | null
          whatsapp?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      super_admin_logs: {
        Row: {
          action: string
          admin_user_id: string
          after_json: Json | null
          before_json: Json | null
          created_at: string
          id: string
          notes: string | null
          store_id: string | null
        }
        Insert: {
          action: string
          admin_user_id: string
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          id?: string
          notes?: string | null
          store_id?: string | null
        }
        Update: {
          action?: string
          admin_user_id?: string
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          id?: string
          notes?: string | null
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "super_admin_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          store_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          store_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      system_admins: {
        Row: {
          created_at: string
          email: string
          id: string
          is_active: boolean
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_bulk_product_updates: {
        Args: {
          p_batch_size?: number
          p_excluded_ids?: string[]
          p_filter?: Json
          p_items?: Json
          p_operation_id?: string
          p_patch?: Json
          p_product_ids?: string[]
        }
        Returns: Json
      }
      bootstrap_new_store: {
        Args: {
          p_auth_user_id: string
          p_full_name?: string
          p_store_name?: string
        }
        Returns: string
      }
      can_delete_employee: { Args: { p_profile_id: string }; Returns: boolean }
      check_store_access: { Args: { p_store_id: string }; Returns: boolean }
      count_products_by_filter: {
        Args: {
          p_brand?: string
          p_category_id?: string
          p_filter_key?: string
          p_search?: string
        }
        Returns: number
      }
      create_or_update_product_with_stock: {
        Args: { p_product: Json; p_stock?: Json }
        Returns: Json
      }
      create_return_atomic: {
        Args: {
          p_items: Json
          p_notes?: string
          p_reason: string
          p_sale_id: string
          p_store_id: string
        }
        Returns: string
      }
      create_sale_atomic:
        | {
            Args: {
              p_customer_id: string
              p_delivery: Json
              p_discount?: number
              p_items: Json
              p_payments: Json
              p_store_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_customer_id: string
              p_delivery: Json
              p_discount?: number
              p_due_date?: string
              p_items: Json
              p_payments: Json
              p_store_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_customer_id: string
              p_delivery: Json
              p_discount?: number
              p_due_date?: string
              p_items: Json
              p_notes?: string
              p_payments: Json
              p_sale_date?: string
              p_store_id: string
            }
            Returns: string
          }
      create_service_order: { Args: { p_payload: Json }; Returns: string }
      current_profile: {
        Args: never
        Returns: {
          is_active: boolean
          profile_id: string
          role: string
          store_id: string
        }[]
      }
      customer_360: { Args: { p_customer_id: string }; Returns: Json }
      customer_loyalty_summary: {
        Args: { p_customer_id: string }
        Returns: Json
      }
      dashboard_intelligence: {
        Args: { p_limit?: number }
        Returns: {
          description: string
          entity_id: string
          kind: string
          link: string
          metric: number
          priority: number
          severity: string
          title: string
        }[]
      }
      delete_sale_permanently: {
        Args: { p_reason: string; p_sale_id: string }
        Returns: Json
      }
      edit_sale_atomic: {
        Args: {
          p_allow_negative_stock?: boolean
          p_confirm_revert_payment?: boolean
          p_created_at: string
          p_customer_id: string
          p_discount_total: number
          p_items: Json
          p_notes: string
          p_payment_method: string
          p_payment_status: string
          p_reason: string
          p_sale_id: string
          p_shipping_fee: number
        }
        Returns: Json
      }
      get_employee_performance: {
        Args: { p_end: string; p_start: string }
        Returns: {
          auth_user_id: string
          avg_ticket: number
          full_name: string
          is_active: boolean
          profile_id: string
          returns_count: number
          returns_value: number
          role: string
          sales_count: number
          sales_paid: number
          sales_pending: number
          sales_revenue: number
        }[]
      }
      get_financial_report_summary: {
        Args: {
          p_employee_id?: string
          p_end: string
          p_start: string
          p_store_id: string
        }
        Returns: Json
      }
      get_loyalty_settings: { Args: never; Returns: Json }
      get_loyalty_settings_for_store: {
        Args: { p_store_id: string }
        Returns: Json
      }
      get_my_role: { Args: never; Returns: string }
      get_my_store_id: { Args: never; Returns: string }
      is_super_admin: { Args: never; Returns: boolean }
      list_employees: {
        Args: never
        Returns: {
          auth_user_id: string
          created_at: string
          email: string
          full_name: string
          is_active: boolean
          last_sign_in_at: string
          profile_id: string
          role: string
        }[]
      }
      loyalty_ranking: {
        Args: never
        Returns: {
          credit_amount: number
          credits_available: number
          credits_generated_total: number
          credits_used_total: number
          current_progress: number
          customer_id: string
          customer_name: string
          customer_phone: string
          goal_amount: number
          milestones_reached: number
          remaining_to_next: number
          status: string
          total_eligible: number
        }[]
      }
      loyalty_recalc_preview: { Args: never; Returns: Json }
      obter_relatorio_operacional_v2: {
        Args: {
          p_customer_id?: string
          p_employee_id?: string
          p_end: string
          p_payment_method?: string
          p_start: string
          p_store_id: string
        }
        Returns: Json
      }
      product_analytics: {
        Args: { p_store_id: string }
        Returns: {
          cost_price: number
          daily_avg: number
          days_idle: number
          days_to_empty: number
          last_sale_at: string
          margin_pct: number
          margin_value: number
          minimum_stock: number
          name: string
          on_hand: number
          product_id: string
          qty_sold_30d: number
          sale_price: number
          sku: string
        }[]
      }
      product_history: {
        Args: { p_product_id: string }
        Returns: {
          actor_name: string
          event_type: string
          notes: string
          occurred_at: string
          qty: number
          reference_id: string
          reference_type: string
          total_value: number
          unit_value: number
        }[]
      }
      recalc_loyalty_for_customer: {
        Args: { p_customer_id: string }
        Returns: Json
      }
      recalc_loyalty_for_store: { Args: never; Returns: Json }
      refresh_store_notifications: { Args: never; Returns: Json }
      require_active_profile: { Args: never; Returns: undefined }
      resolve_product_ids_by_filter:
        | {
            Args: {
              p_brand?: string
              p_category_id?: string
              p_filter_key?: string
              p_limit?: number
              p_offset?: number
              p_search?: string
            }
            Returns: {
              id: string
            }[]
          }
        | {
            Args: {
              p_brand?: string
              p_category_id?: string
              p_filter_key?: string
              p_search?: string
              p_status?: string
              p_store_id?: string
            }
            Returns: {
              id: string
            }[]
          }
      resolve_product_ids_by_filter_page: {
        Args: {
          p_after_id?: string
          p_brand?: string
          p_category_id?: string
          p_filter_key?: string
          p_limit?: number
          p_search?: string
          p_status?: string
          p_store_id?: string
        }
        Returns: {
          id: string
        }[]
      }
      revert_loyalty_credit_uses_for_sale: {
        Args: { p_sale_id: string }
        Returns: Json
      }
      set_employee_active: {
        Args: { p_active: boolean; p_profile_id: string }
        Returns: undefined
      }
      settle_payable: {
        Args: {
          p_paid_amount?: number
          p_paid_at?: string
          p_payable_id: string
          p_payment_method?: string
        }
        Returns: Json
      }
      settle_sale_payment:
        | {
            Args: { p_paid_at?: string; p_payments: Json; p_sale_id: string }
            Returns: Json
          }
        | {
            Args: {
              p_note?: string
              p_paid_at?: string
              p_payments: Json
              p_sale_id: string
            }
            Returns: Json
          }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      so_add_part: {
        Args: {
          p_os: string
          p_product: string
          p_qty: number
          p_unit_price: number
        }
        Returns: string
      }
      so_add_service: {
        Args: {
          p_description: string
          p_os: string
          p_qty: number
          p_unit_price: number
        }
        Returns: string
      }
      so_change_status: {
        Args: { p_note: string; p_os: string; p_status: string }
        Returns: undefined
      }
      so_recalc_totals: { Args: { p_id: string }; Returns: undefined }
      so_remove_item: { Args: { p_item: string }; Returns: undefined }
      so_settle_payment: {
        Args: {
          p_amount: number
          p_method: string
          p_note: string
          p_os: string
        }
        Returns: string
      }
      update_employee_role: {
        Args: { p_new_role: string; p_profile_id: string }
        Returns: undefined
      }
      use_loyalty_credit_atomic: {
        Args: { p_amount: number; p_sale_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
