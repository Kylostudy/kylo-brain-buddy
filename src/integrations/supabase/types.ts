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
      brain_workflow_runs: {
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
            foreignKeyName: "workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
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
        }
        Insert: {
          country?: string
          created_at?: string
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
        }
        Update: {
          country?: string
          created_at?: string
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
            foreignKeyName: "recording_sessions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
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
      workflow_credentials: {
        Row: {
          cookie_ciphertext: string | null
          cookie_nonce: string | null
          created_at: string
          id: string
          password_ciphertext: string | null
          password_nonce: string | null
          platform: string
          proxy_ciphertext: string | null
          proxy_nonce: string | null
          tenant_id: string
          totp_nonce: string | null
          totp_secret_ciphertext: string | null
          updated_at: string
          username: string
          workflow_id: string
        }
        Insert: {
          cookie_ciphertext?: string | null
          cookie_nonce?: string | null
          created_at?: string
          id?: string
          password_ciphertext?: string | null
          password_nonce?: string | null
          platform?: string
          proxy_ciphertext?: string | null
          proxy_nonce?: string | null
          tenant_id?: string
          totp_nonce?: string | null
          totp_secret_ciphertext?: string | null
          updated_at?: string
          username?: string
          workflow_id: string
        }
        Update: {
          cookie_ciphertext?: string | null
          cookie_nonce?: string | null
          created_at?: string
          id?: string
          password_ciphertext?: string | null
          password_nonce?: string | null
          platform?: string
          proxy_ciphertext?: string | null
          proxy_nonce?: string | null
          tenant_id?: string
          totp_nonce?: string | null
          totp_secret_ciphertext?: string | null
          updated_at?: string
          username?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_credentials_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: true
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          created_at: string
          id: string
          module: Database["public"]["Enums"]["app_module"]
          name: string
          ready_for_test: boolean
          spec: Json
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          module?: Database["public"]["Enums"]["app_module"]
          name?: string
          ready_for_test?: boolean
          spec?: Json
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          module?: Database["public"]["Enums"]["app_module"]
          name?: string
          ready_for_test?: boolean
          spec?: Json
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_tenant_id: { Args: never; Returns: string }
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
    },
  },
} as const
