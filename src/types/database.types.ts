export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type TbbRole =
  | 'OWNER'
  | 'ADMIN'
  | 'PRODUCTION_MANAGER'
  | 'QC_SPECIALIST'
  | 'EDITOR'
  | 'CLIENT_VIEWER';

export type TaskStatus =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'IN_QC'
  | 'READY_TO_DELIVER'
  | 'CLIENT_REVIEW'
  | 'COMPLETED'
  | 'CLOSED';

export type TaskPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          avatar_url: string | null;
          role: TbbRole;
          phone: string | null;
          timezone: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          avatar_url?: string | null;
          role?: TbbRole;
          phone?: string | null;
          timezone?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          avatar_url?: string | null;
          role?: TbbRole;
          phone?: string | null;
          timezone?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          logo_url: string | null;
          owner_id: string;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          description?: string | null;
          logo_url?: string | null;
          owner_id: string;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          description?: string | null;
          logo_url?: string | null;
          owner_id?: string;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'workspaces_owner_id_fkey';
            columns: ['owner_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      workspace_members: {
        Row: {
          workspace_id: string;
          user_id: string;
          role: TbbRole;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role?: TbbRole;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          workspace_id?: string;
          user_id?: string;
          role?: TbbRole;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'workspace_members_workspace_id_fkey';
            columns: ['workspace_id'];
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'workspace_members_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      spaces: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          slug: string;
          description: string | null;
          icon: string;
          color: string;
          is_private: boolean;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          slug: string;
          description?: string | null;
          icon?: string;
          color?: string;
          is_private?: boolean;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          slug?: string;
          description?: string | null;
          icon?: string;
          color?: string;
          is_private?: boolean;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'spaces_workspace_id_fkey';
            columns: ['workspace_id'];
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          }
        ];
      };
      folders: {
        Row: {
          id: string;
          workspace_id: string;
          space_id: string;
          name: string;
          description: string | null;
          position: number;
          is_collapsed_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          /** Derived by a database trigger; any value sent is ignored. */
          workspace_id?: string;
          space_id: string;
          name: string;
          description?: string | null;
          position?: number;
          is_collapsed_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          space_id?: string;
          name?: string;
          description?: string | null;
          position?: number;
          is_collapsed_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'folders_workspace_id_fkey';
            columns: ['workspace_id'];
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'folders_space_id_fkey';
            columns: ['space_id'];
            referencedRelation: 'spaces';
            referencedColumns: ['id'];
          }
        ];
      };
      lists: {
        Row: {
          id: string;
          workspace_id: string;
          space_id: string;
          folder_id: string | null;
          name: string;
          description: string | null;
          color: string;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          /** Derived by a database trigger; any value sent is ignored. */
          workspace_id?: string;
          space_id: string;
          folder_id?: string | null;
          name: string;
          description?: string | null;
          color?: string;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          space_id?: string;
          folder_id?: string | null;
          name?: string;
          description?: string | null;
          color?: string;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'lists_workspace_id_fkey';
            columns: ['workspace_id'];
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lists_space_id_fkey';
            columns: ['space_id'];
            referencedRelation: 'spaces';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lists_folder_space_fkey';
            columns: ['folder_id', 'space_id'];
            referencedRelation: 'folders';
            referencedColumns: ['id', 'space_id'];
          }
        ];
      };
      tasks: {
        Row: {
          id: string;
          workspace_id: string;
          list_id: string;
          title: string;
          description: string | null;
          status: TaskStatus;
          priority: TaskPriority;
          position: number;
          due_date: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          /** Derived by a database trigger; any value sent is ignored. */
          workspace_id?: string;
          list_id: string;
          title: string;
          description?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          position?: number;
          due_date?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          list_id?: string;
          title?: string;
          description?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          position?: number;
          due_date?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tasks_workspace_id_fkey';
            columns: ['workspace_id'];
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_list_id_fkey';
            columns: ['list_id'];
            referencedRelation: 'lists';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_created_by_fkey';
            columns: ['created_by'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      subtasks: {
        Row: {
          id: string;
          workspace_id: string;
          task_id: string;
          title: string;
          description: string | null;
          is_completed: boolean;
          position: number;
          due_date: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          /** Derived by a database trigger; any value sent is ignored. */
          workspace_id?: string;
          task_id: string;
          title: string;
          description?: string | null;
          is_completed?: boolean;
          position?: number;
          due_date?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          task_id?: string;
          title?: string;
          description?: string | null;
          is_completed?: boolean;
          position?: number;
          due_date?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subtasks_workspace_id_fkey';
            columns: ['workspace_id'];
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subtasks_task_id_fkey';
            columns: ['task_id'];
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subtasks_created_by_fkey';
            columns: ['created_by'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: Record<string, never>;
    // Authorization helpers live in the non-exposed `private` schema (migration 4),
    // so the Data API exposes no callable functions.
    Functions: { [_ in never]: never };
    Enums: {
      tbb_role: TbbRole;
      task_status: TaskStatus;
      task_priority: TaskPriority;
    };
  };
}
