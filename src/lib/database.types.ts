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
      categories: {
        Row: {
          archived_at: string | null;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["category_kind"];
          name: string;
          parent_id: string | null;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["category_kind"];
          name: string;
          parent_id?: string | null;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["category_kind"];
          name?: string;
          parent_id?: string | null;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      cult_commons_rates: {
        Row: {
          cancelled_at: string | null;
          cancelled_by: string | null;
          created_at: string;
          created_by: string | null;
          effective_from: string;
          id: string;
          rate: number;
        };
        Insert: {
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          effective_from: string;
          id?: string;
          rate: number;
        };
        Update: {
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          effective_from?: string;
          id?: string;
          rate?: number;
        };
        Relationships: [
          {
            foreignKeyName: "cult_commons_rates_cancelled_by_fkey";
            columns: ["cancelled_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cult_commons_rates_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "staff";
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
      services: {
        Row: {
          active: boolean;
          archived_at: string | null;
          category_id: string | null;
          created_at: string;
          currency: string;
          default_direct_cost: number;
          default_sale_price: number;
          description: string | null;
          id: string;
          name: string;
          public: boolean;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          archived_at?: string | null;
          category_id?: string | null;
          created_at?: string;
          currency?: string;
          default_direct_cost?: number;
          default_sale_price: number;
          description?: string | null;
          id?: string;
          name: string;
          public?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          archived_at?: string | null;
          category_id?: string | null;
          created_at?: string;
          currency?: string;
          default_direct_cost?: number;
          default_sale_price?: number;
          description?: string | null;
          id?: string;
          name?: string;
          public?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
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
      work_order_assignments: {
        Row: {
          assigned_at: string;
          assigned_by: string | null;
          id: string;
          role: Database["public"]["Enums"]["assignment_role"];
          staff_id: string;
          unassigned_at: string | null;
          unassigned_by: string | null;
          work_order_id: string;
        };
        Insert: {
          assigned_at?: string;
          assigned_by?: string | null;
          id?: string;
          role: Database["public"]["Enums"]["assignment_role"];
          staff_id: string;
          unassigned_at?: string | null;
          unassigned_by?: string | null;
          work_order_id: string;
        };
        Update: {
          assigned_at?: string;
          assigned_by?: string | null;
          id?: string;
          role?: Database["public"]["Enums"]["assignment_role"];
          staff_id?: string;
          unassigned_at?: string | null;
          unassigned_by?: string | null;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_assignments_assigned_by_fkey";
            columns: ["assigned_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_assignments_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_assignments_unassigned_by_fkey";
            columns: ["unassigned_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_assignments_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_order_totals";
            referencedColumns: ["work_order_id"];
          },
          {
            foreignKeyName: "work_order_assignments_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_order_totals_staff";
            referencedColumns: ["work_order_id"];
          },
          {
            foreignKeyName: "work_order_assignments_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_order_events: {
        Row: {
          actor_staff_id: string | null;
          actor_user_id: string | null;
          correlation_id: string | null;
          created_at: string;
          event_type: Database["public"]["Enums"]["work_order_event_type"];
          id: number;
          payload: NonNullable<Json>;
          work_order_id: string;
        };
        Insert: {
          actor_staff_id?: string | null;
          actor_user_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          event_type: Database["public"]["Enums"]["work_order_event_type"];
          id?: never;
          payload?: NonNullable<Json>;
          work_order_id: string;
        };
        Update: {
          actor_staff_id?: string | null;
          actor_user_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          event_type?: Database["public"]["Enums"]["work_order_event_type"];
          id?: never;
          payload?: NonNullable<Json>;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_events_actor_staff_id_fkey";
            columns: ["actor_staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_events_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_order_totals";
            referencedColumns: ["work_order_id"];
          },
          {
            foreignKeyName: "work_order_events_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_order_totals_staff";
            referencedColumns: ["work_order_id"];
          },
          {
            foreignKeyName: "work_order_events_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_order_line_items: {
        Row: {
          cost_total: number | null;
          created_at: string;
          created_by: string | null;
          cult_commons_rate_snapshot: number;
          cult_commons_share: number | null;
          currency: string;
          description_snapshot: string;
          id: string;
          line_type: Database["public"]["Enums"]["line_type"];
          quantity: number;
          sale_total: number | null;
          source_inventory_unit_id: string | null;
          source_product_id: string | null;
          source_service_id: string | null;
          unit_direct_cost_snapshot: number;
          unit_sale_price_snapshot: number;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
          work_order_id: string;
          yield_total: number | null;
        };
        Insert: {
          cost_total?: never;
          created_at?: string;
          created_by?: string | null;
          cult_commons_rate_snapshot: number;
          cult_commons_share?: never;
          currency: string;
          description_snapshot: string;
          id: string;
          line_type: Database["public"]["Enums"]["line_type"];
          quantity: number;
          sale_total?: never;
          source_inventory_unit_id?: string | null;
          source_product_id?: string | null;
          source_service_id?: string | null;
          unit_direct_cost_snapshot: number;
          unit_sale_price_snapshot: number;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
          work_order_id: string;
          yield_total?: never;
        };
        Update: {
          cost_total?: never;
          created_at?: string;
          created_by?: string | null;
          cult_commons_rate_snapshot?: number;
          cult_commons_share?: never;
          currency?: string;
          description_snapshot?: string;
          id?: string;
          line_type?: Database["public"]["Enums"]["line_type"];
          quantity?: number;
          sale_total?: never;
          source_inventory_unit_id?: string | null;
          source_product_id?: string | null;
          source_service_id?: string | null;
          unit_direct_cost_snapshot?: number;
          unit_sale_price_snapshot?: number;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
          work_order_id?: string;
          yield_total?: never;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_line_items_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_line_items_source_service_id_fkey";
            columns: ["source_service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_line_items_source_service_id_fkey";
            columns: ["source_service_id"];
            isOneToOne: false;
            referencedRelation: "services_staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_line_items_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_line_items_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_order_totals";
            referencedColumns: ["work_order_id"];
          },
          {
            foreignKeyName: "work_order_line_items_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_order_totals_staff";
            referencedColumns: ["work_order_id"];
          },
          {
            foreignKeyName: "work_order_line_items_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_orders: {
        Row: {
          appointment_id: string | null;
          approval_flag: boolean;
          approval_note: string | null;
          bike_id: string;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          checked_in_at: string;
          collected_at: string | null;
          completed_at: string | null;
          completion_notes: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          customer_id: string;
          id: string;
          intake_notes: string | null;
          internal_notes: string | null;
          job_number: string;
          lead_mechanic_id: string | null;
          ready_for_collection_at: string | null;
          requested_work: string;
          started_at: string | null;
          status: Database["public"]["Enums"]["work_order_status"];
          status_changed_at: string;
          updated_at: string;
        };
        Insert: {
          appointment_id?: string | null;
          approval_flag?: boolean;
          approval_note?: string | null;
          bike_id: string;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          checked_in_at?: string;
          collected_at?: string | null;
          completed_at?: string | null;
          completion_notes?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          customer_id: string;
          id?: string;
          intake_notes?: string | null;
          internal_notes?: string | null;
          job_number?: string;
          lead_mechanic_id?: string | null;
          ready_for_collection_at?: string | null;
          requested_work: string;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["work_order_status"];
          status_changed_at?: string;
          updated_at?: string;
        };
        Update: {
          appointment_id?: string | null;
          approval_flag?: boolean;
          approval_note?: string | null;
          bike_id?: string;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          checked_in_at?: string;
          collected_at?: string | null;
          completed_at?: string | null;
          completion_notes?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          customer_id?: string;
          id?: string;
          intake_notes?: string | null;
          internal_notes?: string | null;
          job_number?: string;
          lead_mechanic_id?: string | null;
          ready_for_collection_at?: string | null;
          requested_work?: string;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["work_order_status"];
          status_changed_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_orders_bike_id_fkey";
            columns: ["bike_id"];
            isOneToOne: false;
            referencedRelation: "bikes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_lead_mechanic_id_fkey";
            columns: ["lead_mechanic_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      services_staff: {
        Row: {
          active: boolean | null;
          archived_at: string | null;
          category_id: string | null;
          created_at: string | null;
          currency: string | null;
          default_direct_cost: number | null;
          default_sale_price: number | null;
          description: string | null;
          id: string | null;
          name: string | null;
          public: boolean | null;
          sort_order: number | null;
          updated_at: string | null;
        };
        Insert: {
          active?: boolean | null;
          archived_at?: string | null;
          category_id?: string | null;
          created_at?: string | null;
          currency?: string | null;
          default_direct_cost?: number | null;
          default_sale_price?: number | null;
          description?: string | null;
          id?: string | null;
          name?: string | null;
          public?: boolean | null;
          sort_order?: number | null;
          updated_at?: string | null;
        };
        Update: {
          active?: boolean | null;
          archived_at?: string | null;
          category_id?: string | null;
          created_at?: string | null;
          currency?: string | null;
          default_direct_cost?: number | null;
          default_sale_price?: number | null;
          description?: string | null;
          id?: string | null;
          name?: string | null;
          public?: boolean | null;
          sort_order?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      work_order_line_items_staff: {
        Row: {
          cost_total: number | null;
          created_at: string | null;
          created_by: string | null;
          cult_commons_rate_snapshot: number | null;
          cult_commons_share: number | null;
          currency: string | null;
          description_snapshot: string | null;
          id: string | null;
          line_type: Database["public"]["Enums"]["line_type"] | null;
          quantity: number | null;
          sale_total: number | null;
          source_inventory_unit_id: string | null;
          source_product_id: string | null;
          source_service_id: string | null;
          unit_direct_cost_snapshot: number | null;
          unit_sale_price_snapshot: number | null;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
          work_order_id: string | null;
          yield_total: number | null;
        };
        Insert: {
          cost_total?: number | null;
          created_at?: string | null;
          created_by?: string | null;
          cult_commons_rate_snapshot?: number | null;
          cult_commons_share?: number | null;
          currency?: string | null;
          description_snapshot?: string | null;
          id?: string | null;
          line_type?: Database["public"]["Enums"]["line_type"] | null;
          quantity?: number | null;
          sale_total?: number | null;
          source_inventory_unit_id?: string | null;
          source_product_id?: string | null;
          source_service_id?: string | null;
          unit_direct_cost_snapshot?: number | null;
          unit_sale_price_snapshot?: number | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
          work_order_id?: string | null;
          yield_total?: number | null;
        };
        Update: {
          cost_total?: number | null;
          created_at?: string | null;
          created_by?: string | null;
          cult_commons_rate_snapshot?: number | null;
          cult_commons_share?: number | null;
          currency?: string | null;
          description_snapshot?: string | null;
          id?: string | null;
          line_type?: Database["public"]["Enums"]["line_type"] | null;
          quantity?: number | null;
          sale_total?: number | null;
          source_inventory_unit_id?: string | null;
          source_product_id?: string | null;
          source_service_id?: string | null;
          unit_direct_cost_snapshot?: number | null;
          unit_sale_price_snapshot?: number | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
          work_order_id?: string | null;
          yield_total?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_line_items_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_line_items_source_service_id_fkey";
            columns: ["source_service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_line_items_source_service_id_fkey";
            columns: ["source_service_id"];
            isOneToOne: false;
            referencedRelation: "services_staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_line_items_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_line_items_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_order_totals";
            referencedColumns: ["work_order_id"];
          },
          {
            foreignKeyName: "work_order_line_items_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_order_totals_staff";
            referencedColumns: ["work_order_id"];
          },
          {
            foreignKeyName: "work_order_line_items_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_order_totals: {
        Row: {
          currency: string | null;
          line_count: number | null;
          sale_total: number | null;
          work_order_id: string | null;
        };
        Relationships: [];
      };
      work_order_totals_staff: {
        Row: {
          bicii_yield_after_cc: number | null;
          cost_total: number | null;
          cult_commons_share: number | null;
          currency: string | null;
          line_count: number | null;
          sale_total: number | null;
          work_order_id: string | null;
          yield_total: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      add_manual_line: {
        Args: {
          description: string;
          line_id: string;
          quantity?: unknown;
          unit_direct_cost?: unknown;
          unit_sale_price: unknown;
          work_order_id: string;
        };
        Returns: string;
      };
      add_service_line: {
        Args: {
          description?: string;
          line_id: string;
          quantity?: unknown;
          service_id: string;
          unit_direct_cost?: unknown;
          unit_sale_price?: unknown;
          work_order_id: string;
        };
        Returns: string;
      };
      add_work_order_note: {
        Args: {
          body: string;
          kind: Database["public"]["Enums"]["work_order_note_kind"];
          work_order_id: string;
        };
        Returns: {
          actor_staff_id: string | null;
          actor_user_id: string | null;
          correlation_id: string | null;
          created_at: string;
          event_type: Database["public"]["Enums"]["work_order_event_type"];
          id: number;
          payload: NonNullable<Json>;
          work_order_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "work_order_events";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      assign_staff: {
        Args: {
          role?: Database["public"]["Enums"]["assignment_role"];
          staff_id: string;
          work_order_id: string;
        };
        Returns: {
          assigned_at: string;
          assigned_by: string | null;
          id: string;
          role: Database["public"]["Enums"]["assignment_role"];
          staff_id: string;
          unassigned_at: string | null;
          unassigned_by: string | null;
          work_order_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "work_order_assignments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      attachment_stray_objects: {
        Args: { entity_id: string; entity_type: Database["public"]["Enums"]["attachment_entity"] };
        Returns: {
          bucket: string;
          path: string;
        }[];
      };
      cancel_cult_commons_rate: {
        Args: { rate_id: string };
        Returns: {
          cancelled_at: string | null;
          cancelled_by: string | null;
          created_at: string;
          created_by: string | null;
          effective_from: string;
          id: string;
          rate: number;
        };
        SetofOptions: {
          from: "*";
          to: "cult_commons_rates";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_service: {
        Args: {
          category_id?: string;
          default_direct_cost?: unknown;
          default_sale_price: unknown;
          description?: string;
          is_active?: boolean;
          is_public?: boolean;
          name: string;
          service_id: string;
        };
        Returns: string;
      };
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
      create_work_order: {
        Args: {
          additional_staff_ids?: string[];
          bike_id: string;
          customer_id: string;
          intake_notes?: string;
          lead_mechanic_id?: string;
          requested_work: string;
          services?: Json;
          work_order_id: string;
        };
        Returns: {
          appointment_id: string | null;
          approval_flag: boolean;
          approval_note: string | null;
          bike_id: string;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          checked_in_at: string;
          collected_at: string | null;
          completed_at: string | null;
          completion_notes: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          customer_id: string;
          id: string;
          intake_notes: string | null;
          internal_notes: string | null;
          job_number: string;
          lead_mechanic_id: string | null;
          ready_for_collection_at: string | null;
          requested_work: string;
          started_at: string | null;
          status: Database["public"]["Enums"]["work_order_status"];
          status_changed_at: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "work_orders";
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
        }[];
        SetofOptions: {
          from: "*";
          to: "attachments";
          isOneToOne: false;
          isSetofReturn: true;
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
      my_bike_attachments: {
        Args: { bike_id: string };
        Returns: {
          caption: string;
          created_at: string;
          height: number;
          id: string;
          media_type: string;
          storage_bucket: string;
          storage_path: string;
          visibility: Database["public"]["Enums"]["attachment_visibility"];
          width: number;
        }[];
      };
      my_bikes: {
        Args: Record<PropertyKey, never>;
        Returns: {
          brand: string;
          colour: string;
          created_at: string;
          description: string;
          frame_size: string;
          id: string;
          model: string;
          serial_number: string;
          short_id: string;
          variant: string;
        }[];
      };
      my_customer_profile: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["CompositeTypes"]["customer_profile"][];
        SetofOptions: {
          from: "*";
          to: "customer_profile";
          isOneToOne: false;
          isSetofReturn: true;
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
      my_work_order_attachments: {
        Args: { work_order_id: string };
        Returns: {
          caption: string;
          created_at: string;
          height: number;
          id: string;
          media_type: string;
          storage_bucket: string;
          storage_path: string;
          visibility: Database["public"]["Enums"]["attachment_visibility"];
          width: number;
        }[];
      };
      my_work_order_lines: {
        Args: { work_order_id: string };
        Returns: {
          currency: string;
          description: string;
          id: string;
          quantity: unknown;
          sale_total: unknown;
          unit_sale_price: unknown;
        }[];
      };
      my_work_order_timeline: {
        Args: { work_order_id: string };
        Returns: {
          attachment_id: string;
          created_at: string;
          id: number;
          kind: string;
          status: Database["public"]["Enums"]["customer_job_status"];
        }[];
      };
      my_work_orders: {
        Args: Record<PropertyKey, never>;
        Returns: {
          bike_id: string;
          bike_short_id: string;
          bike_title: string;
          checked_in_at: string;
          collected_at: string;
          completed_at: string;
          currency: string;
          id: string;
          job_number: string;
          ready_for_collection_at: string;
          sale_total: unknown;
          status: Database["public"]["Enums"]["customer_job_status"];
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
      schedule_cult_commons_rate: {
        Args: { effective_from?: string; rate: unknown };
        Returns: {
          cancelled_at: string | null;
          cancelled_by: string | null;
          created_at: string;
          created_by: string | null;
          effective_from: string;
          id: string;
          rate: number;
        };
        SetofOptions: {
          from: "*";
          to: "cult_commons_rates";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_approval_flag: {
        Args: { flagged: boolean; note?: string; work_order_id: string };
        Returns: {
          appointment_id: string | null;
          approval_flag: boolean;
          approval_note: string | null;
          bike_id: string;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          checked_in_at: string;
          collected_at: string | null;
          completed_at: string | null;
          completion_notes: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          customer_id: string;
          id: string;
          intake_notes: string | null;
          internal_notes: string | null;
          job_number: string;
          lead_mechanic_id: string | null;
          ready_for_collection_at: string | null;
          requested_work: string;
          started_at: string | null;
          status: Database["public"]["Enums"]["work_order_status"];
          status_changed_at: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "work_orders";
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
      set_service_archived: { Args: { archived: boolean; service_id: string }; Returns: string };
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
      set_work_order_status: {
        Args: {
          note?: string;
          status: Database["public"]["Enums"]["work_order_status"];
          work_order_id: string;
        };
        Returns: {
          appointment_id: string | null;
          approval_flag: boolean;
          approval_note: string | null;
          bike_id: string;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          checked_in_at: string;
          collected_at: string | null;
          completed_at: string | null;
          completion_notes: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          customer_id: string;
          id: string;
          intake_notes: string | null;
          internal_notes: string | null;
          job_number: string;
          lead_mechanic_id: string | null;
          ready_for_collection_at: string | null;
          requested_work: string;
          started_at: string | null;
          status: Database["public"]["Enums"]["work_order_status"];
          status_changed_at: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "work_orders";
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
      staff_search: {
        Args: { archived?: boolean; kinds?: string[]; max_results?: number; q: string };
        Returns: {
          id: string;
          kind: string;
          rank: number;
          short_id: string;
          subtitle: string;
          title: string;
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
      unassign_staff: {
        Args: { staff_id: string; work_order_id: string };
        Returns: {
          assigned_at: string;
          assigned_by: string | null;
          id: string;
          role: Database["public"]["Enums"]["assignment_role"];
          staff_id: string;
          unassigned_at: string | null;
          unassigned_by: string | null;
          work_order_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "work_order_assignments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_my_profile: {
        Args: { display_name?: string; first_name?: string; last_name?: string; phone?: string };
        Returns: Database["public"]["CompositeTypes"]["customer_profile"];
        SetofOptions: {
          from: "*";
          to: "customer_profile";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_service: {
        Args: {
          category_id?: string;
          default_direct_cost?: unknown;
          default_sale_price: unknown;
          description?: string;
          is_active?: boolean;
          is_public?: boolean;
          name: string;
          service_id: string;
        };
        Returns: string;
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
      update_work_order: {
        Args: {
          completion_notes?: string;
          intake_notes?: string;
          internal_notes?: string;
          requested_work?: string;
          work_order_id: string;
        };
        Returns: {
          appointment_id: string | null;
          approval_flag: boolean;
          approval_note: string | null;
          bike_id: string;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          checked_in_at: string;
          collected_at: string | null;
          completed_at: string | null;
          completion_notes: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          customer_id: string;
          id: string;
          intake_notes: string | null;
          internal_notes: string | null;
          job_number: string;
          lead_mechanic_id: string | null;
          ready_for_collection_at: string | null;
          requested_work: string;
          started_at: string | null;
          status: Database["public"]["Enums"]["work_order_status"];
          status_changed_at: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "work_orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      void_line: { Args: { line_id: string; reason: string }; Returns: string };
      work_order_timeline: {
        Args: { max_rows?: number; work_order_id: string };
        Returns: {
          actor_display_name: string;
          actor_staff_id: string;
          created_at: string;
          event_type: Database["public"]["Enums"]["work_order_event_type"];
          id: number;
          payload: Json;
          subject_display_name: string;
          subject_staff_id: string;
        }[];
      };
    };
    Enums: {
      assignment_role: "lead" | "additional";
      attachment_entity:
        "bike" | "work_order" | "product" | "inventory_unit" | "customer" | "consignment_item";
      attachment_event_type: "created" | "visibility_changed" | "caption_changed" | "deleted";
      attachment_visibility: "internal" | "customer" | "public";
      bike_ownership_event_type: "registered" | "transferred";
      category_kind: "service" | "product";
      customer_job_status:
        | "received"
        | "awaiting_customer"
        | "awaiting_parts"
        | "in_progress"
        | "completed"
        | "ready_for_collection"
        | "collected";
      line_type: "service" | "inventory" | "manual";
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
      work_order_event_type:
        | "checked_in"
        | "status_changed"
        | "completed"
        | "ready_for_collection"
        | "collected"
        | "cancelled"
        | "reopened"
        | "assignment_changed"
        | "note_added"
        | "diagnosis_added"
        | "details_changed"
        | "approval_flagged"
        | "photo_added"
        | "photo_removed"
        | "line_added"
        | "line_voided"
        | "stock_consumed"
        | "stock_reversed";
      work_order_note_kind: "note" | "diagnosis";
      work_order_status:
        | "received"
        | "diagnosing"
        | "awaiting_customer"
        | "awaiting_parts"
        | "ready_to_start"
        | "in_progress"
        | "paused"
        | "completed"
        | "ready_for_collection"
        | "collected"
        | "cancelled";
    };
    CompositeTypes: {
      customer_profile: {
        id: string | null;
        first_name: string | null;
        last_name: string | null;
        display_name: string | null;
        email: string | null;
        phone: string | null;
        created_at: string | null;
      };
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
      assignment_role: ["lead", "additional"],
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
      category_kind: ["service", "product"],
      customer_job_status: [
        "received",
        "awaiting_customer",
        "awaiting_parts",
        "in_progress",
        "completed",
        "ready_for_collection",
        "collected",
      ],
      line_type: ["service", "inventory", "manual"],
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
      work_order_event_type: [
        "checked_in",
        "status_changed",
        "completed",
        "ready_for_collection",
        "collected",
        "cancelled",
        "reopened",
        "assignment_changed",
        "note_added",
        "diagnosis_added",
        "details_changed",
        "approval_flagged",
        "photo_added",
        "photo_removed",
        "line_added",
        "line_voided",
        "stock_consumed",
        "stock_reversed",
      ],
      work_order_note_kind: ["note", "diagnosis"],
      work_order_status: [
        "received",
        "diagnosing",
        "awaiting_customer",
        "awaiting_parts",
        "ready_to_start",
        "in_progress",
        "paused",
        "completed",
        "ready_for_collection",
        "collected",
        "cancelled",
      ],
    },
  },
} as const;
