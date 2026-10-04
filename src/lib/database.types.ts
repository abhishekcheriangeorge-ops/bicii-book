export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      attachment_events: {
        Row: {
          actor_staff_id: string | null;
          attachment_id: string;
          correlation_id: string | null;
          created_at: string;
          entity_id: string;
          entity_type: Database["public"]["Enums"]["attachment_entity"];
          event_type: Database["public"]["Enums"]["attachment_event_type"];
          id: string;
          payload: NonNullable<Json>;
          reason: string | null;
        };
        Insert: {
          actor_staff_id?: string | null;
          attachment_id: string;
          correlation_id?: string | null;
          created_at?: string;
          entity_id: string;
          entity_type: Database["public"]["Enums"]["attachment_entity"];
          event_type: Database["public"]["Enums"]["attachment_event_type"];
          id?: string;
          payload?: NonNullable<Json>;
          reason?: string | null;
        };
        Update: {
          actor_staff_id?: string | null;
          attachment_id?: string;
          correlation_id?: string | null;
          created_at?: string;
          entity_id?: string;
          entity_type?: Database["public"]["Enums"]["attachment_entity"];
          event_type?: Database["public"]["Enums"]["attachment_event_type"];
          id?: string;
          payload?: NonNullable<Json>;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "attachment_events_actor_staff_id_fkey";
            columns: ["actor_staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      attachments: {
        Row: {
          byte_size: number | null;
          caption: string | null;
          created_at: string;
          created_by: string | null;
          entity_id: string;
          entity_type: Database["public"]["Enums"]["attachment_entity"];
          height: number | null;
          id: string;
          media_type: string;
          storage_bucket: string;
          storage_path: string;
          updated_at: string;
          visibility: Database["public"]["Enums"]["attachment_visibility"];
          width: number | null;
        };
        Insert: {
          byte_size?: number | null;
          caption?: string | null;
          created_at?: string;
          created_by?: string | null;
          entity_id: string;
          entity_type: Database["public"]["Enums"]["attachment_entity"];
          height?: number | null;
          id?: string;
          media_type: string;
          storage_bucket: string;
          storage_path: string;
          updated_at?: string;
          visibility?: Database["public"]["Enums"]["attachment_visibility"];
          width?: number | null;
        };
        Update: {
          byte_size?: number | null;
          caption?: string | null;
          created_at?: string;
          created_by?: string | null;
          entity_id?: string;
          entity_type?: Database["public"]["Enums"]["attachment_entity"];
          height?: number | null;
          id?: string;
          media_type?: string;
          storage_bucket?: string;
          storage_path?: string;
          updated_at?: string;
          visibility?: Database["public"]["Enums"]["attachment_visibility"];
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "attachments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      bike_ownership_events: {
        Row: {
          actor_staff_id: string | null;
          bike_id: string;
          correlation_id: string | null;
          created_at: string;
          event_type: Database["public"]["Enums"]["bike_ownership_event_type"];
          from_customer_id: string | null;
          id: string;
          reason: string | null;
          to_customer_id: string | null;
        };
        Insert: {
          actor_staff_id?: string | null;
          bike_id: string;
          correlation_id?: string | null;
          created_at?: string;
          event_type: Database["public"]["Enums"]["bike_ownership_event_type"];
          from_customer_id?: string | null;
          id?: string;
          reason?: string | null;
          to_customer_id?: string | null;
        };
        Update: {
          actor_staff_id?: string | null;
          bike_id?: string;
          correlation_id?: string | null;
          created_at?: string;
          event_type?: Database["public"]["Enums"]["bike_ownership_event_type"];
          from_customer_id?: string | null;
          id?: string;
          reason?: string | null;
          to_customer_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bike_ownership_events_actor_staff_id_fkey";
            columns: ["actor_staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bike_ownership_events_bike_id_fkey";
            columns: ["bike_id"];
            isOneToOne: false;
            referencedRelation: "bikes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bike_ownership_events_from_customer_id_fkey";
            columns: ["from_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bike_ownership_events_to_customer_id_fkey";
            columns: ["to_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      bikes: {
        Row: {
          archived_at: string | null;
          brand: string;
          colour: string | null;
          created_at: string;
          customer_id: string | null;
          description: string | null;
          frame_size: string | null;
          id: string;
          internal_notes: string | null;
          inventory_unit_id: string | null;
          model: string;
          search_text: string | null;
          serial_key: string | null;
          serial_number: string | null;
          short_id: string;
          updated_at: string;
          variant: string | null;
        };
        Insert: {
          archived_at?: string | null;
          brand: string;
          colour?: string | null;
          created_at?: string;
          customer_id?: string | null;
          description?: string | null;
          frame_size?: string | null;
          id?: string;
          internal_notes?: string | null;
          inventory_unit_id?: string | null;
          model: string;
          search_text?: never;
          serial_key?: never;
          serial_number?: string | null;
          short_id?: string;
          updated_at?: string;
          variant?: string | null;
        };
        Update: {
          archived_at?: string | null;
          brand?: string;
          colour?: string | null;
          created_at?: string;
          customer_id?: string | null;
          description?: string | null;
          frame_size?: string | null;
          id?: string;
          internal_notes?: string | null;
          inventory_unit_id?: string | null;
          model?: string;
          search_text?: never;
          serial_key?: never;
          serial_number?: string | null;
          short_id?: string;
          updated_at?: string;
          variant?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bikes_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          archived_at: string | null;
          auth_user_id: string | null;
          created_at: string;
          display_name: string | null;
          email: string | null;
          first_name: string | null;
          id: string;
          internal_notes: string | null;
          last_name: string | null;
          phone: string | null;
          phone_digits: string | null;
          search_text: string | null;
          shopify_customer_id: string | null;
          short_id: string | null;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          auth_user_id?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          first_name?: string | null;
          id?: string;
          internal_notes?: string | null;
          last_name?: string | null;
          phone?: string | null;
          phone_digits?: never;
          search_text?: never;
          shopify_customer_id?: string | null;
          short_id?: string | null;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          auth_user_id?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          first_name?: string | null;
          id?: string;
          internal_notes?: string | null;
          last_name?: string | null;
          phone?: string | null;
          phone_digits?: never;
          search_text?: never;
          shopify_customer_id?: string | null;
          short_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      staff: {
        Row: {
          active: boolean;
          auth_user_id: string;
          created_at: string;
          display_name: string;
          email: string;
          id: string;
          role: Database["public"]["Enums"]["staff_role"];
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          auth_user_id: string;
          created_at?: string;
          display_name: string;
          email: string;
          id?: string;
          role?: Database["public"]["Enums"]["staff_role"];
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          auth_user_id?: string;
          created_at?: string;
          display_name?: string;
          email?: string;
          id?: string;
          role?: Database["public"]["Enums"]["staff_role"];
          updated_at?: string;
        };
        Relationships: [];
      };
      staff_events: {
        Row: {
          actor_staff_id: string | null;
          correlation_id: string | null;
          created_at: string;
          event_type: Database["public"]["Enums"]["staff_event_type"];
          id: string;
          payload: NonNullable<Json>;
          permission: Database["public"]["Enums"]["permission_key"] | null;
          reason: string | null;
          staff_id: string;
        };
        Insert: {
          actor_staff_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          event_type: Database["public"]["Enums"]["staff_event_type"];
          id?: string;
          payload?: NonNullable<Json>;
          permission?: Database["public"]["Enums"]["permission_key"] | null;
          reason?: string | null;
          staff_id: string;
        };
        Update: {
          actor_staff_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          event_type?: Database["public"]["Enums"]["staff_event_type"];
          id?: string;
          payload?: NonNullable<Json>;
          permission?: Database["public"]["Enums"]["permission_key"] | null;
          reason?: string | null;
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_events_actor_staff_id_fkey";
            columns: ["actor_staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_events_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_permissions: {
        Row: {
          granted_at: string;
          granted_by: string | null;
          permission: Database["public"]["Enums"]["permission_key"];
          staff_id: string;
        };
        Insert: {
          granted_at?: string;
          granted_by?: string | null;
          permission: Database["public"]["Enums"]["permission_key"];
          staff_id: string;
        };
        Update: {
          granted_at?: string;
          granted_by?: string | null;
          permission?: Database["public"]["Enums"]["permission_key"];
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_permissions_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_permissions_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_staff: {
        Args: {
          auth_user_id: string;
          display_name: string;
          email: string;
          role?: Database["public"]["Enums"]["staff_role"];
        };
        Returns: {
          active: boolean;
          auth_user_id: string;
          created_at: string;
          display_name: string;
          email: string;
          id: string;
          role: Database["public"]["Enums"]["staff_role"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "staff";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      delete_attachment: {
        Args: { attachment_id: string; reason: string };
        Returns: {
          byte_size: number | null;
          caption: string | null;
          created_at: string;
          created_by: string | null;
          entity_id: string;
          entity_type: Database["public"]["Enums"]["attachment_entity"];
          height: number | null;
          id: string;
          media_type: string;
          storage_bucket: string;
          storage_path: string;
          updated_at: string;
          visibility: Database["public"]["Enums"]["attachment_visibility"];
          width: number | null;
        };
        SetofOptions: {
          from: "*";
          to: "attachments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      grant_permission: {
        Args: {
          permission: Database["public"]["Enums"]["permission_key"];
          target_staff_id: string;
        };
        Returns: {
          granted_at: string;
          granted_by: string | null;
          permission: Database["public"]["Enums"]["permission_key"];
          staff_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "staff_permissions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      my_staff_profile: {
        Args: Record<PropertyKey, never>;
        Returns: {
          active: boolean;
          auth_user_id: string;
          display_name: string;
          email: string;
          id: string;
          permissions: Database["public"]["Enums"]["permission_key"][];
          role: Database["public"]["Enums"]["staff_role"];
        }[];
      };
      record_attachment: {
        Args: {
          attachment_id: string;
          byte_size?: number;
          caption?: string;
          entity_id: string;
          entity_type: Database["public"]["Enums"]["attachment_entity"];
          height?: number;
          media_type: string;
          storage_bucket: string;
          storage_path: string;
          visibility?: Database["public"]["Enums"]["attachment_visibility"];
          width?: number;
        };
        Returns: {
          byte_size: number | null;
          caption: string | null;
          created_at: string;
          created_by: string | null;
          entity_id: string;
          entity_type: Database["public"]["Enums"]["attachment_entity"];
          height: number | null;
          id: string;
          media_type: string;
          storage_bucket: string;
          storage_path: string;
          updated_at: string;
          visibility: Database["public"]["Enums"]["attachment_visibility"];
          width: number | null;
        };
        SetofOptions: {
          from: "*";
          to: "attachments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      revoke_permission: {
        Args: {
          permission: Database["public"]["Enums"]["permission_key"];
          target_staff_id: string;
        };
        Returns: {
          granted_at: string;
          granted_by: string | null;
          permission: Database["public"]["Enums"]["permission_key"];
          staff_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "staff_permissions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_attachment_visibility: {
        Args: {
          attachment_id: string;
          new_bucket?: string;
          new_path?: string;
          visibility: Database["public"]["Enums"]["attachment_visibility"];
        };
        Returns: {
          byte_size: number | null;
          caption: string | null;
          created_at: string;
          created_by: string | null;
          entity_id: string;
          entity_type: Database["public"]["Enums"]["attachment_entity"];
          height: number | null;
          id: string;
          media_type: string;
          storage_bucket: string;
          storage_path: string;
          updated_at: string;
          visibility: Database["public"]["Enums"]["attachment_visibility"];
          width: number | null;
        };
        SetofOptions: {
          from: "*";
          to: "attachments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_staff_active: {
        Args: { active: boolean; reason?: string; target_staff_id: string };
        Returns: {
          active: boolean;
          auth_user_id: string;
          created_at: string;
          display_name: string;
          email: string;
          id: string;
          role: Database["public"]["Enums"]["staff_role"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "staff";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      staff_directory: {
        Args: Record<PropertyKey, never>;
        Returns: {
          active: boolean;
          display_name: string;
          id: string;
          role: Database["public"]["Enums"]["staff_role"];
        }[];
      };
      staff_history: {
        Args: { max_rows?: number; target_staff_id: string };
        Returns: {
          actor_display_name: string;
          actor_staff_id: string;
          correlation_id: string;
          created_at: string;
          event_type: Database["public"]["Enums"]["staff_event_type"];
          id: string;
          payload: Json;
          permission: Database["public"]["Enums"]["permission_key"];
          reason: string;
        }[];
      };
      staff_roster: {
        Args: Record<PropertyKey, never>;
        Returns: {
          active: boolean;
          auth_user_id: string;
          created_at: string;
          display_name: string;
          email: string;
          granted_permissions: Database["public"]["Enums"]["permission_key"][];
          id: string;
          role: Database["public"]["Enums"]["staff_role"];
        }[];
      };
      transfer_bike_ownership: {
        Args: { bike_id: string; reason: string; to_customer_id: string };
        Returns: {
          archived_at: string | null;
          brand: string;
          colour: string | null;
          created_at: string;
          customer_id: string | null;
          description: string | null;
          frame_size: string | null;
          id: string;
          internal_notes: string | null;
          inventory_unit_id: string | null;
          model: string;
          search_text: string | null;
          serial_key: string | null;
          serial_number: string | null;
          short_id: string;
          updated_at: string;
          variant: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "bikes";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_staff: {
        Args: {
          display_name?: string;
          reason?: string;
          role?: Database["public"]["Enums"]["staff_role"];
          target_staff_id: string;
        };
        Returns: {
          active: boolean;
          auth_user_id: string;
          created_at: string;
          display_name: string;
          email: string;
          id: string;
          role: Database["public"]["Enums"]["staff_role"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "staff";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      attachment_entity:
        "bike" | "work_order" | "product" | "inventory_unit" | "customer" | "consignment_item";
      attachment_event_type: "created" | "visibility_changed" | "caption_changed" | "deleted";
      attachment_visibility: "internal" | "customer" | "public";
      bike_ownership_event_type: "registered" | "transferred";
      permission_key:
        | "view_costs"
        | "manage_inventory"
        | "adjust_stock"
        | "manage_consignments"
        | "manage_purchasing"
        | "manage_staff"
        | "view_financial_reports";
      staff_event_type:
        | "created"
        | "details_changed"
        | "role_changed"
        | "deactivated"
        | "reactivated"
        | "permission_granted"
        | "permission_revoked";
      staff_role: "admin" | "staff";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      attachment_entity: [
        "bike",
        "work_order",
        "product",
        "inventory_unit",
        "customer",
        "consignment_item",
      ],
      attachment_event_type: ["created", "visibility_changed", "caption_changed", "deleted"],
      attachment_visibility: ["internal", "customer", "public"],
      bike_ownership_event_type: ["registered", "transferred"],
      permission_key: [
        "view_costs",
        "manage_inventory",
        "adjust_stock",
        "manage_consignments",
        "manage_purchasing",
        "manage_staff",
        "view_financial_reports",
      ],
      staff_event_type: [
        "created",
        "details_changed",
        "role_changed",
        "deactivated",
        "reactivated",
        "permission_granted",
        "permission_revoked",
      ],
      staff_role: ["admin", "staff"],
    },
  },
} as const;
