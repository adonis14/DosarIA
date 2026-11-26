
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_logs": {
                  Row: {
                    "action": string,"actor_type": Database["public"]['Enums']["actor_type"],"actor_user_id": string | null,"created_at": string,"id": number,"metadata": NonNullable<Json>,"organization_id": string | null,"resource_id": string | null,"resource_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_type": Database["public"]['Enums']["actor_type"],"actor_user_id"?: string | null,"created_at"?: string,"id"?: never,"metadata"?: NonNullable<Json>,"organization_id"?: string | null,"resource_id"?: string | null,"resource_type": string
                  }
                  Update: {
                    "action"?: string,"actor_type"?: Database["public"]['Enums']["actor_type"],"actor_user_id"?: string | null,"created_at"?: string,"id"?: never,"metadata"?: NonNullable<Json>,"organization_id"?: string | null,"resource_id"?: string | null,"resource_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"case_check_schedule": {
                  Row: {
                    "case_id": string,"claimed_until": string | null,"next_check_at": string,"organization_id": string,"reason": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "case_id": string,"claimed_until"?: string | null,"next_check_at": string,"organization_id": string,"reason": string,"updated_at"?: string
                  }
                  Update: {
                    "case_id"?: string,"claimed_until"?: string | null,"next_check_at"?: string,"organization_id"?: string,"reason"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_check_schedule_case_fk"
      columns: ["organization_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"case_events": {
                  Row: {
                    "case_id": string,"details": NonNullable<Json>,"detected_at": string,"event_key": string,"event_type": Database["public"]['Enums']["event_type"],"id": string,"occurred_on": string | null,"organization_id": string,"requires_review": boolean,"snapshot_id": string | null,"summary_en": string | null,"summary_ro": string,"summary_source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "case_id": string,"details"?: NonNullable<Json>,"detected_at"?: string,"event_key": string,"event_type": Database["public"]['Enums']["event_type"],"id"?: string,"occurred_on"?: string | null,"organization_id": string,"requires_review"?: boolean,"snapshot_id"?: string | null,"summary_en"?: string | null,"summary_ro": string,"summary_source": string
                  }
                  Update: {
                    "case_id"?: string,"details"?: NonNullable<Json>,"detected_at"?: string,"event_key"?: string,"event_type"?: Database["public"]['Enums']["event_type"],"id"?: string,"occurred_on"?: string | null,"organization_id"?: string,"requires_review"?: boolean,"snapshot_id"?: string | null,"summary_en"?: string | null,"summary_ro"?: string,"summary_source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_events_case_fk"
      columns: ["organization_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "case_events_snapshot_fk"
      columns: ["case_id","snapshot_id"]
isOneToOne: false
      referencedRelation: "case_snapshots"
      referencedColumns: ["case_id","id"]
    }
                  ]
                },"case_snapshots": {
                  Row: {
                    "case_id": string,"completeness": string,"content_hash": string,"created_at": string,"data": NonNullable<Json>,"fetched_at": string,"id": string,"organization_id": string,"provider": string,"source_reference": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "case_id": string,"completeness": string,"content_hash": string,"created_at"?: string,"data": NonNullable<Json>,"fetched_at": string,"id"?: string,"organization_id": string,"provider": string,"source_reference"?: string | null
                  }
                  Update: {
                    "case_id"?: string,"completeness"?: string,"content_hash"?: string,"created_at"?: string,"data"?: NonNullable<Json>,"fetched_at"?: string,"id"?: string,"organization_id"?: string,"provider"?: string,"source_reference"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_snapshots_case_fk"
      columns: ["organization_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"cases": {
                  Row: {
                    "archived_at": string | null,"assigned_assistant_id": string | null,"assigned_user_id": string | null,"court_case_number": string,"court_name": string,"court_status": string | null,"created_at": string,"created_by": string | null,"id": string,"last_check_attempt_at": string | null,"last_check_outcome": Database["public"]['Enums']["check_outcome"],"last_successful_check_at": string | null,"matter_type": Database["public"]['Enums']["matter_type"],"organization_id": string,"status": Database["public"]['Enums']["case_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"assigned_assistant_id"?: string | null,"assigned_user_id"?: string | null,"court_case_number": string,"court_name": string,"court_status"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_check_attempt_at"?: string | null,"last_check_outcome"?: Database["public"]['Enums']["check_outcome"],"last_successful_check_at"?: string | null,"matter_type"?: Database["public"]['Enums']["matter_type"],"organization_id": string,"status"?: Database["public"]['Enums']["case_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"assigned_assistant_id"?: string | null,"assigned_user_id"?: string | null,"court_case_number"?: string,"court_name"?: string,"court_status"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_check_attempt_at"?: string | null,"last_check_outcome"?: Database["public"]['Enums']["check_outcome"],"last_successful_check_at"?: string | null,"matter_type"?: Database["public"]['Enums']["matter_type"],"organization_id"?: string,"status"?: Database["public"]['Enums']["case_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cases_assigned_assistant_member_fk"
      columns: ["organization_id","assigned_assistant_id"]
isOneToOne: false
      referencedRelation: "organization_memberships"
      referencedColumns: ["organization_id","user_id"]
    },{
      foreignKeyName: "cases_assigned_user_member_fk"
      columns: ["organization_id","assigned_user_id"]
isOneToOne: false
      referencedRelation: "organization_memberships"
      referencedColumns: ["organization_id","user_id"]
    },{
      foreignKeyName: "cases_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cases_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"deadline_reminders": {
                  Row: {
                    "case_id": string,"completed_at": string | null,"completed_by": string | null,"confirmed_at": string | null,"confirmed_by": string | null,"created_at": string,"created_by": string | null,"description": string | null,"due_date": string,"id": string,"organization_id": string,"origin": Database["public"]['Enums']["reminder_origin"],"source_event_id": string | null,"status": Database["public"]['Enums']["reminder_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "case_id": string,"completed_at"?: string | null,"completed_by"?: string | null,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_date": string,"id"?: string,"organization_id": string,"origin"?: Database["public"]['Enums']["reminder_origin"],"source_event_id"?: string | null,"status"?: Database["public"]['Enums']["reminder_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "case_id"?: string,"completed_at"?: string | null,"completed_by"?: string | null,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_date"?: string,"id"?: string,"organization_id"?: string,"origin"?: Database["public"]['Enums']["reminder_origin"],"source_event_id"?: string | null,"status"?: Database["public"]['Enums']["reminder_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "deadline_reminders_case_fk"
      columns: ["organization_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "deadline_reminders_completed_by_fkey"
      columns: ["completed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "deadline_reminders_confirmed_by_fkey"
      columns: ["confirmed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "deadline_reminders_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "deadline_reminders_event_fk"
      columns: ["case_id","source_event_id"]
isOneToOne: false
      referencedRelation: "case_events"
      referencedColumns: ["case_id","id"]
    }
                  ]
                },"monitoring_runs": {
                  Row: {
                    "case_id": string,"created_at": string,"error_code": string | null,"events_created": number,"finished_at": string,"id": string,"organization_id": string,"outcome": Database["public"]['Enums']["check_outcome"],"provider": string,"snapshot_id": string | null,"started_at": string,"trigger_type": string,"triggered_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "case_id": string,"created_at"?: string,"error_code"?: string | null,"events_created"?: number,"finished_at": string,"id"?: string,"organization_id": string,"outcome": Database["public"]['Enums']["check_outcome"],"provider": string,"snapshot_id"?: string | null,"started_at": string,"trigger_type": string,"triggered_by"?: string | null
                  }
                  Update: {
                    "case_id"?: string,"created_at"?: string,"error_code"?: string | null,"events_created"?: number,"finished_at"?: string,"id"?: string,"organization_id"?: string,"outcome"?: Database["public"]['Enums']["check_outcome"],"provider"?: string,"snapshot_id"?: string | null,"started_at"?: string,"trigger_type"?: string,"triggered_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "monitoring_runs_case_fk"
      columns: ["organization_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "monitoring_runs_snapshot_fk"
      columns: ["case_id","snapshot_id"]
isOneToOne: false
      referencedRelation: "case_snapshots"
      referencedColumns: ["case_id","id"]
    },{
      foreignKeyName: "monitoring_runs_triggered_by_fkey"
      columns: ["triggered_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string,"organization_id": string,"revoked_at": string | null,"role": Database["public"]['Enums']["membership_role"],"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email": string,"expires_at": string,"id"?: string,"invited_by": string,"organization_id": string,"revoked_at"?: string | null,"role": Database["public"]['Enums']["membership_role"],"token_hash": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string,"organization_id"?: string,"revoked_at"?: string | null,"role"?: Database["public"]['Enums']["membership_role"],"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_invitations_accepted_by_fkey"
      columns: ["accepted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_invitations_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_invitations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_memberships": {
                  Row: {
                    "created_at": string,"id": string,"organization_id": string,"role": Database["public"]['Enums']["membership_role"],"status": Database["public"]['Enums']["membership_status"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"organization_id": string,"role": Database["public"]['Enums']["membership_role"],"status"?: Database["public"]['Enums']["membership_status"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"organization_id"?: string,"role"?: Database["public"]['Enums']["membership_role"],"status"?: Database["public"]['Enums']["membership_status"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_memberships_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_memberships_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organizations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string | null,"id": string,"preferred_locale": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"full_name"?: string | null,"id": string,"preferred_locale"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string | null,"id"?: string,"preferred_locale"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invitation":
{ Args: { "p_token": string }; Returns: string
                           },
"claim_due_case_checks":
{ Args: { "p_lease_seconds"?: number,"p_limit": number,"p_organization_id"?: string }; Returns: {
              "case_id": string,"court_case_number": string,"court_name": string,"last_check_attempt_at": string,"last_check_outcome": Database["public"]['Enums']["check_outcome"],"matter_type": Database["public"]['Enums']["matter_type"],"organization_id": string
            }[]
                           },
"create_organization":
{ Args: { "p_name": string }; Returns: string
                           },
"record_monitoring_run":
{ Args: { "p_case_id": string,"p_court_status"?: string,"p_error_code"?: string,"p_events"?: Json,"p_finished_at": string,"p_next_check_at"?: string,"p_next_check_reason"?: string,"p_organization_id": string,"p_outcome": Database["public"]['Enums']["check_outcome"],"p_provider": string,"p_snapshot"?: Json,"p_started_at": string,"p_trigger_type": string,"p_triggered_by": string }; Returns: Json
                           }
          }
          Enums: {
            "actor_type": "user"|"system","case_status": "active"|"closed"|"archived","check_outcome": "never_checked"|"changes_detected"|"no_changes"|"failed"|"incomplete"|"source_unavailable","event_type": "monitoring_started"|"hearing_scheduled"|"hearing_rescheduled"|"hearing_postponed"|"decision_issued"|"status_changed"|"stage_changed","matter_type": "civil"|"commercial"|"labor"|"administrative"|"family"|"enforcement"|"insolvency"|"criminal"|"other","membership_role": "admin"|"lawyer"|"assistant","membership_status": "active"|"suspended"|"removed","reminder_origin": "manual"|"suggested","reminder_status": "proposed"|"confirmed"|"completed"|"needs_review"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "actor_type": ["user", "system"],"case_status": ["active", "closed", "archived"],"check_outcome": ["never_checked", "changes_detected", "no_changes", "failed", "incomplete", "source_unavailable"],"event_type": ["monitoring_started", "hearing_scheduled", "hearing_rescheduled", "hearing_postponed", "decision_issued", "status_changed", "stage_changed"],"matter_type": ["civil", "commercial", "labor", "administrative", "family", "enforcement", "insolvency", "criminal", "other"],"membership_role": ["admin", "lawyer", "assistant"],"membership_status": ["active", "suspended", "removed"],"reminder_origin": ["manual", "suggested"],"reminder_status": ["proposed", "confirmed", "completed", "needs_review"]
          }
        }
} as const
