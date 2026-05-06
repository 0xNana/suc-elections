import { createClient } from "@supabase/supabase-js";

import { generateUniqueCode } from "../utils/activationCode.js";

export type StudentRole = "voter" | "aspirant_rep" | "ec_admin";

export interface StudentSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type: string;
}

export interface ActivationUserInput {
  studentId: string;
  password: string;
  role: StudentRole;
  canVote: boolean;
  fullName: string;
  voterTokenHash: string;
}

export interface ActivationUser {
  authUserId: string;
  email: string;
}

export interface AuthProvider {
  signInWithStudentId(studentId: string, password: string): Promise<StudentSession>;
  createActivationUser(input: ActivationUserInput): Promise<ActivationUser>;
  deleteUser(authUserId: string): Promise<void>;
  updateUserRole(input: {
    authUserId: string;
    studentId: string;
    role: StudentRole;
    canVote: boolean;
    voterTokenHash: string;
    fullName: string;
  }): Promise<void>;
  signOut(accessToken: string): Promise<void>;
  generateUniqueActivationCode(): Promise<string>;
}

export function buildSyntheticEmail(studentId: string) {
  return `${studentId}@suc-vote.internal`;
}

export class SupabaseAuthProvider implements AuthProvider {
  private readonly adminClient;
  private readonly publicClient;

  public constructor(
    private readonly supabaseUrl: string,
    private readonly anonKey: string,
    private readonly serviceRoleKey: string
  ) {
    this.adminClient = createClient(this.supabaseUrl, this.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    this.publicClient = createClient(this.supabaseUrl, this.anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  public async signInWithStudentId(studentId: string, password: string): Promise<StudentSession> {
    const signInResponse = await this.publicClient.auth.signInWithPassword({
      email: buildSyntheticEmail(studentId),
      password
    });

    if (signInResponse.error || !signInResponse.data.session) {
      throw signInResponse.error ?? new Error("Unable to create session");
    }

    const { access_token, refresh_token, expires_at, expires_in, token_type } = signInResponse.data.session;

    const session: StudentSession = {
      access_token,
      refresh_token,
      token_type
    };

    if (expires_at !== null && expires_at !== undefined) {
      session.expires_at = expires_at;
    }

    if (expires_in !== null && expires_in !== undefined) {
      session.expires_in = expires_in;
    }

    return session;
  }

  public async createActivationUser(input: ActivationUserInput): Promise<ActivationUser> {
    const email = buildSyntheticEmail(input.studentId);
    const existing = await this.adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (existing.error) {
      throw existing.error;
    }

    const match = existing.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) {
      const updated = await this.adminClient.auth.admin.updateUserById(match.id, {
        password: input.password,
        email_confirm: true,
        user_metadata: {
          full_name: input.fullName
        },
        app_metadata: {
          role: input.role,
          can_vote: input.canVote,
          student_id: input.studentId,
          voter_token: input.voterTokenHash
        }
      });

      if (updated.error || !updated.data.user) {
        throw updated.error ?? new Error("Unable to update auth user");
      }

      return {
        authUserId: updated.data.user.id,
        email
      };
    }

    const created = await this.adminClient.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        full_name: input.fullName
      },
      app_metadata: {
        role: input.role,
        can_vote: input.canVote,
        student_id: input.studentId,
        voter_token: input.voterTokenHash
      }
    });

    if (created.error || !created.data.user) {
      throw created.error ?? new Error("Unable to create auth user");
    }

    return {
      authUserId: created.data.user.id,
      email
    };
  }

  public async deleteUser(authUserId: string) {
    const deleted = await this.adminClient.auth.admin.deleteUser(authUserId);
    if (deleted.error) {
      throw deleted.error;
    }
  }

  public async updateUserRole(input: {
    authUserId: string;
    studentId: string;
    role: StudentRole;
    canVote: boolean;
    voterTokenHash: string;
    fullName: string;
  }) {
    const updated = await this.adminClient.auth.admin.updateUserById(input.authUserId, {
      user_metadata: {
        full_name: input.fullName
      },
      app_metadata: {
        role: input.role,
        can_vote: input.canVote,
        student_id: input.studentId,
        voter_token: input.voterTokenHash
      }
    });

    if (updated.error) {
      throw updated.error;
    }
  }

  public async signOut(accessToken: string) {
    const signedOut = await this.adminClient.auth.admin.signOut(accessToken);
    if (signedOut.error) {
      throw signedOut.error;
    }
  }

  public async generateUniqueActivationCode() {
    return generateUniqueCode(this.adminClient as never);
  }
}
