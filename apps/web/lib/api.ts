import type {
  AdminStudentsResponse,
  ChangeRoleResponse,
  AuditResponse,
  BallotResponse,
  EcConfigResponse,
  EcCountResponse,
  EcReleaseResponse,
  EcResultsResponse,
  IssueCodesResponse,
  ResetActivationResponse,
  RepVerifyResponse,
  RepResultsResponse,
  RepRegisterResponse,
  ResultsResponse,
  SessionResponse,
  VoteConfirmation
} from "@suc-vote/shared";

export class BackendError extends Error {
  public constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response) {
  const contentType = response.headers.get("content-type");
  const payload =
    contentType?.includes("application/json") === true ? ((await response.json()) as T) : null;

  if (!response.ok) {
    throw new BackendError(
      response.status,
      (payload as { message?: string } | null)?.message ?? "Request failed"
    );
  }

  return payload as T;
}

export async function backendRequest<T>(
  path: string,
  input?: {
    accessToken?: string;
    body?: unknown;
    method?: "GET" | "POST";
  }
) {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");

  if (input?.accessToken) {
    headers.set("Authorization", `Bearer ${input.accessToken}`);
  }

  const requestInit: RequestInit = {
    method: input?.method ?? "GET",
    headers,
    cache: "no-store"
  };

  if (input?.body !== undefined) {
    requestInit.body = JSON.stringify(input.body);
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, requestInit);

  return parseResponse<T>(response);
}

export function loginStudent(studentId: string, password: string) {
  return backendRequest<SessionResponse>("/auth/login", {
    method: "POST",
    body: {
      student_id: studentId,
      password
    }
  });
}

export function activateStudentAccount(
  studentId: string,
  activationCode: string,
  newPassword: string
) {
  return backendRequest<SessionResponse>("/auth/activate", {
    method: "POST",
    body: {
      student_id: studentId,
      activation_code: activationCode,
      new_password: newPassword
    }
  });
}

export function logoutCurrentUser(accessToken: string) {
  return backendRequest<{ message: string }>("/auth/logout", {
    method: "POST",
    accessToken
  });
}

export function issueActivationCodes(
  accessToken: string,
  entries: Array<{
    student_id: string;
    full_name: string;
    role?: "voter" | "aspirant_rep" | "ec_admin";
    can_vote?: boolean;
  }>
) {
  return backendRequest<IssueCodesResponse>("/auth/admin/issue-codes", {
    method: "POST",
    accessToken,
    body: { entries }
  });
}

export function getAdminStudents(
  accessToken: string,
  input?: {
    page?: number;
    pageSize?: number;
    search?: string;
    role?: "voter" | "aspirant_rep" | "ec_admin";
    activation_status?: "all" | "activated" | "pending";
  }
) {
  const query = new URLSearchParams();
  query.set("page", String(input?.page ?? 1));
  query.set("pageSize", String(input?.pageSize ?? 20));
  if (input?.search) query.set("search", input.search);
  if (input?.role) query.set("role", input.role);
  if (input?.activation_status) query.set("activation_status", input.activation_status);

  const suffix = query.toString() ? `?${query.toString()}` : "";
  return backendRequest<AdminStudentsResponse>(`/auth/admin/students${suffix}`, {
    accessToken
  });
}

export function resetStudentActivation(accessToken: string, studentId: string) {
  return backendRequest<ResetActivationResponse>("/auth/admin/reset-activation", {
    method: "POST",
    accessToken,
    body: { student_id: studentId }
  });
}

export function changeStudentRole(
  accessToken: string,
  studentId: string,
  role: "voter" | "aspirant_rep" | "ec_admin",
  canVote?: boolean
) {
  return backendRequest<ChangeRoleResponse>("/auth/admin/change-role", {
    method: "POST",
    accessToken,
    body: { student_id: studentId, role, can_vote: canVote }
  });
}

export function getBallot(accessToken: string) {
  return backendRequest<BallotResponse>("/ballot", {
    accessToken
  });
}

export function castVote(accessToken: string, positionId: string, candidateId: string) {
  return backendRequest<VoteConfirmation>("/vote", {
    method: "POST",
    accessToken,
    body: {
      position_id: positionId,
      candidate_id: candidateId
    }
  });
}

export function getResults() {
  return backendRequest<ResultsResponse>("/results");
}

export function getRepResults(accessToken: string) {
  return backendRequest<RepResultsResponse>("/rep/results", {
    accessToken
  });
}

export function getRepRegister(
  accessToken: string,
  input?: {
    page?: number;
    pageSize?: number;
  }
) {
  const query = new URLSearchParams({
    page: String(input?.page ?? 1),
    pageSize: String(input?.pageSize ?? 20)
  });

  return backendRequest<RepRegisterResponse>(`/rep/register?${query.toString()}`, {
    accessToken
  });
}

export function getEcResults(accessToken: string) {
  return backendRequest<EcResultsResponse>("/ec/results", {
    accessToken
  });
}

export function getEcConfig(accessToken: string) {
  return backendRequest<EcConfigResponse>("/ec/config", {
    accessToken
  });
}

export function saveEcConfig(
  accessToken: string,
  input: { poll_opens: string; poll_closes: string; is_locked: boolean }
) {
  return backendRequest<EcConfigResponse>("/ec/config", {
    method: "POST",
    accessToken,
    body: input
  });
}

export function openEcPoll(accessToken: string) {
  return backendRequest<EcConfigResponse>("/ec/config/open", {
    method: "POST",
    accessToken
  });
}

export function closeEcPoll(accessToken: string) {
  return backendRequest<EcConfigResponse>("/ec/config/close", {
    method: "POST",
    accessToken
  });
}

export function extendEcPoll(accessToken: string, minutes: number) {
  return backendRequest<EcConfigResponse>("/ec/config/extend", {
    method: "POST",
    accessToken,
    body: { minutes }
  });
}

export function releaseEcResults(accessToken: string) {
  return backendRequest<EcReleaseResponse>("/ec/results/release", {
    method: "POST",
    accessToken
  });
}

export function countEcResults(accessToken: string) {
  return backendRequest<EcCountResponse>("/ec/results/count", {
    method: "POST",
    accessToken
  });
}

export function getAudit(
  accessToken: string,
  search = "",
  input?: {
    eventType?: string | undefined;
    page?: number;
    pageSize?: number;
  }
) {
  const query = new URLSearchParams({
    page: String(input?.page ?? 1),
    pageSize: String(input?.pageSize ?? 25)
  });

  if (search.trim()) {
    query.set("search", search.trim());
  }

  if (input?.eventType) {
    query.set("event_type", input.eventType);
  }

  return backendRequest<AuditResponse>(`/audit?${query.toString()}`, {
    accessToken
  });
}

export function verifyRepResults(
  accessToken: string,
  input?: {
    remarks?: string;
  }
) {
  return backendRequest<RepVerifyResponse>("/rep/verify", {
    method: "POST",
    accessToken,
    body: { remarks: input?.remarks }
  });
}
