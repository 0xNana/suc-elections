import { createClient } from "@supabase/supabase-js";

import { verifyAccessToken, type SessionClaims } from "../lib/auth.js";

export interface SessionVerifier {
  verify(token: string): Promise<SessionClaims>;
}

export class JwtSessionVerifier implements SessionVerifier {
  public constructor(private readonly secret: string) {}

  public async verify(token: string) {
    return verifyAccessToken(token, this.secret);
  }
}

export class SupabaseSessionVerifier implements SessionVerifier {
  private readonly client;

  public constructor(
    private readonly supabaseUrl: string,
    private readonly serviceRoleKey: string
  ) {
    this.client = createClient(this.supabaseUrl, this.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  public async verify(token: string) {
    const response = await this.client.auth.getUser(token);
    if (response.error || !response.data.user) {
      throw response.error ?? new Error("Invalid session token");
    }

    const claims: SessionClaims = {
      sub: response.data.user.id
    };

    const role = response.data.user.app_metadata?.role;
    if (typeof role === "string") {
      claims.role = role;
    }

    const canVote = response.data.user.app_metadata?.can_vote;
    if (typeof canVote === "boolean") {
      claims.can_vote = canVote;
    }

    const studentId = response.data.user.app_metadata?.student_id;
    if (typeof studentId === "string") {
      claims.student_id = studentId;
    }

    const voterToken = response.data.user.app_metadata?.voter_token;
    if (typeof voterToken === "string") {
      claims.voter_token = voterToken;
    }

    if (response.data.user.app_metadata) {
      claims.app_metadata = response.data.user.app_metadata as {
        role?: string | undefined;
        can_vote?: boolean | undefined;
        student_id?: string | undefined;
        voter_token?: string | undefined;
      };
    }

    return claims;
  }
}
