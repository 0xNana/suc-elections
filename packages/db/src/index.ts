export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      students: {
        Row: {
          id: string;
          student_id: string;
          auth_user_id: string | null;
          activation_code: string | null;
          activated_at: string | null;
          role: "voter" | "aspirant_rep" | "ec_admin";
          can_vote: boolean;
          voter_token: string;
          full_name: string;
          is_eligible: boolean;
          created_at: string;
        };
      };
      positions: {
        Row: {
          id: string;
          title: string;
          display_order: number;
          is_active: boolean;
        };
      };
      candidates: {
        Row: {
          id: string;
          position_id: string;
          full_name: string;
          photo_url: string | null;
          ballot_num: number;
          manifesto_url: string | null;
        };
      };
      votes: {
        Row: {
          id: string;
          position_id: string;
          candidate_id: string;
          voter_token: string;
          cast_at: string;
        };
      };
      audit_log: {
        Row: {
          id: number;
          event_type: string;
          actor_token: string | null;
          ip_address: string | null;
          payload_hash: string | null;
          metadata: Json | null;
          logged_at: string;
        };
      };
      election_config: {
        Row: {
          id: string;
          poll_opens: string;
          poll_closes: string;
          is_locked: boolean;
          results_counted_at: string | null;
          results_counted_by: string | null;
          results_released_at: string | null;
          results_released_by: string | null;
        };
      };
      result_verifications: {
        Row: {
          id: string;
          election_config_id: string;
          verifier_auth_user_id: string;
          message: string;
          verified_at: string;
        };
      };
    };
    Views: {
      results: {
        Row: {
          position_id: string;
          position: string;
          display_order: number;
          candidate_id: string;
          candidate: string;
          ballot_num: number;
          photo_url: string | null;
          vote_count: number;
        };
      };
    };
  };
}
