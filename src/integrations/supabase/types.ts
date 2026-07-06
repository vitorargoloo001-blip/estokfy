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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
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
  public: {
    Tables: {
      accounts_payable: {
        Row: {
          amount: number
          cash_entry_id: string | null
          category: string
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          description: string
          due_date: string
          id: string
          notes: string | null
          paid_amount: number | null
          paid_at: string | null
          payment_method: string | null
          recurrence: string | null
          recurrence_config: Json | null
          status: string
          store_id: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          cash_entry_id?: string | null
          category?: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          due_date: string
          id?: string
          notes?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payment_method?: string | null
          recurrence?: string | null
          recurrence_config?: Json | null
          status?: string
          store_id: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          cash_entry_id?: string | null
          category?: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string
          id?: string
          notes?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payment_method?: string | null
          recurrence?: string | null
          recurrence_config?: Json | null
          status?: string
          store_id?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_payable_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "finance_cost_centers"
            referencedColumns: ["id"]
          },
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
      ai_insights: {
        Row: {
          created_at: string | null
          description: string
          id: string
          recommendation: string | null
          resolved_at: string | null
          severity: string
          status: string
          store_id: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string | null
          description: string
          id?: string
          recommendation?: string | null
          resolved_at?: string | null
          severity: string
          status?: string
          store_id: string
          title: string
          type: string
        }
        Update: {
          created_at?: string | null
          description?: string
          id?: string
          recommendation?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          store_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_interactions: {
        Row: {
          answer: string
          created_at: string | null
          data_sources: string[] | null
          id: string
          intent: string | null
          question: string
          store_id: string
          user_id: string
        }
        Insert: {
          answer: string
          created_at?: string | null
          data_sources?: string[] | null
          id?: string
          intent?: string | null
          question: string
          store_id: string
          user_id: string
        }
        Update: {
          answer?: string
          created_at?: string | null
          data_sources?: string[] | null
          id?: string
          intent?: string | null
          question?: string
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_interactions_store_id_fkey"
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
      bank_connections: {
        Row: {
          access_token_encrypted: string | null
          account_holder: string | null
          account_number: string
          account_type: string
          agency: string | null
          bank_code: string | null
          bank_name: string
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          metadata: Json | null
          oauth_expires_at: string | null
          oauth_token_ref: string | null
          pluggy_account_id: string | null
          pluggy_item_id: string | null
          provider: string
          provider_connection_id: string | null
          refresh_token_encrypted: string | null
          status: string
          store_id: string
          sync_status: string | null
          token_expires_at: string | null
          total_transactions: number | null
          updated_at: string
          webhook_id: string | null
          webhook_subscribed: boolean | null
        }
        Insert: {
          access_token_encrypted?: string | null
          account_holder?: string | null
          account_number: string
          account_type: string
          agency?: string | null
          bank_code?: string | null
          bank_name: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          metadata?: Json | null
          oauth_expires_at?: string | null
          oauth_token_ref?: string | null
          pluggy_account_id?: string | null
          pluggy_item_id?: string | null
          provider?: string
          provider_connection_id?: string | null
          refresh_token_encrypted?: string | null
          status?: string
          store_id: string
          sync_status?: string | null
          token_expires_at?: string | null
          total_transactions?: number | null
          updated_at?: string
          webhook_id?: string | null
          webhook_subscribed?: boolean | null
        }
        Update: {
          access_token_encrypted?: string | null
          account_holder?: string | null
          account_number?: string
          account_type?: string
          agency?: string | null
          bank_code?: string | null
          bank_name?: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          metadata?: Json | null
          oauth_expires_at?: string | null
          oauth_token_ref?: string | null
          pluggy_account_id?: string | null
          pluggy_item_id?: string | null
          provider?: string
          provider_connection_id?: string | null
          refresh_token_encrypted?: string | null
          status?: string
          store_id?: string
          sync_status?: string | null
          token_expires_at?: string | null
          total_transactions?: number | null
          updated_at?: string
          webhook_id?: string | null
          webhook_subscribed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_connections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_connections_pluggy_item_id_fkey"
            columns: ["pluggy_item_id"]
            isOneToOne: false
            referencedRelation: "pluggy_connection_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_connections_pluggy_item_id_fkey"
            columns: ["pluggy_item_id"]
            isOneToOne: false
            referencedRelation: "pluggy_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_connections_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_sync_history: {
        Row: {
          bank_connection_id: string
          created_at: string
          error_message: string | null
          id: string
          status: string
          sync_completed_at: string | null
          sync_started_at: string
          transactions_found: number | null
          transactions_imported: number | null
          transactions_skipped: number | null
        }
        Insert: {
          bank_connection_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          status: string
          sync_completed_at?: string | null
          sync_started_at?: string
          transactions_found?: number | null
          transactions_imported?: number | null
          transactions_skipped?: number | null
        }
        Update: {
          bank_connection_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          status?: string
          sync_completed_at?: string | null
          sync_started_at?: string
          transactions_found?: number | null
          transactions_imported?: number | null
          transactions_skipped?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_sync_history_bank_connection_id_fkey"
            columns: ["bank_connection_id"]
            isOneToOne: false
            referencedRelation: "bank_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          amount: number
          bank_code: string | null
          bank_connection_id: string
          bank_name: string
          bank_reference: string | null
          category: string | null
          created_at: string
          description: string | null
          destination_account: string | null
          divergence_reason: string | null
          divergence_type: string | null
          external_id: string | null
          id: string
          method: string | null
          origin_account: string | null
          reconciliation_id: string | null
          sale_id: string | null
          status: string
          store_id: string
          sync_at: string | null
          transaction_date: string
          transaction_time: string | null
          transaction_type: string
          updated_at: string
        }
        Insert: {
          amount: number
          bank_code?: string | null
          bank_connection_id: string
          bank_name: string
          bank_reference?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          destination_account?: string | null
          divergence_reason?: string | null
          divergence_type?: string | null
          external_id?: string | null
          id?: string
          method?: string | null
          origin_account?: string | null
          reconciliation_id?: string | null
          sale_id?: string | null
          status?: string
          store_id: string
          sync_at?: string | null
          transaction_date: string
          transaction_time?: string | null
          transaction_type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_code?: string | null
          bank_connection_id?: string
          bank_name?: string
          bank_reference?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          destination_account?: string | null
          divergence_reason?: string | null
          divergence_type?: string | null
          external_id?: string | null
          id?: string
          method?: string | null
          origin_account?: string | null
          reconciliation_id?: string | null
          sale_id?: string | null
          status?: string
          store_id?: string
          sync_at?: string | null
          transaction_date?: string
          transaction_time?: string | null
          transaction_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_bank_connection_id_fkey"
            columns: ["bank_connection_id"]
            isOneToOne: false
            referencedRelation: "bank_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_store_id_fkey"
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
      connect_ai_insights: {
        Row: {
          created_at: string
          data: Json | null
          description: string
          dismissed_at: string | null
          entity_id: string | null
          entity_type: string | null
          expires_at: string | null
          id: string
          insight_type: string
          is_dismissed: boolean
          severity: string
          store_id: string
          suggestion: string | null
          title: string
        }
        Insert: {
          created_at?: string
          data?: Json | null
          description: string
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          insight_type: string
          is_dismissed?: boolean
          severity?: string
          store_id: string
          suggestion?: string | null
          title: string
        }
        Update: {
          created_at?: string
          data?: Json | null
          description?: string
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          insight_type?: string
          is_dismissed?: boolean
          severity?: string
          store_id?: string
          suggestion?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "connect_ai_insights_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_ai_queries: {
        Row: {
          answer_data: Json | null
          answer_text: string | null
          created_at: string
          id: string
          question_key: string
          question_text: string
          store_id: string
          user_id: string
        }
        Insert: {
          answer_data?: Json | null
          answer_text?: string | null
          created_at?: string
          id?: string
          question_key: string
          question_text: string
          store_id: string
          user_id: string
        }
        Update: {
          answer_data?: Json | null
          answer_text?: string | null
          created_at?: string
          id?: string
          question_key?: string
          question_text?: string
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connect_ai_queries_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_alerts: {
        Row: {
          alert_type: string
          created_at: string
          dismissed_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_read: boolean
          message: string
          severity: string
          store_id: string
          title: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          message: string
          severity?: string
          store_id: string
          title: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          message?: string
          severity?: string
          store_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "connect_alerts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_audit_logs: {
        Row: {
          action: string
          action_type: string
          created_at: string | null
          created_at_date: string | null
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          store_id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action: string
          action_type: string
          created_at?: string | null
          created_at_date?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          store_id: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string
          action_type?: string
          created_at?: string | null
          created_at_date?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          store_id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connect_audit_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_automation_logs: {
        Row: {
          details: Json | null
          id: string
          log_level: string
          logged_at: string
          message: string
          run_id: string
          store_id: string
        }
        Insert: {
          details?: Json | null
          id?: string
          log_level: string
          logged_at?: string
          message: string
          run_id: string
          store_id: string
        }
        Update: {
          details?: Json | null
          id?: string
          log_level?: string
          logged_at?: string
          message?: string
          run_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connect_automation_logs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "connect_automation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_automation_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_automation_runs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          automation_id: string
          completed_at: string | null
          duration_ms: number | null
          error_message: string | null
          id: string
          idempotency_key: string | null
          items_affected: number | null
          requires_approval: boolean | null
          result: Json | null
          started_at: string
          status: string
          store_id: string
          trigger_type: string
          triggered_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          automation_id: string
          completed_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          items_affected?: number | null
          requires_approval?: boolean | null
          result?: Json | null
          started_at?: string
          status: string
          store_id: string
          trigger_type: string
          triggered_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          automation_id?: string
          completed_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          items_affected?: number | null
          requires_approval?: boolean | null
          result?: Json | null
          started_at?: string
          status?: string
          store_id?: string
          trigger_type?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connect_automation_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "connect_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_automation_runs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_automations: {
        Row: {
          channels: string[]
          config: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          last_run_at: string | null
          last_run_status: string | null
          name: string
          next_run_at: string | null
          schedule_config: Json
          store_id: string
          type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          channels?: string[]
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          last_run_status?: string | null
          name: string
          next_run_at?: string | null
          schedule_config?: Json
          store_id: string
          type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          channels?: string[]
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          last_run_status?: string | null
          name?: string
          next_run_at?: string | null
          schedule_config?: Json
          store_id?: string
          type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connect_automations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_licenses: {
        Row: {
          amount_paid: number
          auto_renew: boolean | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          contracted_at: string
          created_at: string | null
          currency: string | null
          expires_at: string | null
          id: string
          notes: string | null
          plan_type: string
          status: string
          store_id: string
          suspended_at: string | null
          suspended_by: string | null
          suspension_reason: string | null
          updated_at: string | null
        }
        Insert: {
          amount_paid: number
          auto_renew?: boolean | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contracted_at?: string
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          plan_type: string
          status?: string
          store_id: string
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          updated_at?: string | null
        }
        Update: {
          amount_paid?: number
          auto_renew?: boolean | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contracted_at?: string
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          plan_type?: string
          status?: string
          store_id?: string
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connect_licenses_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_notification_recipients: {
        Row: {
          automation_id: string
          channel: string
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          store_id: string
          user_id: string | null
        }
        Insert: {
          automation_id: string
          channel: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          store_id: string
          user_id?: string | null
        }
        Update: {
          automation_id?: string
          channel?: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          store_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connect_notification_recipients_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "connect_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_notification_recipients_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_notifications: {
        Row: {
          automation_id: string | null
          body: string
          channel: string
          created_at: string
          id: string
          metadata: Json | null
          read_at: string | null
          run_id: string | null
          sent_at: string | null
          severity: string
          status: string
          store_id: string
          title: string
          type: string
        }
        Insert: {
          automation_id?: string | null
          body: string
          channel: string
          created_at?: string
          id?: string
          metadata?: Json | null
          read_at?: string | null
          run_id?: string | null
          sent_at?: string | null
          severity: string
          status: string
          store_id: string
          title: string
          type: string
        }
        Update: {
          automation_id?: string | null
          body?: string
          channel?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          read_at?: string | null
          run_id?: string | null
          sent_at?: string | null
          severity?: string
          status?: string
          store_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "connect_notifications_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "connect_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_notifications_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "connect_automation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_notifications_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_oauth_tokens: {
        Row: {
          connection_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          issued_at: string
          revoked_at: string | null
          store_id: string
          token_ref: string
          updated_at: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          issued_at?: string
          revoked_at?: string | null
          store_id: string
          token_ref: string
          updated_at?: string
        }
        Update: {
          connection_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          issued_at?: string
          revoked_at?: string | null
          store_id?: string
          token_ref?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connect_oauth_tokens_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_setup_progress: {
        Row: {
          account_selected: boolean | null
          account_selected_at: string | null
          audit_enabled: boolean | null
          audit_enabled_at: string | null
          bank_connected: boolean | null
          bank_connected_at: string | null
          created_at: string
          current_step: number | null
          id: string
          module_activated: boolean | null
          module_activated_at: string | null
          reconciliation_enabled: boolean | null
          reconciliation_enabled_at: string | null
          setup_completed: boolean | null
          setup_completed_at: string | null
          store_id: string
          sync_enabled: boolean | null
          sync_enabled_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_selected?: boolean | null
          account_selected_at?: string | null
          audit_enabled?: boolean | null
          audit_enabled_at?: string | null
          bank_connected?: boolean | null
          bank_connected_at?: string | null
          created_at?: string
          current_step?: number | null
          id?: string
          module_activated?: boolean | null
          module_activated_at?: string | null
          reconciliation_enabled?: boolean | null
          reconciliation_enabled_at?: string | null
          setup_completed?: boolean | null
          setup_completed_at?: string | null
          store_id: string
          sync_enabled?: boolean | null
          sync_enabled_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_selected?: boolean | null
          account_selected_at?: string | null
          audit_enabled?: boolean | null
          audit_enabled_at?: string | null
          bank_connected?: boolean | null
          bank_connected_at?: string | null
          created_at?: string
          current_step?: number | null
          id?: string
          module_activated?: boolean | null
          module_activated_at?: string | null
          reconciliation_enabled?: boolean | null
          reconciliation_enabled_at?: string | null
          setup_completed?: boolean | null
          setup_completed_at?: string | null
          store_id?: string
          sync_enabled?: boolean | null
          sync_enabled_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connect_setup_progress_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_setup_progress_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      connect_system_logs: {
        Row: {
          bank_connection_id: string | null
          created_at: string
          details: Json | null
          id: string
          log_type: string
          message: string
          pluggy_item_id: string | null
          severity: string
          store_id: string
        }
        Insert: {
          bank_connection_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          log_type: string
          message: string
          pluggy_item_id?: string | null
          severity?: string
          store_id: string
        }
        Update: {
          bank_connection_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          log_type?: string
          message?: string
          pluggy_item_id?: string | null
          severity?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connect_system_logs_bank_connection_id_fkey"
            columns: ["bank_connection_id"]
            isOneToOne: false
            referencedRelation: "bank_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_system_logs_pluggy_item_id_fkey"
            columns: ["pluggy_item_id"]
            isOneToOne: false
            referencedRelation: "pluggy_connection_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_system_logs_pluggy_item_id_fkey"
            columns: ["pluggy_item_id"]
            isOneToOne: false
            referencedRelation: "pluggy_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connect_system_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          doc_id: string | null
          email: string | null
          id: string
          name: string
          neighborhood: string | null
          phone: string | null
          state: string | null
          state_registration: string | null
          store_id: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          doc_id?: string | null
          email?: string | null
          id?: string
          name: string
          neighborhood?: string | null
          phone?: string | null
          state?: string | null
          state_registration?: string | null
          store_id: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          doc_id?: string | null
          email?: string | null
          id?: string
          name?: string
          neighborhood?: string | null
          phone?: string | null
          state?: string | null
          state_registration?: string | null
          store_id?: string
          zip_code?: string | null
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
      email_alert_settings: {
        Row: {
          email_to: string | null
          id: string
          is_enabled: boolean
          low_rate_threshold: number
          on_divergent: boolean
          on_duplicate: boolean
          on_low_rate: boolean
          on_pending: boolean
          store_id: string
          updated_at: string
        }
        Insert: {
          email_to?: string | null
          id?: string
          is_enabled?: boolean
          low_rate_threshold?: number
          on_divergent?: boolean
          on_duplicate?: boolean
          on_low_rate?: boolean
          on_pending?: boolean
          store_id: string
          updated_at?: string
        }
        Update: {
          email_to?: string | null
          id?: string
          is_enabled?: boolean
          low_rate_threshold?: number
          on_divergent?: boolean
          on_duplicate?: boolean
          on_low_rate?: boolean
          on_pending?: boolean
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_alert_settings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      exchanges: {
        Row: {
          amount_to_pay: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          credit_amount: number | null
          customer_id: string | null
          difference: number | null
          id: string
          is_avulsa: boolean
          new_product_id: string | null
          new_product_name: string | null
          new_qty: number | null
          new_sale_id: string | null
          new_value: number | null
          notes: string | null
          original_product_id: string | null
          original_product_name: string | null
          original_qty: number | null
          original_value: number | null
          reason: string | null
          return_id: string | null
          settlement: string
          status: string
          store_id: string
          troco_amount: number | null
        }
        Insert: {
          amount_to_pay?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          credit_amount?: number | null
          customer_id?: string | null
          difference?: number | null
          id?: string
          is_avulsa?: boolean
          new_product_id?: string | null
          new_product_name?: string | null
          new_qty?: number | null
          new_sale_id?: string | null
          new_value?: number | null
          notes?: string | null
          original_product_id?: string | null
          original_product_name?: string | null
          original_qty?: number | null
          original_value?: number | null
          reason?: string | null
          return_id?: string | null
          settlement?: string
          status?: string
          store_id: string
          troco_amount?: number | null
        }
        Update: {
          amount_to_pay?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          credit_amount?: number | null
          customer_id?: string | null
          difference?: number | null
          id?: string
          is_avulsa?: boolean
          new_product_id?: string | null
          new_product_name?: string | null
          new_qty?: number | null
          new_sale_id?: string | null
          new_value?: number | null
          notes?: string | null
          original_product_id?: string | null
          original_product_name?: string | null
          original_qty?: number | null
          original_value?: number | null
          reason?: string | null
          return_id?: string | null
          settlement?: string
          status?: string
          store_id?: string
          troco_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exchanges_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_cost_centers: {
        Row: {
          budget_monthly: number | null
          category: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          store_id: string
          updated_at: string
        }
        Insert: {
          budget_monthly?: number | null
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          store_id: string
          updated_at?: string
        }
        Update: {
          budget_monthly?: number | null
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_cost_centers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_goals: {
        Row: {
          created_at: string
          created_by: string | null
          goal_type: string
          id: string
          notes: string | null
          period_month: number
          period_year: number
          store_id: string
          target_value: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          goal_type: string
          id?: string
          notes?: string | null
          period_month: number
          period_year: number
          store_id: string
          target_value: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          goal_type?: string
          id?: string
          notes?: string | null
          period_month?: number
          period_year?: number
          store_id?: string
          target_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_goals_store_id_fkey"
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
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          customer_id: string
          expires_at: string | null
          generated_at: string
          id: string
          origin: string
          reason: string
          source_return_id: string | null
          source_sale_id: string | null
          status: string
          store_id: string
        }
        Insert: {
          amount_available?: number | null
          amount_generated?: number
          amount_used?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          customer_id: string
          expires_at?: string | null
          generated_at?: string
          id?: string
          origin?: string
          reason?: string
          source_return_id?: string | null
          source_sale_id?: string | null
          status?: string
          store_id: string
        }
        Update: {
          amount_available?: number | null
          amount_generated?: number
          amount_used?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          customer_id?: string
          expires_at?: string | null
          generated_at?: string
          id?: string
          origin?: string
          reason?: string
          source_return_id?: string | null
          source_sale_id?: string | null
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_credits_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      master_audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          master_user_id: string
          new_value: Json | null
          old_value: Json | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          master_user_id: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          master_user_id?: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "master_audit_logs_master_user_id_fkey"
            columns: ["master_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      master_clients: {
        Row: {
          city: string | null
          created_at: string
          created_by: string | null
          document: string | null
          email: string
          id: string
          name: string
          notes: string | null
          phone: string | null
          state: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          document?: string | null
          email: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          document?: string | null
          email?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          state?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "master_clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_clients_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      master_contract_modules: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          contract_id: string
          created_at: string
          id: string
          module_key: string
          notes: string | null
          payment_method: string | null
          status: string
          updated_at: string
          value: number | null
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          contract_id: string
          created_at?: string
          id?: string
          module_key: string
          notes?: string | null
          payment_method?: string | null
          status?: string
          updated_at?: string
          value?: number | null
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          contract_id?: string
          created_at?: string
          id?: string
          module_key?: string
          notes?: string | null
          payment_method?: string | null
          status?: string
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "master_contract_modules_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_contract_modules_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "master_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      master_contracts: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          end_date: string | null
          id: string
          installments_count: number | null
          notes: string | null
          plan: string
          start_date: string | null
          status: string
          store_id: string
          updated_at: string
          updated_by: string | null
          value_paid: number
          value_total: number
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          installments_count?: number | null
          notes?: string | null
          plan: string
          start_date?: string | null
          status?: string
          store_id: string
          updated_at?: string
          updated_by?: string | null
          value_paid?: number
          value_total: number
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          installments_count?: number | null
          notes?: string | null
          plan?: string
          start_date?: string | null
          status?: string
          store_id?: string
          updated_at?: string
          updated_by?: string | null
          value_paid?: number
          value_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "master_contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "master_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_contracts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_contracts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      master_installation_status: {
        Row: {
          contract_id: string
          created_at: string
          end_date: string | null
          id: string
          notes: string | null
          progress_percent: number | null
          responsible_email: string | null
          responsible_name: string | null
          start_date: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          contract_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          progress_percent?: number | null
          responsible_email?: string | null
          responsible_name?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          contract_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          progress_percent?: number | null
          responsible_email?: string | null
          responsible_name?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "master_installation_status_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "master_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_installation_status_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      master_payments: {
        Row: {
          amount: number
          contract_id: string
          created_at: string
          created_by: string | null
          due_date: string
          id: string
          notes: string | null
          payment_date: string | null
          payment_method: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          contract_id: string
          created_at?: string
          created_by?: string | null
          due_date: string
          id?: string
          notes?: string | null
          payment_date?: string | null
          payment_method?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          contract_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          id?: string
          notes?: string | null
          payment_date?: string | null
          payment_method?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "master_payments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "master_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_payments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      module_audit_logs: {
        Row: {
          action: string
          admin_user_id: string
          created_at: string
          id: string
          module_key: string
          new_value: Json | null
          old_value: Json | null
          reason: string | null
          store_id: string
          updated_at: string
        }
        Insert: {
          action: string
          admin_user_id: string
          created_at?: string
          id?: string
          module_key: string
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
          store_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          admin_user_id?: string
          created_at?: string
          id?: string
          module_key?: string
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_audit_logs_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_audit_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
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
          return_id: string | null
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
          return_id?: string | null
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
          return_id?: string | null
          sale_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
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
      pluggy_items: {
        Row: {
          accounts_json: Json | null
          bank_connection_id: string | null
          connector_id: number | null
          connector_name: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          institution_name: string | null
          last_synced_at: string | null
          last_updated_at: string | null
          next_update_at: string | null
          pluggy_account_ids: string[] | null
          pluggy_item_id: string
          status: string
          store_id: string
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          accounts_json?: Json | null
          bank_connection_id?: string | null
          connector_id?: number | null
          connector_name?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          institution_name?: string | null
          last_synced_at?: string | null
          last_updated_at?: string | null
          next_update_at?: string | null
          pluggy_account_ids?: string[] | null
          pluggy_item_id: string
          status?: string
          store_id: string
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          accounts_json?: Json | null
          bank_connection_id?: string | null
          connector_id?: number | null
          connector_name?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          institution_name?: string | null
          last_synced_at?: string | null
          last_updated_at?: string | null
          next_update_at?: string | null
          pluggy_account_ids?: string[] | null
          pluggy_item_id?: string
          status?: string
          store_id?: string
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pluggy_items_bank_connection_id_fkey"
            columns: ["bank_connection_id"]
            isOneToOne: false
            referencedRelation: "bank_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pluggy_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pluggy_webhooks: {
        Row: {
          error: string | null
          event_type: string
          id: string
          payload: Json
          pluggy_item_id: string | null
          processed: boolean
          processed_at: string | null
          received_at: string
          store_id: string | null
        }
        Insert: {
          error?: string | null
          event_type: string
          id?: string
          payload?: Json
          pluggy_item_id?: string | null
          processed?: boolean
          processed_at?: string | null
          received_at?: string
          store_id?: string | null
        }
        Update: {
          error?: string | null
          event_type?: string
          id?: string
          payload?: Json
          pluggy_item_id?: string | null
          processed?: boolean
          processed_at?: string | null
          received_at?: string
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pluggy_webhooks_store_id_fkey"
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
      profile_capability_overrides: {
        Row: {
          capability: string
          created_at: string
          id: string
          is_granted: boolean
          profile_id: string
        }
        Insert: {
          capability: string
          created_at?: string
          id?: string
          is_granted?: boolean
          profile_id: string
        }
        Update: {
          capability?: string
          created_at?: string
          id?: string
          is_granted?: boolean
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_capability_overrides_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      provider_webhooks: {
        Row: {
          bank_connection_id: string | null
          created_at: string | null
          event_type: string
          id: string
          payload: Json
          processed: boolean | null
          processed_at: string | null
          processing_error: string | null
          provider: string
          store_id: string
          webhook_id: string | null
          webhook_signature: string | null
        }
        Insert: {
          bank_connection_id?: string | null
          created_at?: string | null
          event_type: string
          id?: string
          payload: Json
          processed?: boolean | null
          processed_at?: string | null
          processing_error?: string | null
          provider: string
          store_id: string
          webhook_id?: string | null
          webhook_signature?: string | null
        }
        Update: {
          bank_connection_id?: string | null
          created_at?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean | null
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          store_id?: string
          webhook_id?: string | null
          webhook_signature?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_webhooks_bank_connection_id_fkey"
            columns: ["bank_connection_id"]
            isOneToOne: false
            referencedRelation: "bank_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_webhooks_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_matches: {
        Row: {
          amount_difference: number | null
          bank_transaction_id: string
          confidence_score: number
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          date_difference_days: number | null
          id: string
          match_reason: string | null
          match_type: string
          notes: string | null
          sale_id: string | null
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          amount_difference?: number | null
          bank_transaction_id: string
          confidence_score: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          date_difference_days?: number | null
          id?: string
          match_reason?: string | null
          match_type: string
          notes?: string | null
          sale_id?: string | null
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          amount_difference?: number | null
          bank_transaction_id?: string
          confidence_score?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          date_difference_days?: number | null
          id?: string
          match_reason?: string | null
          match_type?: string
          notes?: string | null
          sale_id?: string | null
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_matches_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_matches_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_matches_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_matches_store_id_fkey"
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
      return_exchange_versions: {
        Row: {
          action: string
          actor_profile_id: string | null
          actor_user_id: string | null
          created_at: string
          id: string
          impacts: Json
          new_data: Json | null
          old_data: Json | null
          operation_id: string
          operation_type: string
          reason: string
          store_id: string
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          impacts?: Json
          new_data?: Json | null
          old_data?: Json | null
          operation_id: string
          operation_type: string
          reason: string
          store_id: string
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          impacts?: Json
          new_data?: Json | null
          old_data?: Json | null
          operation_id?: string
          operation_type?: string
          reason?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_exchange_versions_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_exchange_versions_store_id_fkey"
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
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
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
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
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
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
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
            foreignKeyName: "returns_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
      role_capabilities: {
        Row: {
          capability: string
          id: string
          is_granted: boolean
          role: string
        }
        Insert: {
          capability: string
          id?: string
          is_granted?: boolean
          role: string
        }
        Update: {
          capability?: string
          id?: string
          is_granted?: boolean
          role?: string
        }
        Relationships: []
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
      service_order_equipment: {
        Row: {
          accessories: string | null
          brand: string | null
          condition: string | null
          created_at: string
          device: string
          id: string
          inventory_number: string | null
          model: string | null
          serial_number: string | null
          service_order_id: string
          sort_order: number
          store_id: string
        }
        Insert: {
          accessories?: string | null
          brand?: string | null
          condition?: string | null
          created_at?: string
          device: string
          id?: string
          inventory_number?: string | null
          model?: string | null
          serial_number?: string | null
          service_order_id: string
          sort_order?: number
          store_id: string
        }
        Update: {
          accessories?: string | null
          brand?: string | null
          condition?: string | null
          created_at?: string
          device?: string
          id?: string
          inventory_number?: string | null
          model?: string | null
          serial_number?: string | null
          service_order_id?: string
          sort_order?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_order_equipment_service_order_id_fkey"
            columns: ["service_order_id"]
            isOneToOne: false
            referencedRelation: "service_orders"
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
          photo_type: string
          service_order_id: string
          storage_path: string
          store_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          photo_type?: string
          service_order_id: string
          storage_path: string
          store_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          photo_type?: string
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
          client_signature_url: string | null
          created_at: string
          created_by: string | null
          customer_address: string | null
          customer_city: string | null
          customer_doc_id: string | null
          customer_id: string | null
          customer_name: string
          customer_neighborhood: string | null
          customer_phone: string | null
          customer_state: string | null
          customer_state_registration: string | null
          customer_zip_code: string | null
          delivered_at: string | null
          device: string
          device_condition: string | null
          device_password: string | null
          discount: number
          entry_date: string
          estimated_delivery: string | null
          executed_services_notes: string | null
          id: string
          imei_serial: string | null
          internal_notes: string | null
          is_pro: boolean
          km_driven: number
          km_rate: number
          labor_amount: number
          model: string | null
          os_number: number
          other_costs: number
          other_costs_desc: string | null
          paid_amount: number
          parts_amount: number
          pending_amount: number
          priority: string
          reported_issue: string
          status: string
          store_id: string
          technician_profile_id: string | null
          technician_signature_url: string | null
          terms_snapshot: string | null
          toll_cost: number
          total_amount: number
          travel_cost: number
          updated_at: string
          warranty_days: number | null
          warranty_description: string | null
        }
        Insert: {
          accessories?: string | null
          brand?: string | null
          cancelled_at?: string | null
          client_signature_url?: string | null
          created_at?: string
          created_by?: string | null
          customer_address?: string | null
          customer_city?: string | null
          customer_doc_id?: string | null
          customer_id?: string | null
          customer_name: string
          customer_neighborhood?: string | null
          customer_phone?: string | null
          customer_state?: string | null
          customer_state_registration?: string | null
          customer_zip_code?: string | null
          delivered_at?: string | null
          device: string
          device_condition?: string | null
          device_password?: string | null
          discount?: number
          entry_date?: string
          estimated_delivery?: string | null
          executed_services_notes?: string | null
          id?: string
          imei_serial?: string | null
          internal_notes?: string | null
          is_pro?: boolean
          km_driven?: number
          km_rate?: number
          labor_amount?: number
          model?: string | null
          os_number: number
          other_costs?: number
          other_costs_desc?: string | null
          paid_amount?: number
          parts_amount?: number
          pending_amount?: number
          priority?: string
          reported_issue: string
          status?: string
          store_id: string
          technician_profile_id?: string | null
          technician_signature_url?: string | null
          terms_snapshot?: string | null
          toll_cost?: number
          total_amount?: number
          travel_cost?: number
          updated_at?: string
          warranty_days?: number | null
          warranty_description?: string | null
        }
        Update: {
          accessories?: string | null
          brand?: string | null
          cancelled_at?: string | null
          client_signature_url?: string | null
          created_at?: string
          created_by?: string | null
          customer_address?: string | null
          customer_city?: string | null
          customer_doc_id?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_neighborhood?: string | null
          customer_phone?: string | null
          customer_state?: string | null
          customer_state_registration?: string | null
          customer_zip_code?: string | null
          delivered_at?: string | null
          device?: string
          device_condition?: string | null
          device_password?: string | null
          discount?: number
          entry_date?: string
          estimated_delivery?: string | null
          executed_services_notes?: string | null
          id?: string
          imei_serial?: string | null
          internal_notes?: string | null
          is_pro?: boolean
          km_driven?: number
          km_rate?: number
          labor_amount?: number
          model?: string | null
          os_number?: number
          other_costs?: number
          other_costs_desc?: string | null
          paid_amount?: number
          parts_amount?: number
          pending_amount?: number
          priority?: string
          reported_issue?: string
          status?: string
          store_id?: string
          technician_profile_id?: string | null
          technician_signature_url?: string | null
          terms_snapshot?: string | null
          toll_cost?: number
          total_amount?: number
          travel_cost?: number
          updated_at?: string
          warranty_days?: number | null
          warranty_description?: string | null
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
      store_group_members: {
        Row: {
          added_at: string
          group_id: string
          store_id: string
        }
        Insert: {
          added_at?: string
          group_id: string
          store_id: string
        }
        Update: {
          added_at?: string
          group_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "store_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_group_members_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      store_modules: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          deactivation_delay_minutes: number | null
          deactivation_requested_at: string | null
          deactivation_scheduled_at: string | null
          id: string
          is_active: boolean
          last_validated_at: string | null
          module_key: string
          store_id: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          deactivation_delay_minutes?: number | null
          deactivation_requested_at?: string | null
          deactivation_scheduled_at?: string | null
          id?: string
          is_active?: boolean
          last_validated_at?: string | null
          module_key: string
          store_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          deactivation_delay_minutes?: number | null
          deactivation_requested_at?: string | null
          deactivation_scheduled_at?: string | null
          id?: string
          is_active?: boolean
          last_validated_at?: string | null
          module_key?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_modules_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_modules_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
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
          business_type: string
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
          business_type?: string
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
          business_type?: string
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
      pluggy_connection_status: {
        Row: {
          account_name: string | null
          bank_name: string | null
          connector_name: string | null
          id: string | null
          institution_name: string | null
          is_active: boolean | null
          last_updated_at: string | null
          next_update_at: string | null
          pluggy_item_id: string | null
          status: string | null
          store_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pluggy_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _ai_query_question_text: { Args: { p_key: string }; Returns: string }
      _has_automation_permission: {
        Args: { p_store_id: string }
        Returns: boolean
      }
      activate_connect_for_store: {
        Args: {
          p_amount: number
          p_expires_at?: string
          p_notes?: string
          p_plan_type: string
          p_starts_at?: string
          p_store_id: string
        }
        Returns: Json
      }
      activate_connect_license: {
        Args: { p_license_id: string }
        Returns: {
          message: string
          new_status: string
          success: boolean
        }[]
      }
      activate_contract_module: {
        Args: { p_contract_id: string; p_module_key: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      add_automation_log: {
        Args: {
          p_details?: Json
          p_level: string
          p_message: string
          p_run_id: string
          p_store_id: string
        }
        Returns: undefined
      }
      add_connect_log: {
        Args: {
          p_bank_connection_id?: string
          p_details?: Json
          p_log_type: string
          p_message: string
          p_pluggy_item_id?: string
          p_severity?: string
          p_store_id: string
        }
        Returns: string
      }
      add_reconciliation_note: {
        Args: { p_match_id: string; p_note: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      ai_get_business_health_score: {
        Args: { p_store_id: string }
        Returns: Json
      }
      ai_get_connect_summary: {
        Args: { p_period_days?: number; p_store_id: string }
        Returns: Json
      }
      ai_get_customer_summary: {
        Args: { p_period_days?: number; p_store_id: string }
        Returns: Json
      }
      ai_get_employee_summary: {
        Args: { p_period_days?: number; p_store_id: string }
        Returns: Json
      }
      ai_get_financial_summary: {
        Args: { p_period_days?: number; p_store_id: string }
        Returns: Json
      }
      ai_get_inventory_summary: { Args: { p_store_id: string }; Returns: Json }
      ai_get_sales_summary: {
        Args: { p_period_days?: number; p_store_id: string }
        Returns: Json
      }
      answer_financial_question: {
        Args: { p_question_key: string; p_store_id: string }
        Returns: Json
      }
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
      approve_automation_run: {
        Args: { p_run_id: string; p_store_id: string }
        Returns: boolean
      }
      bootstrap_new_store: {
        Args: {
          p_auth_user_id: string
          p_full_name?: string
          p_store_name?: string
        }
        Returns: string
      }
      bulk_confirm_reconciliation: {
        Args: { p_match_ids: string[]; p_store_id: string }
        Returns: {
          confirmed_count: number
          failed_ids: string[]
        }[]
      }
      bulk_ignore_reconciliation: {
        Args: { p_match_ids: string[]; p_store_id: string }
        Returns: number
      }
      bulk_reconcile: {
        Args: { p_action: string; p_reconciliation_ids: string[] }
        Returns: {
          message: string
          processed_count: number
          success: boolean
        }[]
      }
      can_delete_employee: { Args: { p_profile_id: string }; Returns: boolean }
      can_manage_sensitive_operations: {
        Args: { p_store_id: string }
        Returns: boolean
      }
      cancel_connect_for_store: {
        Args: { p_reason?: string; p_store_id: string }
        Returns: Json
      }
      cancel_connect_license: {
        Args: { p_license_id: string; p_reason?: string }
        Returns: {
          message: string
          new_status: string
          success: boolean
        }[]
      }
      cancel_customer_credit: {
        Args: { p_cancel_reason: string; p_credit_id: string }
        Returns: Json
      }
      cancel_exchange_atomic: {
        Args: { p_cancel_reason: string; p_exchange_id: string }
        Returns: Json
      }
      cancel_return_atomic: {
        Args: { p_cancel_reason: string; p_return_id: string }
        Returns: Json
      }
      check_connect_enabled: { Args: { p_store_id: string }; Returns: boolean }
      check_store_access: { Args: { p_store_id: string }; Returns: boolean }
      classify_divergence: {
        Args: { p_reason?: string; p_tx_id: string; p_type: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      complete_automation_run: {
        Args: {
          p_duration_ms?: number
          p_error?: string
          p_items?: number
          p_result?: Json
          p_run_id: string
          p_status: string
        }
        Returns: boolean
      }
      confirm_reconciliation: {
        Args: { p_reconciliation_id: string; p_sale_id?: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      connect_clear_demo_data: { Args: { p_store_id: string }; Returns: Json }
      connect_get_dashboard_kpis: {
        Args: { p_store_id: string }
        Returns: Json
      }
      connect_license_history: {
        Args: { p_store_id: string }
        Returns: {
          action: string
          actor: string
          created_at: string
          details: Json
        }[]
      }
      connect_run_matching: { Args: { p_store_id: string }; Returns: Json }
      connect_search_sales_for_match: {
        Args: {
          p_amount?: number
          p_date?: string
          p_limit?: number
          p_query?: string
          p_store_id: string
        }
        Returns: {
          amount_diff: number
          customer_name: string
          id: string
          net_total: number
          payment_status: string
          sale_date: string
          sale_number: string
        }[]
      }
      connect_seed_demo_data: { Args: { p_store_id: string }; Returns: Json }
      connect_seed_scenario_completo: {
        Args: { p_store_id: string }
        Returns: Json
      }
      count_products_by_filter: {
        Args: {
          p_brand?: string
          p_category_id?: string
          p_filter_key?: string
          p_search?: string
        }
        Returns: number
      }
      create_bank_connection: {
        Args: {
          p_account_holder?: string
          p_account_number: string
          p_account_type: string
          p_agency: string
          p_bank_name: string
          p_store_id: string
        }
        Returns: {
          id: string
          message: string
          success: boolean
        }[]
      }
      create_connect_alert: {
        Args: {
          p_alert_type: string
          p_entity_id?: string
          p_entity_type?: string
          p_message: string
          p_severity: string
          p_store_id: string
          p_title: string
        }
        Returns: string
      }
      create_connect_automation: {
        Args: {
          p_channels?: string[]
          p_config?: Json
          p_description?: string
          p_is_active?: boolean
          p_name: string
          p_schedule?: Json
          p_store_id: string
          p_type: string
        }
        Returns: string
      }
      create_connect_notification: {
        Args: {
          p_automation_id?: string
          p_body: string
          p_channel?: string
          p_metadata?: Json
          p_run_id?: string
          p_severity?: string
          p_store_id: string
          p_title: string
          p_type: string
        }
        Returns: string
      }
      create_manual_bank_connection: {
        Args: {
          p_account_number: string
          p_account_type: string
          p_agency?: string
          p_bank_name: string
          p_store_id: string
        }
        Returns: string
      }
      create_master_client: {
        Args: {
          p_city?: string
          p_email: string
          p_name: string
          p_phone?: string
          p_state?: string
        }
        Returns: {
          id: string
          message: string
          success: boolean
        }[]
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
      delete_bank_connection: {
        Args: { p_connection_id: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      delete_connect_automation: {
        Args: { p_id: string; p_store_id: string }
        Returns: boolean
      }
      delete_finance_goal: {
        Args: { p_id: string; p_store_id: string }
        Returns: boolean
      }
      delete_sale_permanently: {
        Args: { p_reason: string; p_sale_id: string }
        Returns: Json
      }
      detect_ai_insights: {
        Args: { p_store_id: string }
        Returns: {
          insights_created: number
          insights_types: string[]
        }[]
      }
      disconnect_pluggy_item: {
        Args: { p_pluggy_item_db_id: string; p_store_id: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      dismiss_ai_insight: {
        Args: { p_insight_id: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      dismiss_all_ai_insights: {
        Args: { p_severity?: string; p_store_id: string }
        Returns: number
      }
      dismiss_all_connect_alerts: {
        Args: { p_store_id: string }
        Returns: number
      }
      dismiss_connect_alert: { Args: { p_alert_id: string }; Returns: boolean }
      edit_customer_credit: {
        Args: {
          p_credit_id: string
          p_edit_reason: string
          p_new_amount_generated: number
          p_new_reason: string
        }
        Returns: Json
      }
      edit_exchange_reason: {
        Args: {
          p_edit_reason: string
          p_exchange_id: string
          p_new_notes: string
          p_new_reason: string
        }
        Returns: Json
      }
      edit_return_atomic: {
        Args: {
          p_customer_id: string
          p_edit_reason: string
          p_items: Json
          p_notes: string
          p_reason: string
          p_refund_mode: string
          p_return_id: string
          p_surplus_mode: string
          p_target_sale_id: string
        }
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
      generate_ai_insights: { Args: { p_store_id: string }; Returns: Json }
      generate_customer_credit: {
        Args: {
          p_amount: number
          p_customer_id: string
          p_origin?: string
          p_reason?: string
          p_source_return_id?: string
          p_source_sale_id?: string
          p_store_id: string
        }
        Returns: string
      }
      get_ai_history: {
        Args: { p_limit?: number; p_store_id: string }
        Returns: {
          answer: string
          created_at: string
          id: string
          intent: string
          question: string
        }[]
      }
      get_ai_insights:
        | {
            Args: {
              p_include_dismissed?: boolean
              p_limit?: number
              p_severity?: string
              p_store_id: string
            }
            Returns: {
              created_at: string
              data: Json
              description: string
              entity_id: string
              entity_type: string
              id: string
              insight_type: string
              is_dismissed: boolean
              severity: string
              suggestion: string
              title: string
            }[]
          }
        | {
            Args: { p_limit?: number; p_status?: string; p_store_id: string }
            Returns: {
              created_at: string
              description: string
              id: string
              recommendation: string
              severity: string
              status: string
              title: string
              type: string
            }[]
          }
      get_ai_query_history: {
        Args: { p_limit?: number; p_store_id: string }
        Returns: {
          answer_data: Json
          answer_text: string
          created_at: string
          id: string
          question_key: string
          question_text: string
        }[]
      }
      get_all_stores_for_admin: {
        Args: never
        Returns: {
          business_name: string
          id: string
          is_active: boolean
          plan: string
        }[]
      }
      get_ar_risk_analysis: {
        Args: { p_limit?: number; p_store_id: string }
        Returns: {
          avg_delay_days: number
          customer_id: string
          customer_name: string
          max_days_late: number
          overdue_amount: number
          payment_rate: number
          risk_level: string
          risk_score: number
          total_pending: number
        }[]
      }
      get_audit_timeline: {
        Args: { p_days?: number; p_store_id: string }
        Returns: {
          date: string
          delete_op: number
          login: number
          reconciliation: number
          reprocess: number
          sync: number
          update_op: number
        }[]
      }
      get_automation_runs: {
        Args: { p_automation_id: string; p_limit?: number; p_store_id: string }
        Returns: {
          approved_at: string
          approved_by: string
          completed_at: string
          duration_ms: number
          error_message: string
          id: string
          items_affected: number
          requires_approval: boolean
          result: Json
          started_at: string
          status: string
          trigger_type: string
          triggered_by: string
        }[]
      }
      get_automations_dashboard: { Args: { p_store_id: string }; Returns: Json }
      get_bank_connection_token: {
        Args: { p_bank_connection_id: string; p_store_id: string }
        Returns: {
          access_token: string
          needs_refresh: boolean
          provider: string
          provider_connection_id: string
          token_expires_at: string
        }[]
      }
      get_bank_connection_with_provider: {
        Args: { p_store_id: string }
        Returns: {
          account_type: string
          bank_name: string
          created_at: string
          id: string
          last_sync_at: string
          last_sync_error: string
          provider: string
          provider_connection_id: string
          status: string
          store_id: string
          sync_status: string
          token_expires_at: string
          webhook_subscribed: boolean
        }[]
      }
      get_bank_connections_with_pluggy: {
        Args: { p_store_id: string }
        Returns: {
          account_number: string
          account_type: string
          agency: string
          bank_code: string
          bank_name: string
          id: string
          institution_name: string
          is_active: boolean
          last_sync_at: string
          last_sync_status: string
          last_synced_at: string
          pluggy_account_id: string
          pluggy_external_item_id: string
          pluggy_item_id: string
          pluggy_status: string
          provider: string
          status: string
          total_transactions: number
        }[]
      }
      get_cashflow_forecast: {
        Args: { p_store_id: string }
        Returns: {
          at_risk_30d: number
          at_risk_7d: number
          at_risk_today: number
          confirmed_30d: number
          confirmed_7d: number
          confirmed_today: number
          daily_forecast: Json
          probable_30d: number
          probable_7d: number
          probable_today: number
        }[]
      }
      get_connect_audit_summary: {
        Args: { p_days?: number; p_store_id: string }
        Returns: {
          action_type: string
          count: number
          last_occurrence: string
        }[]
      }
      get_connect_automations: {
        Args: { p_store_id: string }
        Returns: {
          channels: string[]
          config: Json
          created_by: string
          description: string
          errors_total: number
          id: string
          is_active: boolean
          last_run_at: string
          last_run_status: string
          name: string
          next_run_at: string
          runs_today: number
          runs_total: number
          schedule_config: Json
          type: string
          updated_at: string
        }[]
      }
      get_connect_health_analysis: {
        Args: { p_store_id: string }
        Returns: {
          auto_rate: number
          auto_reconciled_count: number
          avg_sync_gap_hours: number
          banks_connected: number
          banks_synced_24h: number
          divergent_count: number
          health_score: number
          last_sync_at: string
          manual_reconciled_count: number
          open_divergences_7d_plus: number
          pending_match_count: number
          reconciled_count: number
          reconciliation_rate: number
          total_bank_txs: number
        }[]
      }
      get_connect_license: {
        Args: { p_store_id: string }
        Returns: {
          amount_paid: number
          auto_renew: boolean
          cancellation_reason: string
          cancelled_at: string
          cancelled_by: string
          contracted_at: string
          created_at: string
          currency: string
          days_until_expiry: number
          expires_at: string
          id: string
          is_expired: boolean
          owner_email: string
          plan_type: string
          status: string
          store_id: string
          store_name: string
          suspended_at: string
          suspended_by: string
          suspension_reason: string
        }[]
      }
      get_connect_license_stats: {
        Args: never
        Returns: {
          active_count: number
          cancelled_count: number
          expiring_soon: number
          suspended_count: number
          total_licenses: number
          total_revenue: number
        }[]
      }
      get_connect_logs: {
        Args: {
          p_end_date?: string
          p_limit?: number
          p_log_type?: string
          p_offset?: number
          p_severity?: string
          p_start_date?: string
          p_store_id: string
        }
        Returns: {
          bank_connection_id: string
          bank_name: string
          created_at: string
          details: Json
          id: string
          institution_name: string
          log_type: string
          message: string
          pluggy_item_id: string
          severity: string
        }[]
      }
      get_connect_notifications: {
        Args: { p_limit?: number; p_store_id: string; p_unread_only?: boolean }
        Returns: {
          automation_id: string | null
          body: string
          channel: string
          created_at: string
          id: string
          metadata: Json | null
          read_at: string | null
          run_id: string | null
          sent_at: string | null
          severity: string
          status: string
          store_id: string
          title: string
          type: string
        }[]
        SetofOptions: {
          from: "*"
          to: "connect_notifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_connect_panel_stats: {
        Args: never
        Returns: {
          active_count: number
          cancelled_count: number
          recurring_revenue: number
          suspended_count: number
          total_revenue: number
          total_stores: number
        }[]
      }
      get_connect_setup_progress: {
        Args: { p_store_id: string }
        Returns: {
          account_selected: boolean
          audit_enabled: boolean
          bank_connected: boolean
          completion_percent: number
          current_step: number
          id: string
          module_activated: boolean
          reconciliation_enabled: boolean
          setup_completed: boolean
          sync_enabled: boolean
        }[]
      }
      get_connection_health: {
        Args: { p_store_id: string }
        Returns: {
          account_number: string
          account_type: string
          bank_connection_id: string
          bank_name: string
          connection_status: string
          days_since_sync: number
          days_since_webhook: number
          divergent_count: number
          error_code: string
          error_message: string
          has_sync_error: boolean
          has_token_error: boolean
          has_webhook_stale: boolean
          institution_name: string
          last_synced_at: string
          last_webhook_at: string
          last_webhook_event: string
          pending_matches: number
          pluggy_status: string
          total_transactions: number
        }[]
      }
      get_consolidated_finance: { Args: { p_group_id: string }; Returns: Json }
      get_contract_details: {
        Args: { p_contract_id: string }
        Returns: {
          client_email: string
          client_name: string
          contract_id: string
          created_at: string
          modules: Json
          payments: Json
          plan: string
          status: string
          store_name: string
          value_paid: number
          value_total: number
        }[]
      }
      get_cost_centers: {
        Args: { p_store_id: string }
        Returns: {
          budget_monthly: number | null
          category: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          store_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "finance_cost_centers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_customer_ranking: {
        Args: { p_limit?: number; p_store_id: string }
        Returns: {
          customer_id: string
          customer_name: string
          customer_phone: string
          is_debtor: boolean
          last_purchase_date: string
          pending_count: number
          total_amount: number
          total_paid: number
          total_pending: number
          total_sales: number
        }[]
      }
      get_debt_analysis: {
        Args: { p_store_id: string }
        Returns: {
          delinquency_rate: number
          overdue_30d_amount: number
          overdue_30d_count: number
          overdue_60d_amount: number
          overdue_60d_count: number
          overdue_90d_plus_amount: number
          overdue_90d_plus_count: number
          overdue_amount: number
          overdue_count: number
          total_pending_amount: number
          total_pending_sales: number
        }[]
      }
      get_divergence_history: {
        Args: {
          p_end_date?: string
          p_limit?: number
          p_offset?: number
          p_start_date?: string
          p_status?: string
          p_store_id: string
        }
        Returns: {
          amount: number
          bank_name: string
          created_at: string
          description: string
          divergence_reason: string
          divergence_type: string
          id: string
          linked_sale_id: string
          method: string
          resolved_at: string
          resolved_by: string
          status: string
          transaction_date: string
        }[]
      }
      get_divergences_detailed: {
        Args: {
          p_amount_max?: number
          p_amount_min?: number
          p_customer?: string
          p_date_end?: string
          p_date_start?: string
          p_limit?: number
          p_offset?: number
          p_store_id: string
          p_type_filter?: string
        }
        Returns: {
          amount: number
          bank_name: string
          created_at: string
          description: string
          divergence_reason: string
          divergence_type: string
          id: string
          method: string
          status: string
          transaction_date: string
        }[]
      }
      get_dre: {
        Args: { p_month?: number; p_store_id: string; p_year?: number }
        Returns: Json
      }
      get_dre_comparison: {
        Args: { p_month?: number; p_store_id: string; p_year?: number }
        Returns: Json
      }
      get_email_alert_settings: {
        Args: { p_store_id: string }
        Returns: {
          email_to: string
          is_enabled: boolean
          low_rate_threshold: number
          on_divergent: boolean
          on_duplicate: boolean
          on_low_rate: boolean
          on_pending: boolean
        }[]
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
      get_employee_performance_summary: {
        Args: { p_end_date: string; p_start_date: string; p_store_id: string }
        Returns: {
          auth_user_id: string
          avg_ticket: number
          cancels_count: number
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
      get_executive_finance_dashboard: {
        Args: { p_store_id: string }
        Returns: Json
      }
      get_expiring_licenses: {
        Args: { p_days?: number }
        Returns: {
          amount_paid: number
          days_until_expiry: number
          expires_at: string
          id: string
          owner_email: string
          plan_type: string
          store_id: string
          store_name: string
        }[]
      }
      get_finance_goals_progress: {
        Args: { p_month?: number; p_store_id: string; p_year?: number }
        Returns: {
          goal_id: string
          goal_type: string
          notes: string
          on_track: boolean
          progress_pct: number
          realized: number
          target_value: number
        }[]
      }
      get_financial_dashboard_kpis: {
        Args: never
        Returns: {
          active_clients: number
          active_modules: number
          active_stores: number
          ongoing_implementations: number
          overdue_payments: number
          total_pending: number
          total_received: number
          total_revenue: number
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
      get_master_connect_dashboard: {
        Args: never
        Returns: {
          active_connect: boolean
          ai_insights_count: number
          banks_connected: number
          critical_alerts: number
          days_without_sync: number
          divergent_count: number
          last_sync_at: string
          pending_matches: number
          reconciliation_rate: number
          store_id: string
          store_name: string
          total_received: number
          total_transactions: number
        }[]
      }
      get_master_connect_summary: {
        Args: never
        Returns: {
          stores_active_connect: number
          stores_with_banks: number
          stores_without_sync: number
          total_banks_connected: number
          total_divergent: number
          total_received: number
          total_stores: number
          total_transactions: number
        }[]
      }
      get_master_ia_comparison: {
        Args: never
        Returns: {
          active_connect: boolean
          auto_rate: number
          delinquency_rate: number
          divergent_count: number
          health_score: number
          month_revenue: number
          month_sales_count: number
          overdue_amount: number
          prev_month_revenue: number
          reconciliation_rate: number
          revenue_growth_pct: number
          store_id: string
          store_name: string
        }[]
      }
      get_master_ia_ranking: {
        Args: { p_top?: number }
        Returns: {
          category: string
          is_best: boolean
          metric_label: string
          metric_value: number
          rank_position: number
          store_id: string
          store_name: string
        }[]
      }
      get_monthly_comparison: { Args: { p_store_id: string }; Returns: Json }
      get_my_capabilities: { Args: { p_store_id: string }; Returns: Json }
      get_my_role: { Args: never; Returns: string }
      get_my_store_id: { Args: never; Returns: string }
      get_payables_with_alerts: {
        Args: { p_status?: string; p_store_id: string }
        Returns: {
          alert_level: string
          amount: number
          category: string
          cost_center_name: string
          days_until_due: number
          description: string
          due_date: string
          id: string
          recurrence: string
          status: string
          supplier_name: string
        }[]
      }
      get_payment_behavior: {
        Args: { p_days?: number; p_store_id: string }
        Returns: {
          change_pct: number
          current_amount: number
          current_count: number
          current_pct: number
          method: string
          prev_amount: number
          prev_count: number
          prev_pct: number
          trend: string
        }[]
      }
      get_pending_approvals: {
        Args: { p_store_id: string }
        Returns: {
          automation_id: string
          automation_name: string
          automation_type: string
          result: Json
          run_id: string
          started_at: string
          triggered_by: string
        }[]
      }
      get_pending_matches_by_confidence: {
        Args: {
          p_confidence_level?: string
          p_limit?: number
          p_store_id: string
        }
        Returns: {
          amount_difference: number
          bank_name: string
          bank_transaction_id: string
          confidence_level: string
          confidence_score: number
          customer_name: string
          customer_phone: string
          date_difference_days: number
          id: string
          match_reason: string
          match_type: string
          method: string
          sale_amount: number
          sale_date: string
          suggested_sale_id: string
          transaction_amount: number
          transaction_date: string
          transaction_description: string
        }[]
      }
      get_pending_reconciliations: {
        Args: { p_store_id: string }
        Returns: {
          amount_difference: number
          bank_name: string
          bank_transaction_id: string
          confidence_score: number
          customer_name: string
          date_difference_days: number
          id: string
          match_type: string
          sale_amount: number
          sale_date: string
          sale_number: string
          suggested_sale_id: string
          transaction_amount: number
          transaction_date: string
          transaction_description: string
        }[]
      }
      get_pluggy_items_for_sync: {
        Args: { p_store_id: string }
        Returns: {
          accounts_json: Json
          bank_connection_ids: string[]
          id: string
          institution_name: string
          last_synced_at: string
          pluggy_item_id: string
        }[]
      }
      get_professional_cashflow: {
        Args: {
          p_end?: string
          p_period?: string
          p_start?: string
          p_store_id: string
        }
        Returns: {
          confirmed_in: number
          daily_balance: number
          day: string
          projected_in: number
          running_balance: number
          total_out: number
        }[]
      }
      get_reconciliation_by_method:
        | {
            Args: { p_period_days?: number; p_store_id: string }
            Returns: {
              method: string
              reconciled_amount: number
              reconciled_count: number
              total_amount: number
              total_count: number
            }[]
          }
        | {
            Args: {
              p_end_date?: string
              p_start_date?: string
              p_store_id: string
            }
            Returns: {
              divergent_count: number
              method: string
              pending_count: number
              reconciled_amount: number
              reconciled_count: number
              reconciliation_rate: number
              total_amount: number
              total_count: number
            }[]
          }
      get_reconciliation_history: {
        Args: {
          p_end_date?: string
          p_limit?: number
          p_offset?: number
          p_start_date?: string
          p_status?: string
          p_store_id: string
        }
        Returns: {
          amount_difference: number
          bank_name: string
          bank_transaction_id: string
          confidence_score: number
          confirmed_at: string
          confirmed_by_email: string
          customer_name: string
          date_difference_days: number
          id: string
          match_reason: string
          match_status: string
          match_type: string
          method: string
          sale_amount: number
          sale_date: string
          sale_id: string
          transaction_amount: number
          transaction_date: string
          transaction_description: string
          updated_at: string
        }[]
      }
      get_reconciliation_report: {
        Args: { p_end_date: string; p_start_date: string; p_store_id: string }
        Returns: Json
      }
      get_reconciliation_trend: {
        Args: { p_days?: number; p_store_id: string }
        Returns: {
          date: string
          divergent: number
          pending: number
          reconciled: number
        }[]
      }
      get_reconciliation_trend_by_period: {
        Args: { p_period?: string; p_store_id: string }
        Returns: {
          date: string
          divergent: number
          pending: number
          reconciled: number
        }[]
      }
      get_sales_trend: {
        Args: { p_days?: number; p_store_id: string }
        Returns: {
          card_amount: number
          cash_amount: number
          other_amount: number
          paid_count: number
          pending_count: number
          pix_amount: number
          sale_date: string
          total_amount: number
          total_count: number
        }[]
      }
      get_seller_dashboard: { Args: never; Returns: Json }
      get_store_by_owner_email: { Args: { p_email: string }; Returns: string }
      get_store_financial_summary: {
        Args: { p_store_id: string }
        Returns: {
          at_risk_30d: number
          forecast_30d: number
          month_delinquency_rate: number
          month_divergences: number
          month_received: number
          month_reconciliation_rate: number
          month_sales_count: number
          prev_month_received: number
          prev_month_sales_count: number
          received_growth_pct: number
          sales_growth_pct: number
          week_new_customers: number
          week_received: number
          week_sales_count: number
        }[]
      }
      get_store_modules: {
        Args: { p_store_id: string }
        Returns: {
          activated_at: string
          deactivation_requested_at: string
          deactivation_scheduled_at: string
          is_active: boolean
          module_key: string
        }[]
      }
      get_sync_history: {
        Args: { p_connection_id: string; p_limit?: number }
        Returns: {
          duration_minutes: number
          error_message: string
          id: string
          status: string
          sync_completed_at: string
          sync_started_at: string
          transactions_found: number
          transactions_imported: number
          transactions_skipped: number
        }[]
      }
      get_system_log_summary: {
        Args: { p_days?: number; p_store_id: string }
        Returns: {
          count: number
          last_at: string
          log_type: string
          severity: string
        }[]
      }
      get_transaction_summary: {
        Args: { p_store_id: string }
        Returns: {
          divergent_amount: number
          divergent_count: number
          ignored_count: number
          pending_amount: number
          pending_count: number
          reconciled_amount: number
          reconciled_count: number
          total_amount: number
          total_count: number
        }[]
      }
      get_unread_alert_count: { Args: { p_store_id: string }; Returns: number }
      has_module: {
        Args: { p_module_key: string; p_store_id: string }
        Returns: boolean
      }
      ignore_divergence: {
        Args: { p_reason?: string; p_tx_id: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      ignore_reconciliation: {
        Args: { p_reconciliation_id: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      import_bank_statement: {
        Args: {
          p_bank_connection_id: string
          p_store_id: string
          p_transactions: Json
        }
        Returns: Json
      }
      is_master_user: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      list_bank_connections: {
        Args: { p_store_id: string }
        Returns: {
          account_number: string
          account_type: string
          agency: string
          bank_name: string
          created_at: string
          id: string
          is_active: boolean
          last_sync_at: string
          last_sync_status: string
          status: string
          total_transactions: number
        }[]
      }
      list_bank_transactions: {
        Args: {
          p_bank_connection_id?: string
          p_end_date?: string
          p_limit?: number
          p_max_amount?: number
          p_min_amount?: number
          p_start_date?: string
          p_status?: string
          p_store_id: string
        }
        Returns: {
          amount: number
          bank_name: string
          category: string
          created_at: string
          description: string
          destination_account: string
          id: string
          method: string
          origin_account: string
          reconciled_with: string
          status: string
          transaction_date: string
          transaction_time: string
          transaction_type: string
        }[]
      }
      list_connect_alerts: {
        Args: { p_include_dismissed?: boolean; p_store_id: string }
        Returns: {
          alert_type: string
          created_at: string
          dismissed_at: string
          entity_id: string
          entity_type: string
          id: string
          is_read: boolean
          message: string
          severity: string
          title: string
        }[]
      }
      list_connect_audit_logs: {
        Args: {
          p_action_type?: string
          p_end_date?: string
          p_entity_type?: string
          p_limit?: number
          p_offset?: number
          p_start_date?: string
          p_store_id: string
        }
        Returns: {
          action: string
          action_type: string
          created_at: string
          created_at_date: string
          details: Json
          entity_id: string
          entity_type: string
          id: string
          ip_address: string
          user_email: string
          user_id: string
        }[]
      }
      list_connect_licenses: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_plan_type?: string
          p_status?: string
        }
        Returns: {
          amount_paid: number
          auto_renew: boolean
          cancelled_at: string
          contracted_at: string
          created_at: string
          currency: string
          days_until_expiry: number
          expires_at: string
          id: string
          owner_email: string
          plan_type: string
          status: string
          store_id: string
          store_name: string
          suspended_at: string
        }[]
      }
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
      list_master_clients: {
        Args: never
        Returns: {
          active_stores: number
          city: string
          email: string
          id: string
          name: string
          phone: string
          status: string
          total_contracted: number
        }[]
      }
      list_module_audit: {
        Args: { p_limit?: number; p_store_id?: string }
        Returns: {
          action: string
          admin_name: string
          created_at: string
          id: string
          module_key: string
          reason: string
          store_name: string
        }[]
      }
      list_module_audit_log: {
        Args: { p_limit?: number; p_store_id: string }
        Returns: {
          action: string
          admin_email: string
          changed_at: string
          module_key: string
        }[]
      }
      list_stores_with_connect: {
        Args: never
        Returns: {
          amount_paid: number
          connect_active: boolean
          connect_status: string
          contracted_at: string
          expires_at: string
          notes: string
          owner_email: string
          owner_name: string
          plan_type: string
          store_id: string
          store_name: string
          store_plan: string
        }[]
      }
      list_webhook_events: {
        Args: {
          p_bank_connection_id?: string
          p_event_type?: string
          p_limit?: number
          p_offset?: number
          p_processed?: boolean
          p_store_id: string
        }
        Returns: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          processed: boolean
          processed_at: string
          processing_error: string
        }[]
      }
      log_connect_audit: {
        Args: {
          p_action: string
          p_action_type: string
          p_details?: Json
          p_entity_id?: string
          p_entity_type: string
          p_ip_address?: string
          p_store_id: string
          p_user_agent?: string
          p_user_id: string
        }
        Returns: string
      }
      log_user_action: {
        Args: {
          p_action: string
          p_details?: Json
          p_entity: string
          p_entity_id?: string
          p_store_id: string
        }
        Returns: string
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
      mark_connect_alert_read: {
        Args: { p_alert_id: string }
        Returns: boolean
      }
      mark_notification_read: {
        Args: { p_id: string; p_store_id: string }
        Returns: boolean
      }
      mark_pluggy_item_synced: {
        Args: { p_pluggy_item_id: string; p_synced_at?: string }
        Returns: undefined
      }
      mark_webhook_processed: {
        Args: {
          p_error_message?: string
          p_success: boolean
          p_webhook_id: string
        }
        Returns: boolean
      }
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
      process_exchange_atomic: {
        Args: {
          p_customer_id: string
          p_delivery?: Json
          p_is_avulsa?: boolean
          p_new_items: Json
          p_notes?: string
          p_payments?: Json
          p_reason: string
          p_return_items: Json
          p_sale_id: string
          p_store_id: string
          p_surplus_mode?: string
        }
        Returns: Json
      }
      process_return_with_credit: {
        Args: {
          p_customer_id: string
          p_items: Json
          p_notes?: string
          p_reason: string
          p_refund_mode?: string
          p_sale_id: string
          p_store_id: string
          p_surplus_mode?: string
          p_target_sale_id?: string
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
      record_payment: {
        Args: {
          p_payment_date: string
          p_payment_id: string
          p_payment_method: string
        }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      refresh_store_notifications: { Args: never; Returns: Json }
      register_pluggy_item_auth: {
        Args: {
          p_accounts?: Json
          p_connector_id?: number
          p_connector_name?: string
          p_institution_name: string
          p_pluggy_item_id: string
          p_store_id: string
        }
        Returns: {
          bank_connection_ids: string[]
          is_new: boolean
          pluggy_item_db_id: string
        }[]
      }
      register_pluggy_webhook: {
        Args: {
          p_event_type: string
          p_payload: Json
          p_pluggy_item_id: string
        }
        Returns: string
      }
      reopen_reconciliation: {
        Args: { p_reconciliation_id: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      require_active_profile: { Args: never; Returns: undefined }
      resolve_ai_insight: {
        Args: { p_action?: string; p_insight_id: string; p_store_id: string }
        Returns: boolean
      }
      resolve_divergence_link: {
        Args: { p_sale_id: string; p_tx_id: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
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
      revert_return_effects: {
        Args: { p_profile_id: string; p_return_id: string; p_store: string }
        Returns: Json
      }
      save_ai_interaction: {
        Args: {
          p_answer: string
          p_data_sources?: string[]
          p_intent: string
          p_question: string
          p_store_id: string
        }
        Returns: string
      }
      search_sales_for_match_v2: {
        Args: {
          p_amount?: number
          p_date?: string
          p_limit?: number
          p_name?: string
          p_obs?: string
          p_phone?: string
          p_product?: string
          p_store_id: string
        }
        Returns: {
          amount_diff: number
          compatibility_score: number
          customer_name: string
          customer_phone: string
          id: string
          net_total: number
          payment_status: string
          sale_date: string
          sale_number: string
        }[]
      }
      set_employee_active: {
        Args: { p_active: boolean; p_profile_id: string }
        Returns: undefined
      }
      set_extended_customer_profile_flag: {
        Args: { p_enabled: boolean; p_store_id: string }
        Returns: undefined
      }
      set_store_business_type: {
        Args: { p_business_type: string; p_store_id: string }
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
      so_add_equipment: {
        Args: { p_os: string; p_payload: Json }
        Returns: string
      }
      so_add_part: {
        Args: {
          p_os: string
          p_product: string
          p_qty: number
          p_unit_price: number
        }
        Returns: string
      }
      so_add_photo_pro: {
        Args: {
          p_caption: string
          p_os: string
          p_photo_type: string
          p_storage_path: string
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
      so_remove_equipment: { Args: { p_eq_id: string }; Returns: undefined }
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
      so_update_executed_notes: {
        Args: { p_notes: string; p_os: string }
        Returns: undefined
      }
      so_update_extra_costs: {
        Args: {
          p_km: number
          p_km_rate: number
          p_os: string
          p_other: number
          p_other_desc: string
          p_toll: number
          p_travel: number
        }
        Returns: undefined
      }
      so_update_signatures: {
        Args: { p_client_sig: string; p_os: string; p_tech_sig: string }
        Returns: undefined
      }
      so_update_warranty: {
        Args: { p_days: number; p_description: string; p_os: string }
        Returns: undefined
      }
      start_automation_run: {
        Args: {
          p_automation_id: string
          p_idempotency_key?: string
          p_store_id: string
          p_trigger_type?: string
        }
        Returns: string
      }
      store_provider_webhook: {
        Args: {
          p_bank_connection_id: string
          p_event_type: string
          p_payload: Json
          p_provider: string
          p_signature: string
          p_store_id: string
          p_webhook_id: string
        }
        Returns: string
      }
      super_admin_ai_overview: { Args: never; Returns: Json }
      super_admin_set_business_type: {
        Args: { p_business_type: string; p_store_id: string }
        Returns: undefined
      }
      suspend_connect_for_store: {
        Args: { p_reason?: string; p_store_id: string }
        Returns: Json
      }
      suspend_connect_license: {
        Args: { p_license_id: string; p_reason?: string }
        Returns: {
          message: string
          new_status: string
          success: boolean
        }[]
      }
      sync_bank_accounts_from_provider: {
        Args: {
          p_accounts: Json
          p_bank_connection_id: string
          p_store_id: string
        }
        Returns: {
          accounts_synced: number
          message: string
          success: boolean
        }[]
      }
      sync_bank_transactions_from_provider: {
        Args: {
          p_bank_account_id: string
          p_bank_connection_id: string
          p_store_id: string
          p_transactions: Json
        }
        Returns: {
          message: string
          success: boolean
          transactions_synced: number
        }[]
      }
      toggle_connect_automation: {
        Args: { p_id: string; p_store_id: string }
        Returns: Json
      }
      toggle_store_module: {
        Args: {
          p_deactivation_delay_minutes?: number
          p_is_active: boolean
          p_module_key: string
          p_store_id: string
        }
        Returns: {
          deactivation_scheduled_at: string
          message: string
          success: boolean
        }[]
      }
      trigger_ai_automations: { Args: { p_store_id: string }; Returns: Json }
      undo_reconciliation: {
        Args: { p_match_id: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      update_bank_connection_sync: {
        Args: {
          p_bank_connection_id: string
          p_error_message?: string
          p_sync_status: string
        }
        Returns: boolean
      }
      update_bank_connection_sync_status: {
        Args: {
          p_bank_connection_id: string
          p_error_message?: string
          p_status: string
          p_total_transactions?: number
        }
        Returns: undefined
      }
      update_bank_sync: {
        Args: {
          p_connection_id: string
          p_error?: string
          p_found?: number
          p_imported?: number
          p_status: string
        }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      update_connect_automation: {
        Args: {
          p_channels?: string[]
          p_config?: Json
          p_description?: string
          p_id: string
          p_is_active?: boolean
          p_name?: string
          p_schedule?: Json
          p_store_id: string
        }
        Returns: boolean
      }
      update_connect_setup_step: {
        Args: { p_completed: boolean; p_step_name: string; p_store_id: string }
        Returns: {
          completion_percent: number
          message: string
          success: boolean
        }[]
      }
      update_employee_role: {
        Args: { p_new_role: string; p_profile_id: string }
        Returns: undefined
      }
      update_or_insert_bank_connection: {
        Args: {
          p_access_token_encrypted: string
          p_account_type: string
          p_bank_name: string
          p_provider: string
          p_provider_connection_id: string
          p_status: string
          p_store_id: string
          p_sync_status: string
          p_token_expires_at: string
        }
        Returns: string
      }
      update_pluggy_item_status: {
        Args: {
          p_accounts_json?: Json
          p_error_code?: string
          p_error_message?: string
          p_pluggy_item_id: string
          p_status: string
        }
        Returns: undefined
      }
      update_transaction_status: {
        Args: { p_new_status: string; p_transaction_id: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      upsert_bank_transaction_pluggy: {
        Args: {
          p_amount: number
          p_bank_connection_id: string
          p_bank_name: string
          p_description: string
          p_external_id: string
          p_method: string
          p_raw_data?: Json
          p_store_id: string
          p_transaction_date: string
          p_transaction_type: string
        }
        Returns: {
          is_new: boolean
          transaction_id: string
        }[]
      }
      upsert_cost_center: {
        Args: {
          p_active?: boolean
          p_budget?: number
          p_category?: string
          p_id?: string
          p_name?: string
          p_store_id: string
        }
        Returns: string
      }
      upsert_email_alert_settings: {
        Args: {
          p_email_to: string
          p_is_enabled: boolean
          p_low_rate_threshold?: number
          p_on_divergent?: boolean
          p_on_duplicate?: boolean
          p_on_low_rate?: boolean
          p_on_pending?: boolean
          p_store_id: string
        }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      upsert_finance_goal: {
        Args: {
          p_goal_type: string
          p_month: number
          p_notes?: string
          p_store_id: string
          p_target: number
          p_year: number
        }
        Returns: string
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
{"_tag":"Error","error":{"code":"UnknownError","message":"Timeout while shutting down PostHog. Some events may not have been sent."}}
