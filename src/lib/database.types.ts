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
          {
            foreignKeyName: "bikes_inventory_unit_id_fkey";
            columns: ["inventory_unit_id"];
            isOneToOne: false;
            referencedRelation: "inventory_unit_costs";
            referencedColumns: ["unit_id"];
          },
          {
            foreignKeyName: "bikes_inventory_unit_id_fkey";
            columns: ["inventory_unit_id"];
            isOneToOne: false;
            referencedRelation: "inventory_units";
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
      inventory_movements: {
        Row: {
          consignment_item_id: string | null;
          correlation_id: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          id: number;
          inventory_unit_id: string | null;
          location_id: string;
          movement_type: Database["public"]["Enums"]["movement_type"];
          product_id: string;
          purchase_receipt_line_id: string | null;
          quantity_delta: number;
          reason: string | null;
          request_id: string | null;
          reversal_of_id: number | null;
          sale_line_id: string | null;
          unit_cost_snapshot: number | null;
          work_order_id: string | null;
          work_order_line_item_id: string | null;
        };
        Insert: {
          consignment_item_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          id?: never;
          inventory_unit_id?: string | null;
          location_id: string;
          movement_type: Database["public"]["Enums"]["movement_type"];
          product_id: string;
          purchase_receipt_line_id?: string | null;
          quantity_delta: number;
          reason?: string | null;
          request_id?: string | null;
          reversal_of_id?: number | null;
          sale_line_id?: string | null;
          unit_cost_snapshot?: number | null;
          work_order_id?: string | null;
          work_order_line_item_id?: string | null;
        };
        Update: {
          consignment_item_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          id?: never;
          inventory_unit_id?: string | null;
          location_id?: string;
          movement_type?: Database["public"]["Enums"]["movement_type"];
          product_id?: string;
          purchase_receipt_line_id?: string | null;
          quantity_delta?: number;
          reason?: string | null;
          request_id?: string | null;
          reversal_of_id?: number | null;
          sale_line_id?: string | null;
          unit_cost_snapshot?: number | null;
          work_order_id?: string | null;
          work_order_line_item_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_movements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_inventory_unit_id_fkey";
            columns: ["inventory_unit_id"];
            isOneToOne: false;
            referencedRelation: "inventory_unit_costs";
            referencedColumns: ["unit_id"];
          },
          {
            foreignKeyName: "inventory_movements_inventory_unit_id_fkey";
            columns: ["inventory_unit_id"];
            isOneToOne: false;
            referencedRelation: "inventory_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product_costs";
            referencedColumns: ["product_id"];
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_reversal_of_id_fkey";
            columns: ["reversal_of_id"];
            isOneToOne: true;
            referencedRelation: "inventory_movement_costs";
            referencedColumns: ["movement_id"];
          },
          {
            foreignKeyName: "inventory_movements_reversal_of_id_fkey";
            columns: ["reversal_of_id"];
            isOneToOne: true;
            referencedRelation: "inventory_movements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_order_totals";
            referencedColumns: ["work_order_id"];
          },
          {
            foreignKeyName: "inventory_movements_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_order_totals_staff";
            referencedColumns: ["work_order_id"];
          },
          {
            foreignKeyName: "inventory_movements_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_work_order_line_item_id_fkey";
            columns: ["work_order_line_item_id"];
            isOneToOne: false;
            referencedRelation: "work_order_line_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_work_order_line_item_id_fkey";
            columns: ["work_order_line_item_id"];
            isOneToOne: false;
            referencedRelation: "work_order_line_items_staff";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_unit_events: {
        Row: {
          actor_staff_id: string | null;
          correlation_id: string | null;
          created_at: string;
          event_type: Database["public"]["Enums"]["inventory_unit_event_type"];
          id: string;
          payload: NonNullable<Json>;
          reason: string | null;
          unit_id: string;
        };
        Insert: {
          actor_staff_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          event_type: Database["public"]["Enums"]["inventory_unit_event_type"];
          id?: string;
          payload?: NonNullable<Json>;
          reason?: string | null;
          unit_id: string;
        };
        Update: {
          actor_staff_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          event_type?: Database["public"]["Enums"]["inventory_unit_event_type"];
          id?: string;
          payload?: NonNullable<Json>;
          reason?: string | null;
          unit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_unit_events_actor_staff_id_fkey";
            columns: ["actor_staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_unit_events_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "inventory_unit_costs";
            referencedColumns: ["unit_id"];
          },
          {
            foreignKeyName: "inventory_unit_events_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "inventory_units";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_units: {
        Row: {
          archived_at: string | null;
          bike_id: string | null;
          condition: string | null;
          consignment_item_id: string | null;
          created_at: string;
          created_by: string | null;
          direct_cost: number | null;
          id: string;
          internal_notes: string | null;
          location_id: string;
          ownership_type: Database["public"]["Enums"]["ownership_type"];
          product_id: string;
          sale_price: number | null;
          serial_key: string | null;
          serial_number: string | null;
          short_id: string;
          sold_at: string | null;
          sold_sale_line_id: string | null;
          status: Database["public"]["Enums"]["unit_status"];
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          bike_id?: string | null;
          condition?: string | null;
          consignment_item_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          direct_cost?: number | null;
          id?: string;
          internal_notes?: string | null;
          location_id: string;
          ownership_type?: Database["public"]["Enums"]["ownership_type"];
          product_id: string;
          sale_price?: number | null;
          serial_key?: never;
          serial_number?: string | null;
          short_id?: string;
          sold_at?: string | null;
          sold_sale_line_id?: string | null;
          status?: Database["public"]["Enums"]["unit_status"];
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          bike_id?: string | null;
          condition?: string | null;
          consignment_item_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          direct_cost?: number | null;
          id?: string;
          internal_notes?: string | null;
          location_id?: string;
          ownership_type?: Database["public"]["Enums"]["ownership_type"];
          product_id?: string;
          sale_price?: number | null;
          serial_key?: never;
          serial_number?: string | null;
          short_id?: string;
          sold_at?: string | null;
          sold_sale_line_id?: string | null;
          status?: Database["public"]["Enums"]["unit_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_units_bike_id_fkey";
            columns: ["bike_id"];
            isOneToOne: true;
            referencedRelation: "bikes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_units_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_units_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_units_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product_costs";
            referencedColumns: ["product_id"];
          },
          {
            foreignKeyName: "inventory_units_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      locations: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["location_kind"];
          name: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["location_kind"];
          name: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["location_kind"];
          name?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_events: {
        Row: {
          actor_staff_id: string | null;
          correlation_id: string | null;
          created_at: string;
          event_type: Database["public"]["Enums"]["product_event_type"];
          id: string;
          payload: NonNullable<Json>;
          product_id: string;
          reason: string | null;
        };
        Insert: {
          actor_staff_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          event_type: Database["public"]["Enums"]["product_event_type"];
          id?: string;
          payload?: NonNullable<Json>;
          product_id: string;
          reason?: string | null;
        };
        Update: {
          actor_staff_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          event_type?: Database["public"]["Enums"]["product_event_type"];
          id?: string;
          payload?: NonNullable<Json>;
          product_id?: string;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "product_events_actor_staff_id_fkey";
            columns: ["actor_staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_events_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product_costs";
            referencedColumns: ["product_id"];
          },
          {
            foreignKeyName: "product_events_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          active: boolean;
          archived_at: string | null;
          brand: string | null;
          category_id: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          default_direct_cost: number | null;
          default_sale_price: number | null;
          description: string | null;
          id: string;
          name: string;
          ownership_type: Database["public"]["Enums"]["ownership_type"];
          public_slug: string | null;
          publication_status: Database["public"]["Enums"]["publication_status"];
          reorder_point: number | null;
          search_text: string | null;
          shopify_product_id: string | null;
          shopify_variant_id: string | null;
          short_id: string;
          sku: string | null;
          sku_key: string | null;
          tracking_type: Database["public"]["Enums"]["tracking_type"];
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          archived_at?: string | null;
          brand?: string | null;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          default_direct_cost?: number | null;
          default_sale_price?: number | null;
          description?: string | null;
          id?: string;
          name: string;
          ownership_type?: Database["public"]["Enums"]["ownership_type"];
          public_slug?: string | null;
          publication_status?: Database["public"]["Enums"]["publication_status"];
          reorder_point?: number | null;
          search_text?: never;
          shopify_product_id?: string | null;
          shopify_variant_id?: string | null;
          short_id?: string;
          sku?: string | null;
          sku_key?: never;
          tracking_type: Database["public"]["Enums"]["tracking_type"];
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          archived_at?: string | null;
          brand?: string | null;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          default_direct_cost?: number | null;
          default_sale_price?: number | null;
          description?: string | null;
          id?: string;
          name?: string;
          ownership_type?: Database["public"]["Enums"]["ownership_type"];
          public_slug?: string | null;
          publication_status?: Database["public"]["Enums"]["publication_status"];
          reorder_point?: number | null;
          search_text?: never;
          shopify_product_id?: string | null;
          shopify_variant_id?: string | null;
          short_id?: string;
          sku?: string | null;
          sku_key?: never;
          tracking_type?: Database["public"]["Enums"]["tracking_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
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
          cost_pending: boolean;
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
          cost_pending?: boolean;
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
          cost_pending?: boolean;
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
            foreignKeyName: "work_order_line_items_source_inventory_unit_id_fkey";
            columns: ["source_inventory_unit_id"];
            isOneToOne: false;
            referencedRelation: "inventory_unit_costs";
            referencedColumns: ["unit_id"];
          },
          {
            foreignKeyName: "work_order_line_items_source_inventory_unit_id_fkey";
            columns: ["source_inventory_unit_id"];
            isOneToOne: false;
            referencedRelation: "inventory_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_line_items_source_product_id_fkey";
            columns: ["source_product_id"];
            isOneToOne: false;
            referencedRelation: "product_costs";
            referencedColumns: ["product_id"];
          },
          {
            foreignKeyName: "work_order_line_items_source_product_id_fkey";
            columns: ["source_product_id"];
            isOneToOne: false;
            referencedRelation: "products";
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
      inventory_movement_costs: {
        Row: {
          currency: string | null;
          movement_id: number | null;
          unit_cost_snapshot: number | null;
        };
        Insert: {
          currency?: string | null;
          movement_id?: number | null;
          unit_cost_snapshot?: number | null;
        };
        Update: {
          currency?: string | null;
          movement_id?: number | null;
          unit_cost_snapshot?: number | null;
        };
        Relationships: [];
      };
      inventory_unit_costs: {
        Row: {
          currency: string | null;
          direct_cost: number | null;
          effective_cost: number | null;
          expected_cult_commons: number | null;
          expected_yield: number | null;
          unit_id: string | null;
        };
        Relationships: [];
      };
      product_costs: {
        Row: {
          currency: string | null;
          default_direct_cost: number | null;
          expected_cult_commons: number | null;
          expected_yield: number | null;
          product_id: string | null;
        };
        Relationships: [];
      };
      selling_prices: {
        Row: {
          currency: string | null;
          inventory_unit_id: string | null;
          product_id: string | null;
          selling_price: number | null;
        };
        Relationships: [];
      };
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
          cost_pending: boolean | null;
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
          cost_pending?: boolean | null;
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
          cost_pending?: boolean | null;
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
            foreignKeyName: "work_order_line_items_source_inventory_unit_id_fkey";
            columns: ["source_inventory_unit_id"];
            isOneToOne: false;
            referencedRelation: "inventory_unit_costs";
            referencedColumns: ["unit_id"];
          },
          {
            foreignKeyName: "work_order_line_items_source_inventory_unit_id_fkey";
            columns: ["source_inventory_unit_id"];
            isOneToOne: false;
            referencedRelation: "inventory_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_line_items_source_product_id_fkey";
            columns: ["source_product_id"];
            isOneToOne: false;
            referencedRelation: "product_costs";
            referencedColumns: ["product_id"];
          },
          {
            foreignKeyName: "work_order_line_items_source_product_id_fkey";
            columns: ["source_product_id"];
            isOneToOne: false;
            referencedRelation: "products";
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
          cost_pending_count: number | null;
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
      add_inventory_line: {
        Args: {
          inventory_unit_id?: string;
          line_id: string;
          location_id?: string;
          product_id: string;
          quantity?: number;
          unit_sale_price?: unknown;
          work_order_id: string;
        };
        Returns: Database["public"]["CompositeTypes"]["inventory_line_result"];
        SetofOptions: {
          from: "*";
          to: "inventory_line_result";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
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
          note_id: string;
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
      adjust_stock: {
        Args: {
          location_id: string;
          movement_type: Database["public"]["Enums"]["movement_type"];
          product_id: string;
          quantity_delta: number;
          reason: string;
          request_id: string;
          unit_cost?: unknown;
        };
        Returns: {
          movement_id: number;
          on_hand: number;
        }[];
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
      create_unique_unit: {
        Args: {
          bike_id?: string;
          condition?: string;
          direct_cost?: unknown;
          location_id: string;
          product_id: string;
          reason?: string;
          sale_price?: unknown;
          serial_number?: string;
          unit_id: string;
        };
        Returns: Database["public"]["CompositeTypes"]["unique_unit_result"];
        SetofOptions: {
          from: "*";
          to: "unique_unit_result";
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
        Args: { effective_from?: string; rate: unknown; rate_id: string };
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
      set_publication_status: {
        Args: {
          product_id: string;
          reason?: string;
          status: Database["public"]["Enums"]["publication_status"];
        };
        Returns: Database["public"]["CompositeTypes"]["publication_result"];
        SetofOptions: {
          from: "*";
          to: "publication_result";
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
      split_unit_from_stock: {
        Args: {
          condition?: string;
          location_id: string;
          name: string;
          new_product_id: string;
          reason: string;
          sale_price?: unknown;
          serial_number?: string;
          source_product_id: string;
          unit_id: string;
        };
        Returns: Database["public"]["CompositeTypes"]["split_unit_result"];
        SetofOptions: {
          from: "*";
          to: "split_unit_result";
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
      transfer_stock: {
        Args: {
          from_location_id: string;
          inventory_unit_id?: string;
          product_id: string;
          quantity: number;
          reason?: string;
          request_id: string;
          to_location_id: string;
        };
        Returns: {
          location_id: string;
          movement_id: number;
          quantity_delta: number;
        }[];
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
      write_off_unit: {
        Args: { reason: string; request_id: string; unit_id: string };
        Returns: Database["public"]["CompositeTypes"]["unit_status_result"];
        SetofOptions: {
          from: "*";
          to: "unit_status_result";
          isOneToOne: true;
          isSetofReturn: false;
        };
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
      inventory_unit_event_type:
        | "created"
        | "status_changed"
        | "moved"
        | "details_changed"
        | "price_changed"
        | "cost_changed"
        | "archived"
        | "unarchived";
      line_type: "service" | "inventory" | "manual";
      location_kind: "shop_floor" | "workshop" | "storage" | "offsite";
      movement_type:
        | "purchase_received"
        | "job_consumption"
        | "retail_sale"
        | "online_sale"
        | "stock_adjustment"
        | "damaged"
        | "return"
        | "consignment_received"
        | "consignment_returned"
        | "transfer"
        | "reversal";
      ownership_type: "shop_owned" | "consignment" | "customer_owned";
      permission_key:
        | "view_costs"
        | "manage_inventory"
        | "adjust_stock"
        | "manage_consignments"
        | "manage_purchasing"
        | "manage_staff"
        | "view_financial_reports";
      product_event_type:
        | "created"
        | "details_changed"
        | "price_changed"
        | "cost_changed"
        | "publication_changed"
        | "archived"
        | "unarchived";
      publication_status: "draft" | "internal_only" | "public" | "sold" | "archived";
      staff_event_type:
        | "created"
        | "details_changed"
        | "role_changed"
        | "deactivated"
        | "reactivated"
        | "permission_granted"
        | "permission_revoked";
      staff_role: "admin" | "staff";
      tracking_type: "quantity" | "unique";
      unit_status:
        | "available"
        | "reserved"
        | "sold"
        | "returned_to_consignor"
        | "written_off"
        | "held_for_customer";
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
      inventory_line_result: {
        line_id: string | null;
        movement_id: number | null;
        location_id: string | null;
        on_hand_after: number | null;
        replayed: boolean | null;
      };
      publication_result: {
        product_id: string | null;
        publication_status: Database["public"]["Enums"]["publication_status"] | null;
        public_slug: string | null;
      };
      split_unit_result: {
        product_id: string | null;
        product_short_id: string | null;
        unit_id: string | null;
        unit_short_id: string | null;
      };
      unique_unit_result: {
        unit_id: string | null;
        short_id: string | null;
      };
      unit_status_result: {
        unit_id: string | null;
        status: Database["public"]["Enums"]["unit_status"] | null;
      };
    };
  };
  reporting: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      low_stock: {
        Row: {
          name: string | null;
          negative_locations: number | null;
          on_hand: number | null;
          product_id: string | null;
          reorder_point: number | null;
          short_id: string | null;
          shortfall: number | null;
          sku: string | null;
        };
        Relationships: [];
      };
      product_stock: {
        Row: {
          active: boolean | null;
          archived_at: string | null;
          available_units: number | null;
          below_reorder: boolean | null;
          held_units: number | null;
          name: string | null;
          negative_locations: number | null;
          on_hand: number | null;
          product_id: string | null;
          reorder_point: number | null;
          short_id: string | null;
          sku: string | null;
          tracking_type: Database["public"]["Enums"]["tracking_type"] | null;
        };
        Relationships: [];
      };
      public_items: {
        Row: {
          availability: string | null;
          brand: string | null;
          category: string | null;
          condition: string | null;
          currency: string | null;
          description: string | null;
          kind: string | null;
          name: string | null;
          photos: Json | null;
          sale_price: number | null;
          short_id: string | null;
          slug: string | null;
          updated_at: string | null;
        };
        Relationships: [];
      };
      stock_levels: {
        Row: {
          last_movement_at: string | null;
          location_id: string | null;
          on_hand: number | null;
          product_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_movements_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "low_stock";
            referencedColumns: ["product_id"];
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "product_stock";
            referencedColumns: ["product_id"];
          },
        ];
      };
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
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
      inventory_unit_event_type: [
        "created",
        "status_changed",
        "moved",
        "details_changed",
        "price_changed",
        "cost_changed",
        "archived",
        "unarchived",
      ],
      line_type: ["service", "inventory", "manual"],
      location_kind: ["shop_floor", "workshop", "storage", "offsite"],
      movement_type: [
        "purchase_received",
        "job_consumption",
        "retail_sale",
        "online_sale",
        "stock_adjustment",
        "damaged",
        "return",
        "consignment_received",
        "consignment_returned",
        "transfer",
        "reversal",
      ],
      ownership_type: ["shop_owned", "consignment", "customer_owned"],
      permission_key: [
        "view_costs",
        "manage_inventory",
        "adjust_stock",
        "manage_consignments",
        "manage_purchasing",
        "manage_staff",
        "view_financial_reports",
      ],
      product_event_type: [
        "created",
        "details_changed",
        "price_changed",
        "cost_changed",
        "publication_changed",
        "archived",
        "unarchived",
      ],
      publication_status: ["draft", "internal_only", "public", "sold", "archived"],
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
      tracking_type: ["quantity", "unique"],
      unit_status: [
        "available",
        "reserved",
        "sold",
        "returned_to_consignor",
        "written_off",
        "held_for_customer",
      ],
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
  reporting: {
    Enums: {},
  },
} as const;
