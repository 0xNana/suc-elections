import jwt from "jsonwebtoken";

export interface SessionClaims extends jwt.JwtPayload {
  sub: string;
  role?: string;
  can_vote?: boolean;
  student_id?: string;
  voter_token?: string;
  app_metadata?: {
    role?: string | undefined;
    can_vote?: boolean | undefined;
    student_id?: string | undefined;
    voter_token?: string | undefined;
  };
}

export function verifyAccessToken(token: string, secret: string): SessionClaims {
  const claims = jwt.verify(token, secret) as SessionClaims;

  if (!claims.sub) {
    throw new Error("Token is missing subject");
  }

  return claims;
}

export function getRoleFromClaims(claims: SessionClaims) {
  return claims.role ?? claims.app_metadata?.role ?? null;
}

export function getStudentIdFromClaims(claims: SessionClaims) {
  return claims.student_id ?? claims.app_metadata?.student_id ?? null;
}

export function canVoteFromClaims(claims: SessionClaims) {
  return claims.can_vote ?? claims.app_metadata?.can_vote ?? false;
}
