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

export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:5' | 'OTHER';

export type AssigneeRole = 'EDITOR' | 'QC_REVIEWER';

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
          aspect_ratio: AspectRatio | null;
          raw_footage_link: string | null;
          project_file_link: string | null;
          review_link: string | null;
          final_export_link: string | null;
          client_deadline: string | null;
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
          aspect_ratio?: AspectRatio | null;
          raw_footage_link?: string | null;
          project_file_link?: string | null;
          review_link?: string | null;
          final_export_link?: string | null;
          client_deadline?: string | null;
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
          aspect_ratio?: AspectRatio | null;
          raw_footage_link?: string | null;
          project_file_link?: string | null;
          review_link?: string | null;
          final_export_link?: string | null;
          client_deadline?: string | null;
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
      task_assignees: {
        Row: {
          task_id: string;
          role_type: AssigneeRole;
          user_id: string;
          workspace_id: string;
          assigned_by: string | null;
          assigned_at: string;
        };
        Insert: {
          task_id: string;
          role_type: AssigneeRole;
          user_id: string;
          /** Derived by a database trigger; any value sent is ignored. */
          workspace_id?: string;
          /** Set by a database trigger to the caller. */
          assigned_by?: string | null;
          assigned_at?: string;
        };
        Update: {
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'task_assignees_task_id_fkey';
            columns: ['task_id'];
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_assignees_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      teams: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          color: string;
          lead_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string | null;
          color?: string;
          lead_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          description?: string | null;
          color?: string;
          lead_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'teams_workspace_id_fkey';
            columns: ['workspace_id'];
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'teams_lead_id_fkey';
            columns: ['lead_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      team_members: {
        Row: {
          team_id: string;
          user_id: string;
          workspace_id: string;
          created_at: string;
        };
        Insert: {
          team_id: string;
          user_id: string;
          /** Derived by a database trigger; any value sent is ignored. */
          workspace_id?: string;
          created_at?: string;
        };
        Update: {
          team_id?: string;
          user_id?: string;
          workspace_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'team_members_team_id_fkey';
            columns: ['team_id'];
            referencedRelation: 'teams';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'team_members_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'team_members_workspace_id_fkey';
            columns: ['workspace_id'];
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          }
        ];
      };
      workspace_invitations: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          role: TbbRole;
          invited_by: string | null;
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          email: string;
          role?: TbbRole;
          /** Stamped by a database trigger; any value sent is ignored. */
          invited_by?: string | null;
          /** Always reset by a database trigger on insert. */
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
        };
        // No client UPDATE grant exists: invitations are created, accepted by the database, or revoked.
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: 'workspace_invitations_workspace_id_fkey';
            columns: ['workspace_id'];
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'workspace_invitations_invited_by_fkey';
            columns: ['invited_by'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'workspace_invitations_accepted_by_fkey';
            columns: ['accepted_by'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: Record<string, never>;
    // Authorization helpers live in the non-exposed `private` schema (migration 4). The only
    // function exposed through the Data API is a SECURITY INVOKER one (RLS applies to the caller).
    Functions: {
      // Atomic sibling re-sequencing (migration 6). SECURITY INVOKER: the caller's RLS applies.
      reorder_hierarchy: {
        Args: { kind: string; ids: string[] };
        Returns: number;
      };
      // Task engine (migration 7). All SECURITY INVOKER.
      create_task: {
        Args: {
          p_list_id: string;
          p_title: string;
          p_description?: string | null;
          p_priority?: string;
          p_aspect_ratio?: string | null;
          p_raw_footage_link?: string | null;
          p_project_file_link?: string | null;
          p_review_link?: string | null;
          p_final_export_link?: string | null;
          p_due_date?: string | null;
          p_client_deadline?: string | null;
          p_editor_id?: string | null;
          p_qc_id?: string | null;
        };
        Returns: Database['public']['Tables']['tasks']['Row'];
      };
      set_task_assignee: {
        Args: { p_task_id: string; p_role_type: string; p_user_id: string | null };
        Returns: undefined;
      };
      move_task: {
        Args: { p_task_id: string; p_direction: string };
        Returns: boolean;
      };
    };
    Enums: {
      tbb_role: TbbRole;
      task_status: TaskStatus;
      task_priority: TaskPriority;
    };
  };
}
