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
      audit_exam_types: {
        Row: {
          code: string
          created_at: string
          expected_features: string[]
          id: string
          is_active: boolean
          label: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          expected_features?: string[]
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          expected_features?: string[]
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_qa_coverage: {
        Row: {
          id: string
          interactions_count: number
          language: string | null
          run_id: string
          screenshot_hash: string | null
          skin: string | null
          tenant_id: string
          url: string
          visited_at: string
        }
        Insert: {
          id?: string
          interactions_count?: number
          language?: string | null
          run_id: string
          screenshot_hash?: string | null
          skin?: string | null
          tenant_id: string
          url: string
          visited_at?: string
        }
        Update: {
          id?: string
          interactions_count?: number
          language?: string | null
          run_id?: string
          screenshot_hash?: string | null
          skin?: string | null
          tenant_id?: string
          url?: string
          visited_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_qa_coverage_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "audit_qa_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_qa_expected_routes: {
        Row: {
          created_at: string
          id: string
          note: string | null
          path: string
          requires_auth: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          path: string
          requires_auth?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          path?: string
          requires_auth?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_qa_issues: {
        Row: {
          ai_diagnosis: string | null
          ai_suggested_fix: string | null
          category: string
          created_at: string
          dedupe_hash: string
          detected_language: string | null
          dom_context: Json | null
          expected_language: string | null
          id: string
          language: string | null
          occurrence_count: number
          page_title: string | null
          page_url: string
          problematic_text: string | null
          resolved_at: string | null
          run_id: string
          screenshot_annotated_path: string | null
          screenshot_path: string | null
          selector: string | null
          severity: string
          skin: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ai_diagnosis?: string | null
          ai_suggested_fix?: string | null
          category: string
          created_at?: string
          dedupe_hash: string
          detected_language?: string | null
          dom_context?: Json | null
          expected_language?: string | null
          id?: string
          language?: string | null
          occurrence_count?: number
          page_title?: string | null
          page_url: string
          problematic_text?: string | null
          resolved_at?: string | null
          run_id: string
          screenshot_annotated_path?: string | null
          screenshot_path?: string | null
          selector?: string | null
          severity: string
          skin?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ai_diagnosis?: string | null
          ai_suggested_fix?: string | null
          category?: string
          created_at?: string
          dedupe_hash?: string
          detected_language?: string | null
          dom_context?: Json | null
          expected_language?: string | null
          id?: string
          language?: string | null
          occurrence_count?: number
          page_title?: string | null
          page_url?: string
          problematic_text?: string | null
          resolved_at?: string | null
          run_id?: string
          screenshot_annotated_path?: string | null
          screenshot_path?: string | null
          selector?: string | null
          severity?: string
          skin?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_qa_issues_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "audit_qa_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_qa_runs: {
        Row: {
          ai_explanation: Json | null
          base_url: string
          config: Json
          cost_cap_usd: number | null
          created_at: string
          finished_at: string | null
          id: string
          started_at: string
          status: string
          tenant_id: string
          total_cost_usd: number
          total_issues_found: number
          total_pages_visited: number
          updated_at: string
          workflow_id: string | null
        }
        Insert: {
          ai_explanation?: Json | null
          base_url: string
          config?: Json
          cost_cap_usd?: number | null
          created_at?: string
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          tenant_id: string
          total_cost_usd?: number
          total_issues_found?: number
          total_pages_visited?: number
          updated_at?: string
          workflow_id?: string | null
        }
        Update: {
          ai_explanation?: Json | null
          base_url?: string
          config?: Json
          cost_cap_usd?: number | null
          created_at?: string
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          tenant_id?: string
          total_cost_usd?: number
          total_issues_found?: number
          total_pages_visited?: number
          updated_at?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_qa_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_qa_schedules: {
        Row: {
          base_url: string
          cost_cap_usd: number
          created_at: string
          cron_expression: string
          diff_mode: boolean
          enabled: boolean
          id: string
          languages: string[]
          last_run_at: string | null
          last_run_id: string | null
          last_run_status: string | null
          max_pages_per_combo: number
          name: string
          next_run_at: string | null
          preset: string | null
          skins: string[]
          tenant_id: string
          timezone: string
          updated_at: string
          workflow_id: string | null
        }
        Insert: {
          base_url?: string
          cost_cap_usd?: number
          created_at?: string
          cron_expression: string
          diff_mode?: boolean
          enabled?: boolean
          id?: string
          languages: string[]
          last_run_at?: string | null
          last_run_id?: string | null
          last_run_status?: string | null
          max_pages_per_combo?: number
          name: string
          next_run_at?: string | null
          preset?: string | null
          skins: string[]
          tenant_id: string
          timezone?: string
          updated_at?: string
          workflow_id?: string | null
        }
        Update: {
          base_url?: string
          cost_cap_usd?: number
          created_at?: string
          cron_expression?: string
          diff_mode?: boolean
          enabled?: boolean
          id?: string
          languages?: string[]
          last_run_at?: string | null
          last_run_id?: string | null
          last_run_status?: string | null
          max_pages_per_combo?: number
          name?: string
          next_run_at?: string | null
          preset?: string | null
          skins?: string[]
          tenant_id?: string
          timezone?: string
          updated_at?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_qa_schedules_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_scenario_verdicts: {
        Row: {
          created_at: string
          exam_code: string | null
          id: string
          judge: Json
          observer: Json
          passed: boolean | null
          run_id: string | null
          scenario_id: string | null
          score: number | null
          summary: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          exam_code?: string | null
          id?: string
          judge?: Json
          observer?: Json
          passed?: boolean | null
          run_id?: string | null
          scenario_id?: string | null
          score?: number | null
          summary?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          exam_code?: string | null
          id?: string
          judge?: Json
          observer?: Json
          passed?: boolean | null
          run_id?: string | null
          scenario_id?: string | null
          score?: number | null
          summary?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_scenario_verdicts_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "audit_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_scenarios: {
        Row: {
          base_url: string
          created_at: string
          description: string | null
          expectations: Json
          feature_tag: string | null
          id: string
          is_active: boolean
          kind: string
          name: string
          prelude_block_ids: string[]
          record_start_url: string | null
          run_per_exam: boolean
          sort_order: number
          steps: Json
          tenant_id: string
          updated_at: string
          workflow_id: string | null
        }
        Insert: {
          base_url?: string
          created_at?: string
          description?: string | null
          expectations?: Json
          feature_tag?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          prelude_block_ids?: string[]
          record_start_url?: string | null
          run_per_exam?: boolean
          sort_order?: number
          steps?: Json
          tenant_id: string
          updated_at?: string
          workflow_id?: string | null
        }
        Update: {
          base_url?: string
          created_at?: string
          description?: string | null
          expectations?: Json
          feature_tag?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          prelude_block_ids?: string[]
          record_start_url?: string | null
          run_per_exam?: boolean
          sort_order?: number
          steps?: Json
          tenant_id?: string
          updated_at?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_scenarios_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_test_accounts: {
        Row: {
          country: string | null
          created_at: string
          currency: string | null
          email: string
          id: string
          lang: string | null
          last_login_at: string | null
          notes: string | null
          password_ciphertext: string
          password_nonce: string
          registered_at: string | null
          run_id: string | null
          run_index: number | null
          skin: string | null
          status: string
          tenant_id: string
          updated_at: string
          workflow_id: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          currency?: string | null
          email: string
          id?: string
          lang?: string | null
          last_login_at?: string | null
          notes?: string | null
          password_ciphertext: string
          password_nonce: string
          registered_at?: string | null
          run_id?: string | null
          run_index?: number | null
          skin?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          workflow_id?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          currency?: string | null
          email?: string
          id?: string
          lang?: string | null
          last_login_at?: string | null
          notes?: string | null
          password_ciphertext?: string
          password_nonce?: string
          registered_at?: string | null
          run_id?: string | null
          run_index?: number | null
          skin?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          workflow_id?: string | null
        }
        Relationships: []
      }
      audit_workflow_runs: {
        Row: {
          created_at: string
          error: string | null
          external_id: string | null
          finished_at: string | null
          id: string
          logs: Json
          module: Database["public"]["Enums"]["app_module"]
          result: Json | null
          runner: string
          spec_snapshot: Json
          started_at: string | null
          status: string
          synced_to_hub_at: string | null
          tenant_id: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          external_id?: string | null
          finished_at?: string | null
          id?: string
          logs?: Json
          module?: Database["public"]["Enums"]["app_module"]
          result?: Json | null
          runner?: string
          spec_snapshot?: Json
          started_at?: string | null
          status?: string
          synced_to_hub_at?: string | null
          tenant_id?: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          external_id?: string | null
          finished_at?: string | null
          id?: string
          logs?: Json
          module?: Database["public"]["Enums"]["app_module"]
          result?: Json | null
          runner?: string
          spec_snapshot?: Json
          started_at?: string | null
          status?: string
          synced_to_hub_at?: string | null
          tenant_id?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_task_queue: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          jitter_applied_seconds: number
          kylogic_callback_url: string
          kylogic_task_id: string
          language: string | null
          payload: Json
          platform: string | null
          region: string | null
          result: Json | null
          scheduled_local: string | null
          scheduled_utc: string | null
          started_at: string | null
          status: string
          task_type: string
          tenant_id: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          jitter_applied_seconds?: number
          kylogic_callback_url: string
          kylogic_task_id: string
          language?: string | null
          payload?: Json
          platform?: string | null
          region?: string | null
          result?: Json | null
          scheduled_local?: string | null
          scheduled_utc?: string | null
          started_at?: string | null
          status?: string
          task_type: string
          tenant_id: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          jitter_applied_seconds?: number
          kylogic_callback_url?: string
          kylogic_task_id?: string
          language?: string | null
          payload?: Json
          platform?: string | null
          region?: string | null
          result?: Json | null
          scheduled_local?: string | null
          scheduled_utc?: string | null
          started_at?: string | null
          status?: string
          task_type?: string
          tenant_id?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_task_queue_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_workflow_runs: {
        Row: {
          brain_task_id: string | null
          created_at: string
          error: string | null
          external_id: string | null
          finished_at: string | null
          id: string
          logs: Json
          module: Database["public"]["Enums"]["app_module"]
          not_before: string | null
          preflight_result: Json | null
          proxy_id: string | null
          result: Json | null
          runner: string
          spec_snapshot: Json
          started_at: string | null
          status: string
          synced_to_hub_at: string | null
          tenant_id: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          brain_task_id?: string | null
          created_at?: string
          error?: string | null
          external_id?: string | null
          finished_at?: string | null
          id?: string
          logs?: Json
          module?: Database["public"]["Enums"]["app_module"]
          not_before?: string | null
          preflight_result?: Json | null
          proxy_id?: string | null
          result?: Json | null
          runner?: string
          spec_snapshot?: Json
          started_at?: string | null
          status?: string
          synced_to_hub_at?: string | null
          tenant_id?: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          brain_task_id?: string | null
          created_at?: string
          error?: string | null
          external_id?: string | null
          finished_at?: string | null
          id?: string
          logs?: Json
          module?: Database["public"]["Enums"]["app_module"]
          not_before?: string | null
          preflight_result?: Json | null
          proxy_id?: string | null
          result?: Json | null
          runner?: string
          spec_snapshot?: Json
          started_at?: string | null
          status?: string
          synced_to_hub_at?: string | null
          tenant_id?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_workflow_runs_brain_task_id_fkey"
            columns: ["brain_task_id"]
            isOneToOne: false
            referencedRelation: "brain_task_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_workflow_runs_proxy_id_fkey"
            columns: ["proxy_id"]
            isOneToOne: false
            referencedRelation: "proxies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      content_drafts: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          last_run_id: string | null
          media_mime: string | null
          media_name: string | null
          media_path: string | null
          media_size: number | null
          media_slot: string | null
          scheduled_for: string | null
          scheduled_submit: boolean
          status: string
          submitted_at: string | null
          target_ref: string | null
          target_workflow_id: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          last_run_id?: string | null
          media_mime?: string | null
          media_name?: string | null
          media_path?: string | null
          media_size?: number | null
          media_slot?: string | null
          scheduled_for?: string | null
          scheduled_submit?: boolean
          status?: string
          submitted_at?: string | null
          target_ref?: string | null
          target_workflow_id?: string | null
          tenant_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          last_run_id?: string | null
          media_mime?: string | null
          media_name?: string | null
          media_path?: string | null
          media_size?: number | null
          media_slot?: string | null
          scheduled_for?: string | null
          scheduled_submit?: boolean
          status?: string
          submitted_at?: string | null
          target_ref?: string | null
          target_workflow_id?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_drafts_target_workflow_id_fkey"
            columns: ["target_workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      cross_module_tenant_cache: {
        Row: {
          cached_until: string
          created_at: string
          id: string
          module: string
          module_user_id: string
          tenant_id: string
        }
        Insert: {
          cached_until: string
          created_at?: string
          id?: string
          module: string
          module_user_id: string
          tenant_id: string
        }
        Update: {
          cached_until?: string
          created_at?: string
          id?: string
          module?: string
          module_user_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      kit_incoming_task_log: {
        Row: {
          created_at: string
          detail: Json
          event: string
          id: string
          outcome: string
          task_id: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          event: string
          id?: string
          outcome?: string
          task_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          event?: string
          id?: string
          outcome?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kit_incoming_task_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "kit_incoming_tasks"
            referencedColumns: ["task_id"]
          },
        ]
      }
      kit_incoming_tasks: {
        Row: {
          callback_sent_at: string | null
          created_at: string
          error: string | null
          kit_callback_url: string
          kit_user_id: string | null
          payload: Json
          result: Json | null
          status: string
          task_id: string
          task_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          callback_sent_at?: string | null
          created_at?: string
          error?: string | null
          kit_callback_url: string
          kit_user_id?: string | null
          payload?: Json
          result?: Json | null
          status?: string
          task_id: string
          task_type: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          callback_sent_at?: string | null
          created_at?: string
          error?: string | null
          kit_callback_url?: string
          kit_user_id?: string | null
          payload?: Json
          result?: Json | null
          status?: string
          task_id?: string
          task_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      kylogic_incoming_task_log: {
        Row: {
          created_at: string
          detail: Json
          event: string
          id: string
          outcome: string
          task_id: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          event: string
          id?: string
          outcome?: string
          task_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          event?: string
          id?: string
          outcome?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kylogic_incoming_task_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "kylogic_incoming_tasks"
            referencedColumns: ["task_id"]
          },
        ]
      }
      kylogic_incoming_tasks: {
        Row: {
          callback_sent_at: string | null
          created_at: string
          error: string | null
          kylogic_callback_url: string
          kylogic_user_id: string | null
          payload: Json
          result: Json | null
          status: string
          task_id: string
          task_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          callback_sent_at?: string | null
          created_at?: string
          error?: string | null
          kylogic_callback_url: string
          kylogic_user_id?: string | null
          payload?: Json
          result?: Json | null
          status?: string
          task_id: string
          task_type: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          callback_sent_at?: string | null
          created_at?: string
          error?: string | null
          kylogic_callback_url?: string
          kylogic_user_id?: string | null
          payload?: Json
          result?: Json | null
          status?: string
          task_id?: string
          task_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      lead_alerts: {
        Row: {
          approved_at: string | null
          approved_reply_en: string | null
          approved_reply_hu: string | null
          author: string | null
          created_at: string
          excerpt: string | null
          excerpt_hu: string | null
          id: string
          permalink: string
          post_id: string
          reason_hu: string | null
          score: number
          source: string
          status: string
          subreddit: string | null
          suggested_reply_en: string | null
          suggested_reply_hu: string | null
          telegram_message_id: number | null
          tenant_id: string
          title: string | null
          title_hu: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_reply_en?: string | null
          approved_reply_hu?: string | null
          author?: string | null
          created_at?: string
          excerpt?: string | null
          excerpt_hu?: string | null
          id?: string
          permalink: string
          post_id: string
          reason_hu?: string | null
          score?: number
          source?: string
          status?: string
          subreddit?: string | null
          suggested_reply_en?: string | null
          suggested_reply_hu?: string | null
          telegram_message_id?: number | null
          tenant_id: string
          title?: string | null
          title_hu?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_reply_en?: string | null
          approved_reply_hu?: string | null
          author?: string | null
          created_at?: string
          excerpt?: string | null
          excerpt_hu?: string | null
          id?: string
          permalink?: string
          post_id?: string
          reason_hu?: string | null
          score?: number
          source?: string
          status?: string
          subreddit?: string | null
          suggested_reply_en?: string | null
          suggested_reply_hu?: string | null
          telegram_message_id?: number | null
          tenant_id?: string
          title?: string | null
          title_hu?: string | null
        }
        Relationships: []
      }
      linkedin_comments: {
        Row: {
          approved_at: string | null
          approved_reply_en: string | null
          approved_reply_hu: string | null
          author: string | null
          author_headline: string | null
          body_en: string
          body_hu: string | null
          collected_at: string
          context_title: string | null
          created_at: string
          external_id: string
          id: string
          kind: string
          needs_reply: boolean
          permalink: string | null
          posted_at: string | null
          reply_status: string
          source: string
          suggested_reply_en: string | null
          suggested_reply_hu: string | null
          telegram_chat_id: number | null
          telegram_message_id: number | null
          tenant_id: string
          updated_at: string
          workflow_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_reply_en?: string | null
          approved_reply_hu?: string | null
          author?: string | null
          author_headline?: string | null
          body_en?: string
          body_hu?: string | null
          collected_at?: string
          context_title?: string | null
          created_at?: string
          external_id: string
          id?: string
          kind?: string
          needs_reply?: boolean
          permalink?: string | null
          posted_at?: string | null
          reply_status?: string
          source?: string
          suggested_reply_en?: string | null
          suggested_reply_hu?: string | null
          telegram_chat_id?: number | null
          telegram_message_id?: number | null
          tenant_id: string
          updated_at?: string
          workflow_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_reply_en?: string | null
          approved_reply_hu?: string | null
          author?: string | null
          author_headline?: string | null
          body_en?: string
          body_hu?: string | null
          collected_at?: string
          context_title?: string | null
          created_at?: string
          external_id?: string
          id?: string
          kind?: string
          needs_reply?: boolean
          permalink?: string | null
          posted_at?: string | null
          reply_status?: string
          source?: string
          suggested_reply_en?: string | null
          suggested_reply_hu?: string | null
          telegram_chat_id?: number | null
          telegram_message_id?: number | null
          tenant_id?: string
          updated_at?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_comments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_post_metrics: {
        Row: {
          captured_at: string
          comments: number | null
          id: string
          impressions: number | null
          post_url: string | null
          reactions: number | null
          reposts: number | null
          tenant_id: string
          workflow_id: string | null
        }
        Insert: {
          captured_at?: string
          comments?: number | null
          id?: string
          impressions?: number | null
          post_url?: string | null
          reactions?: number | null
          reposts?: number | null
          tenant_id: string
          workflow_id?: string | null
        }
        Update: {
          captured_at?: string
          comments?: number | null
          id?: string
          impressions?: number | null
          post_url?: string | null
          reactions?: number | null
          reposts?: number | null
          tenant_id?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_post_metrics_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          parts: Json
          role: string
          workflow_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          parts?: Json
          role: string
          workflow_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          parts?: Json
          role?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          tenant_id: string | null
          tenant_id_resolved_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          tenant_id?: string | null
          tenant_id_resolved_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          tenant_id?: string | null
          tenant_id_resolved_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      proxies: {
        Row: {
          country: string
          created_at: string
          fingerprint_locale: string | null
          fingerprint_platform: string | null
          fingerprint_seed: string | null
          fingerprint_timezone: string | null
          fingerprint_user_agent: string | null
          fingerprint_viewport_h: number | null
          fingerprint_viewport_w: number | null
          health_avg_latency_ms: number | null
          health_infra_failures: number
          health_last_infra_at: string | null
          health_last_infra_code: string | null
          health_paused_until: string | null
          health_success_count: number
          host: string
          id: string
          is_active: boolean
          kind: string
          label: string
          notes: string
          password_ciphertext: string | null
          password_nonce: string | null
          port: number
          protocol: string
          provider: string
          tenant_id: string
          updated_at: string
          username_ciphertext: string | null
          username_nonce: string | null
          warmup_country_sites: string[] | null
          warmup_language: string | null
          warmup_last_run_at: string | null
          warmup_next_scheduled_at: string | null
          warmup_running_at: string | null
        }
        Insert: {
          country?: string
          created_at?: string
          fingerprint_locale?: string | null
          fingerprint_platform?: string | null
          fingerprint_seed?: string | null
          fingerprint_timezone?: string | null
          fingerprint_user_agent?: string | null
          fingerprint_viewport_h?: number | null
          fingerprint_viewport_w?: number | null
          health_avg_latency_ms?: number | null
          health_infra_failures?: number
          health_last_infra_at?: string | null
          health_last_infra_code?: string | null
          health_paused_until?: string | null
          health_success_count?: number
          host: string
          id?: string
          is_active?: boolean
          kind?: string
          label: string
          notes?: string
          password_ciphertext?: string | null
          password_nonce?: string | null
          port: number
          protocol?: string
          provider?: string
          tenant_id?: string
          updated_at?: string
          username_ciphertext?: string | null
          username_nonce?: string | null
          warmup_country_sites?: string[] | null
          warmup_language?: string | null
          warmup_last_run_at?: string | null
          warmup_next_scheduled_at?: string | null
          warmup_running_at?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          fingerprint_locale?: string | null
          fingerprint_platform?: string | null
          fingerprint_seed?: string | null
          fingerprint_timezone?: string | null
          fingerprint_user_agent?: string | null
          fingerprint_viewport_h?: number | null
          fingerprint_viewport_w?: number | null
          health_avg_latency_ms?: number | null
          health_infra_failures?: number
          health_last_infra_at?: string | null
          health_last_infra_code?: string | null
          health_paused_until?: string | null
          health_success_count?: number
          host?: string
          id?: string
          is_active?: boolean
          kind?: string
          label?: string
          notes?: string
          password_ciphertext?: string | null
          password_nonce?: string | null
          port?: number
          protocol?: string
          provider?: string
          tenant_id?: string
          updated_at?: string
          username_ciphertext?: string | null
          username_nonce?: string | null
          warmup_country_sites?: string[] | null
          warmup_language?: string | null
          warmup_last_run_at?: string | null
          warmup_next_scheduled_at?: string | null
          warmup_running_at?: string | null
        }
        Relationships: []
      }
      recording_sessions: {
        Row: {
          action_log: Json
          created_at: string
          ended_at: string | null
          error: string | null
          id: string
          mode: string
          prelude_scenario_id: string | null
          start_url: string | null
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          worker_id: string | null
          workflow_id: string
        }
        Insert: {
          action_log?: Json
          created_at?: string
          ended_at?: string | null
          error?: string | null
          id?: string
          mode?: string
          prelude_scenario_id?: string | null
          start_url?: string | null
          started_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          worker_id?: string | null
          workflow_id: string
        }
        Update: {
          action_log?: Json
          created_at?: string
          ended_at?: string | null
          error?: string | null
          id?: string
          mode?: string
          prelude_scenario_id?: string | null
          start_url?: string | null
          started_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          worker_id?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recording_sessions_prelude_scenario_id_fkey"
            columns: ["prelude_scenario_id"]
            isOneToOne: false
            referencedRelation: "audit_scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recording_sessions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      reddit_accounts: {
        Row: {
          account_created_at: string | null
          created_at: string
          id: string
          karma: number | null
          language: string | null
          last_checked_at: string | null
          locale: string
          notes: string | null
          proxy_id: string | null
          quarantine_reason: string | null
          quarantined_until: string | null
          ready_at: string | null
          status: string
          subreddits_joined: Json
          target_subreddits: Json
          tenant_id: string
          updated_at: string
          username: string | null
          warmup_days_completed: number
          warmup_started_at: string | null
          warmup_status: string
          workflow_id: string
        }
        Insert: {
          account_created_at?: string | null
          created_at?: string
          id?: string
          karma?: number | null
          language?: string | null
          last_checked_at?: string | null
          locale?: string
          notes?: string | null
          proxy_id?: string | null
          quarantine_reason?: string | null
          quarantined_until?: string | null
          ready_at?: string | null
          status?: string
          subreddits_joined?: Json
          target_subreddits?: Json
          tenant_id: string
          updated_at?: string
          username?: string | null
          warmup_days_completed?: number
          warmup_started_at?: string | null
          warmup_status?: string
          workflow_id: string
        }
        Update: {
          account_created_at?: string | null
          created_at?: string
          id?: string
          karma?: number | null
          language?: string | null
          last_checked_at?: string | null
          locale?: string
          notes?: string | null
          proxy_id?: string | null
          quarantine_reason?: string | null
          quarantined_until?: string | null
          ready_at?: string | null
          status?: string
          subreddits_joined?: Json
          target_subreddits?: Json
          tenant_id?: string
          updated_at?: string
          username?: string | null
          warmup_days_completed?: number
          warmup_started_at?: string | null
          warmup_status?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reddit_accounts_proxy_id_fkey"
            columns: ["proxy_id"]
            isOneToOne: false
            referencedRelation: "proxies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reddit_accounts_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      reddit_comments: {
        Row: {
          account_id: string | null
          answered_at: string | null
          approved_at: string | null
          approved_reply_en: string | null
          author: string | null
          body_en: string
          body_hu: string | null
          collected_at: string
          context_title: string | null
          created_at: string
          external_id: string
          id: string
          permalink: string
          posted_at: string | null
          reply_status: string
          source: string
          subreddit: string | null
          suggested_reply_en: string | null
          suggested_reply_hu: string | null
          telegram_chat_id: number | null
          telegram_message_id: number | null
          tenant_id: string
          updated_at: string
          watch_id: string | null
          workflow_id: string
        }
        Insert: {
          account_id?: string | null
          answered_at?: string | null
          approved_at?: string | null
          approved_reply_en?: string | null
          author?: string | null
          body_en: string
          body_hu?: string | null
          collected_at?: string
          context_title?: string | null
          created_at?: string
          external_id: string
          id?: string
          permalink: string
          posted_at?: string | null
          reply_status?: string
          source?: string
          subreddit?: string | null
          suggested_reply_en?: string | null
          suggested_reply_hu?: string | null
          telegram_chat_id?: number | null
          telegram_message_id?: number | null
          tenant_id: string
          updated_at?: string
          watch_id?: string | null
          workflow_id: string
        }
        Update: {
          account_id?: string | null
          answered_at?: string | null
          approved_at?: string | null
          approved_reply_en?: string | null
          author?: string | null
          body_en?: string
          body_hu?: string | null
          collected_at?: string
          context_title?: string | null
          created_at?: string
          external_id?: string
          id?: string
          permalink?: string
          posted_at?: string | null
          reply_status?: string
          source?: string
          subreddit?: string | null
          suggested_reply_en?: string | null
          suggested_reply_hu?: string | null
          telegram_chat_id?: number | null
          telegram_message_id?: number | null
          tenant_id?: string
          updated_at?: string
          watch_id?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reddit_comments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "reddit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reddit_comments_watch_id_fkey"
            columns: ["watch_id"]
            isOneToOne: false
            referencedRelation: "reddit_post_watches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reddit_comments_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      reddit_discourse_snapshots: {
        Row: {
          comments_analyzed: number
          created_at: string
          id: string
          language_label: string
          posts_analyzed: number
          snapshot_date: string
          subreddit: string
          summary_hu: string
          tenant_id: string
          themes: Json
          tone_hu: string
          workflow_id: string | null
        }
        Insert: {
          comments_analyzed?: number
          created_at?: string
          id?: string
          language_label?: string
          posts_analyzed?: number
          snapshot_date?: string
          subreddit: string
          summary_hu?: string
          tenant_id: string
          themes?: Json
          tone_hu?: string
          workflow_id?: string | null
        }
        Update: {
          comments_analyzed?: number
          created_at?: string
          id?: string
          language_label?: string
          posts_analyzed?: number
          snapshot_date?: string
          subreddit?: string
          summary_hu?: string
          tenant_id?: string
          themes?: Json
          tone_hu?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reddit_discourse_snapshots_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      reddit_discourse_suggestions: {
        Row: {
          based_on_days: number
          best_time_hu: string
          confidence: number
          created_at: string
          draft_hu: string
          entry_type: string
          headline_hu: string
          id: string
          language_label: string
          rationale_hu: string
          status: string
          subreddit: string
          target_permalink: string | null
          tenant_id: string
          workflow_id: string | null
        }
        Insert: {
          based_on_days?: number
          best_time_hu?: string
          confidence?: number
          created_at?: string
          draft_hu?: string
          entry_type?: string
          headline_hu?: string
          id?: string
          language_label?: string
          rationale_hu?: string
          status?: string
          subreddit: string
          target_permalink?: string | null
          tenant_id: string
          workflow_id?: string | null
        }
        Update: {
          based_on_days?: number
          best_time_hu?: string
          confidence?: number
          created_at?: string
          draft_hu?: string
          entry_type?: string
          headline_hu?: string
          id?: string
          language_label?: string
          rationale_hu?: string
          status?: string
          subreddit?: string
          target_permalink?: string | null
          tenant_id?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reddit_discourse_suggestions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      reddit_post_watches: {
        Row: {
          account_id: string | null
          active: boolean
          created_at: string
          id: string
          language: string
          last_scanned_at: string | null
          permalink: string
          post_external_id: string | null
          subreddit: string | null
          tenant_id: string
          title: string | null
          updated_at: string
          workflow_id: string | null
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          created_at?: string
          id?: string
          language?: string
          last_scanned_at?: string | null
          permalink: string
          post_external_id?: string | null
          subreddit?: string | null
          tenant_id: string
          title?: string | null
          updated_at?: string
          workflow_id?: string | null
        }
        Update: {
          account_id?: string | null
          active?: boolean
          created_at?: string
          id?: string
          language?: string
          last_scanned_at?: string | null
          permalink?: string
          post_external_id?: string | null
          subreddit?: string | null
          tenant_id?: string
          title?: string | null
          updated_at?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reddit_post_watches_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "reddit_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reddit_post_watches_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      reddit_readonly_findings: {
        Row: {
          angle_hu: string | null
          author: string | null
          body_excerpt: string | null
          collected_at: string
          id: string
          permalink: string
          post_created_at: string | null
          post_id: string
          relevance: number
          status: string
          subreddit: string
          suggested_reply_hu: string | null
          tenant_id: string
          title: string | null
          watch_id: string | null
          workflow_id: string
        }
        Insert: {
          angle_hu?: string | null
          author?: string | null
          body_excerpt?: string | null
          collected_at?: string
          id?: string
          permalink: string
          post_created_at?: string | null
          post_id: string
          relevance?: number
          status?: string
          subreddit: string
          suggested_reply_hu?: string | null
          tenant_id: string
          title?: string | null
          watch_id?: string | null
          workflow_id: string
        }
        Update: {
          angle_hu?: string | null
          author?: string | null
          body_excerpt?: string | null
          collected_at?: string
          id?: string
          permalink?: string
          post_created_at?: string | null
          post_id?: string
          relevance?: number
          status?: string
          subreddit?: string
          suggested_reply_hu?: string | null
          tenant_id?: string
          title?: string | null
          watch_id?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reddit_readonly_findings_watch_id_fkey"
            columns: ["watch_id"]
            isOneToOne: false
            referencedRelation: "reddit_readonly_watches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reddit_readonly_findings_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      reddit_readonly_watches: {
        Row: {
          created_at: string
          id: string
          language_label: string
          last_scanned_at: string | null
          positioning: string
          subreddits: string[]
          tenant_id: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          language_label?: string
          last_scanned_at?: string | null
          positioning?: string
          subreddits?: string[]
          tenant_id: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          created_at?: string
          id?: string
          language_label?: string
          last_scanned_at?: string | null
          positioning?: string
          subreddits?: string[]
          tenant_id?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reddit_readonly_watches_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: true
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      reddit_story_bank: {
        Row: {
          body: string
          created_at: string
          id: string
          language: string
          last_used_at: string | null
          notes: string | null
          tenant_id: string
          title: string
          updated_at: string
          used_count: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          language: string
          last_used_at?: string | null
          notes?: string | null
          tenant_id: string
          title: string
          updated_at?: string
          used_count?: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          language?: string
          last_used_at?: string | null
          notes?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          used_count?: number
        }
        Relationships: []
      }
      reddit_warmup_log: {
        Row: {
          account_id: string
          activity_date: string
          comments: number
          created_at: string
          id: string
          joined_subreddits: Json
          notes: string | null
          scroll_minutes: number
          tenant_id: string
          updated_at: string
          upvotes: number
        }
        Insert: {
          account_id: string
          activity_date?: string
          comments?: number
          created_at?: string
          id?: string
          joined_subreddits?: Json
          notes?: string | null
          scroll_minutes?: number
          tenant_id: string
          updated_at?: string
          upvotes?: number
        }
        Update: {
          account_id?: string
          activity_date?: string
          comments?: number
          created_at?: string
          id?: string
          joined_subreddits?: Json
          notes?: string | null
          scroll_minutes?: number
          tenant_id?: string
          updated_at?: string
          upvotes?: number
        }
        Relationships: [
          {
            foreignKeyName: "reddit_warmup_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "reddit_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_outbox: {
        Row: {
          chat_id: number | null
          created_at: string
          id: string
          label: string | null
          message_id: number
          payload: Json
          platform: string | null
          ref_id: string | null
          ref_table: string | null
          replied_at: string | null
          reply_text: string | null
          topic: string
        }
        Insert: {
          chat_id?: number | null
          created_at?: string
          id?: string
          label?: string | null
          message_id: number
          payload?: Json
          platform?: string | null
          ref_id?: string | null
          ref_table?: string | null
          replied_at?: string | null
          reply_text?: string | null
          topic?: string
        }
        Update: {
          chat_id?: number | null
          created_at?: string
          id?: string
          label?: string | null
          message_id?: number
          payload?: Json
          platform?: string | null
          ref_id?: string | null
          ref_table?: string | null
          replied_at?: string | null
          reply_text?: string | null
          topic?: string
        }
        Relationships: []
      }
      tenant_module_access: {
        Row: {
          created_at: string
          granted_at: string
          granted_by: string | null
          id: string
          module: Database["public"]["Enums"]["app_module"]
          revoked_at: string | null
          revoked_by: string | null
          source: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          module: Database["public"]["Enums"]["app_module"]
          revoked_at?: string | null
          revoked_by?: string | null
          source?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          module?: Database["public"]["Enums"]["app_module"]
          revoked_at?: string | null
          revoked_by?: string | null
          source?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ui_recon_snapshots: {
        Row: {
          analysis: Json
          change_note: string | null
          changed: boolean
          created_at: string
          dom_digest: Json
          id: string
          learned_fields: Json
          page_type: string
          platform: string
          run_id: string | null
          screenshot_path: string | null
          tenant_id: string
          url: string
          workflow_id: string | null
        }
        Insert: {
          analysis?: Json
          change_note?: string | null
          changed?: boolean
          created_at?: string
          dom_digest?: Json
          id?: string
          learned_fields?: Json
          page_type: string
          platform: string
          run_id?: string | null
          screenshot_path?: string | null
          tenant_id: string
          url?: string
          workflow_id?: string | null
        }
        Update: {
          analysis?: Json
          change_note?: string | null
          changed?: boolean
          created_at?: string
          dom_digest?: Json
          id?: string
          learned_fields?: Json
          page_type?: string
          platform?: string
          run_id?: string | null
          screenshot_path?: string | null
          tenant_id?: string
          url?: string
          workflow_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vault_agent_events: {
        Row: {
          agent_id: string | null
          created_at: string
          detail: Json
          event: string
          id: string
          ip: string | null
          tenant_id: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          detail?: Json
          event: string
          id?: string
          ip?: string | null
          tenant_id?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          detail?: Json
          event?: string
          id?: string
          ip?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      vault_agent_files: {
        Row: {
          agent_id: string
          folder_id: string
          hash: string | null
          id: string
          mtime: number | null
          rel: string
          size: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          folder_id: string
          hash?: string | null
          id?: string
          mtime?: number | null
          rel: string
          size?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          folder_id?: string
          hash?: string | null
          id?: string
          mtime?: number | null
          rel?: string
          size?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_agent_files_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "vault_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_agent_files_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "vault_agent_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_agent_folders: {
        Row: {
          agent_id: string
          created_at: string
          file_count: number
          id: string
          label: string | null
          last_error: string | null
          last_synced_at: string | null
          path: string
          size_bytes: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          file_count?: number
          id?: string
          label?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          path: string
          size_bytes?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          file_count?: number
          id?: string
          label?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          path?: string
          size_bytes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_agent_folders_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "vault_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_agents: {
        Row: {
          created_at: string
          hostname: string | null
          id: string
          last_seen_at: string | null
          platform: string | null
          revoked_at: string | null
          tenant_id: string
          token_hash: string
          updated_at: string
          version: string | null
        }
        Insert: {
          created_at?: string
          hostname?: string | null
          id?: string
          last_seen_at?: string | null
          platform?: string | null
          revoked_at?: string | null
          tenant_id: string
          token_hash: string
          updated_at?: string
          version?: string | null
        }
        Update: {
          created_at?: string
          hostname?: string | null
          id?: string
          last_seen_at?: string | null
          platform?: string | null
          revoked_at?: string | null
          tenant_id?: string
          token_hash?: string
          updated_at?: string
          version?: string | null
        }
        Relationships: []
      }
      vault_folders: {
        Row: {
          created_at: string
          enabled: boolean
          file_count: number | null
          id: string
          label: string | null
          last_error: string | null
          last_synced_at: string | null
          path: string
          seen_at: string
          size_bytes: number | null
          source: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          file_count?: number | null
          id?: string
          label?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          path: string
          seen_at?: string
          size_bytes?: number | null
          source?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          file_count?: number | null
          id?: string
          label?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          path?: string
          seen_at?: string
          size_bytes?: number | null
          source?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      vault_pair_codes: {
        Row: {
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          tenant_id: string
          used_at: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          tenant_id: string
          used_at?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          tenant_id?: string
          used_at?: string | null
        }
        Relationships: []
      }
      vault_share_access: {
        Row: {
          id: string
          ip: string | null
          outcome: string
          share_id: string | null
          token_attempted: string | null
          ts: string
          user_agent: string | null
        }
        Insert: {
          id?: string
          ip?: string | null
          outcome: string
          share_id?: string | null
          token_attempted?: string | null
          ts?: string
          user_agent?: string | null
        }
        Update: {
          id?: string
          ip?: string | null
          outcome?: string
          share_id?: string | null
          token_attempted?: string | null
          ts?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_share_access_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "vault_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_shares: {
        Row: {
          allow_download: boolean
          created_at: string
          download_count: number
          expires_at: string
          id: string
          label: string | null
          last_access_at: string | null
          max_downloads: number | null
          password_hash: string | null
          path: string
          revoked_at: string | null
          tenant_id: string
          token: string
          updated_at: string
        }
        Insert: {
          allow_download?: boolean
          created_at?: string
          download_count?: number
          expires_at: string
          id?: string
          label?: string | null
          last_access_at?: string | null
          max_downloads?: number | null
          password_hash?: string | null
          path: string
          revoked_at?: string | null
          tenant_id: string
          token: string
          updated_at?: string
        }
        Update: {
          allow_download?: boolean
          created_at?: string
          download_count?: number
          expires_at?: string
          id?: string
          label?: string | null
          last_access_at?: string | null
          max_downloads?: number | null
          password_hash?: string | null
          path?: string
          revoked_at?: string | null
          tenant_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      vault_status: {
        Row: {
          agent_version: string | null
          created_at: string
          disk_free_bytes: number | null
          disk_total_bytes: number | null
          disk_used_bytes: number | null
          host: string | null
          last_error: string | null
          last_mirror_at: string | null
          luks_unlocked: boolean | null
          mirror_ok: boolean | null
          mirror_used_bytes: number | null
          mount_ok: boolean | null
          reported_at: string
          snapshots: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          agent_version?: string | null
          created_at?: string
          disk_free_bytes?: number | null
          disk_total_bytes?: number | null
          disk_used_bytes?: number | null
          host?: string | null
          last_error?: string | null
          last_mirror_at?: string | null
          luks_unlocked?: boolean | null
          mirror_ok?: boolean | null
          mirror_used_bytes?: number | null
          mount_ok?: boolean | null
          reported_at?: string
          snapshots?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          agent_version?: string | null
          created_at?: string
          disk_free_bytes?: number | null
          disk_total_bytes?: number | null
          disk_used_bytes?: number | null
          host?: string | null
          last_error?: string | null
          last_mirror_at?: string | null
          luks_unlocked?: boolean | null
          mirror_ok?: boolean | null
          mirror_used_bytes?: number | null
          mount_ok?: boolean | null
          reported_at?: string
          snapshots?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      worker_deploy_requests: {
        Row: {
          active_color: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          log: string | null
          note: string | null
          requested_by: string | null
          started_at: string | null
          status: string
          worker_id: string | null
        }
        Insert: {
          active_color?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          log?: string | null
          note?: string | null
          requested_by?: string | null
          started_at?: string | null
          status?: string
          worker_id?: string | null
        }
        Update: {
          active_color?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          log?: string | null
          note?: string | null
          requested_by?: string | null
          started_at?: string | null
          status?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      worker_heartbeats: {
        Row: {
          containers_running: number | null
          cpu_percent: number | null
          created_at: string
          detail: Json
          disk_percent: number | null
          id: string
          inflight_jobs: number | null
          load1: number | null
          load5: number | null
          mem_percent: number | null
          mem_total_mb: number | null
          mem_used_mb: number | null
          uptime_seconds: number | null
          worker_id: string
        }
        Insert: {
          containers_running?: number | null
          cpu_percent?: number | null
          created_at?: string
          detail?: Json
          disk_percent?: number | null
          id?: string
          inflight_jobs?: number | null
          load1?: number | null
          load5?: number | null
          mem_percent?: number | null
          mem_total_mb?: number | null
          mem_used_mb?: number | null
          uptime_seconds?: number | null
          worker_id: string
        }
        Update: {
          containers_running?: number | null
          cpu_percent?: number | null
          created_at?: string
          detail?: Json
          disk_percent?: number | null
          id?: string
          inflight_jobs?: number | null
          load1?: number | null
          load5?: number | null
          mem_percent?: number | null
          mem_total_mb?: number | null
          mem_used_mb?: number | null
          uptime_seconds?: number | null
          worker_id?: string
        }
        Relationships: []
      }
      worker_learned_selectors: {
        Row: {
          created_at: string
          fail_count: number
          field: string
          id: string
          last_failed_at: string | null
          last_verified_at: string | null
          learned_from: string
          notes: string | null
          page_type: string
          platform: string
          selector: string
          success_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          fail_count?: number
          field: string
          id?: string
          last_failed_at?: string | null
          last_verified_at?: string | null
          learned_from?: string
          notes?: string | null
          page_type: string
          platform: string
          selector: string
          success_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          fail_count?: number
          field?: string
          id?: string
          last_failed_at?: string | null
          last_verified_at?: string | null
          learned_from?: string
          notes?: string | null
          page_type?: string
          platform?: string
          selector?: string
          success_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      workflow_credentials: {
        Row: {
          cookie_ciphertext: string | null
          cookie_nonce: string | null
          created_at: string
          gmail_connected_at: string | null
          gmail_email: string | null
          gmail_refresh_ciphertext: string | null
          gmail_refresh_nonce: string | null
          id: string
          password_ciphertext: string | null
          password_nonce: string | null
          platform: string | null
          proxy_ciphertext: string | null
          proxy_id: string | null
          proxy_nonce: string | null
          tenant_id: string
          totp_nonce: string | null
          totp_secret_ciphertext: string | null
          updated_at: string
          username: string | null
          workflow_id: string
        }
        Insert: {
          cookie_ciphertext?: string | null
          cookie_nonce?: string | null
          created_at?: string
          gmail_connected_at?: string | null
          gmail_email?: string | null
          gmail_refresh_ciphertext?: string | null
          gmail_refresh_nonce?: string | null
          id?: string
          password_ciphertext?: string | null
          password_nonce?: string | null
          platform?: string | null
          proxy_ciphertext?: string | null
          proxy_id?: string | null
          proxy_nonce?: string | null
          tenant_id?: string
          totp_nonce?: string | null
          totp_secret_ciphertext?: string | null
          updated_at?: string
          username?: string | null
          workflow_id: string
        }
        Update: {
          cookie_ciphertext?: string | null
          cookie_nonce?: string | null
          created_at?: string
          gmail_connected_at?: string | null
          gmail_email?: string | null
          gmail_refresh_ciphertext?: string | null
          gmail_refresh_nonce?: string | null
          id?: string
          password_ciphertext?: string | null
          password_nonce?: string | null
          platform?: string | null
          proxy_ciphertext?: string | null
          proxy_id?: string | null
          proxy_nonce?: string | null
          tenant_id?: string
          totp_nonce?: string | null
          totp_secret_ciphertext?: string | null
          updated_at?: string
          username?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_credentials_proxy_id_fkey"
            columns: ["proxy_id"]
            isOneToOne: false
            referencedRelation: "proxies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_credentials_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_folders: {
        Row: {
          created_at: string
          id: string
          module: Database["public"]["Enums"]["app_module"]
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          module?: Database["public"]["Enums"]["app_module"]
          name: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          module?: Database["public"]["Enums"]["app_module"]
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      workflows: {
        Row: {
          active: boolean
          cookie_jar_country: string | null
          cookie_jar_locked: boolean
          cookie_jar_stats: Json | null
          cookie_jar_updated_at: string | null
          created_at: string
          daily_cap: number
          folder_id: string | null
          id: string
          language: string | null
          module: Database["public"]["Enums"]["app_module"]
          name: string
          platform: string | null
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          quiet_hours_timezone: string | null
          ready_for_test: boolean
          region: string | null
          spec: Json
          status: string
          tenant_id: string
          timezone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          cookie_jar_country?: string | null
          cookie_jar_locked?: boolean
          cookie_jar_stats?: Json | null
          cookie_jar_updated_at?: string | null
          created_at?: string
          daily_cap?: number
          folder_id?: string | null
          id?: string
          language?: string | null
          module?: Database["public"]["Enums"]["app_module"]
          name?: string
          platform?: string | null
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          quiet_hours_timezone?: string | null
          ready_for_test?: boolean
          region?: string | null
          spec?: Json
          status?: string
          tenant_id?: string
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          cookie_jar_country?: string | null
          cookie_jar_locked?: boolean
          cookie_jar_stats?: Json | null
          cookie_jar_updated_at?: string | null
          created_at?: string
          daily_cap?: number
          folder_id?: string | null
          id?: string
          language?: string | null
          module?: Database["public"]["Enums"]["app_module"]
          name?: string
          platform?: string | null
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          quiet_hours_timezone?: string | null
          ready_for_test?: boolean
          region?: string | null
          spec?: Json
          status?: string
          tenant_id?: string
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "workflow_folders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_tenant_id: { Args: never; Returns: string }
      fail_stuck_brain_runs: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_platform_operator: { Args: never; Returns: boolean }
      is_workflow_quiet_now: {
        Args: { _workflow_id: string }
        Returns: boolean
      }
      tenant_has_module: {
        Args: {
          _module: Database["public"]["Enums"]["app_module"]
          _tenant_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_module: "brain" | "audit"
      app_role: "admin" | "platform_operator" | "user"
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
    Enums: {
      app_module: ["brain", "audit"],
      app_role: ["admin", "platform_operator", "user"],
    },
  },
} as const
