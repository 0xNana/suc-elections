import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const studentIdSchema = z.string().trim().min(3).max(20);
export const studentIdStrictSchema = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .regex(/^[A-Za-z0-9]+$/);
export const activationCodeSchema = z.string().trim().toUpperCase().regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
export const userRoleSchema = z.enum(["voter", "aspirant_rep", "ec_admin"]);
export const captchaTokenSchema = z.string().trim().min(1);

export const activationPasswordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export const loginRequestSchema = z.object({
  student_id: studentIdStrictSchema,
  password: z.string().min(8).max(128),
  captcha_token: captchaTokenSchema
});

export const activationRequestSchema = z.object({
  student_id: studentIdStrictSchema,
  activation_code: activationCodeSchema,
  new_password: activationPasswordSchema,
  captcha_token: captchaTokenSchema
});

export const issueCodesEntrySchema = z.object({
  student_id: studentIdStrictSchema,
  full_name: z.string().trim().min(2).max(200),
  role: userRoleSchema.default("voter"),
  can_vote: z.boolean().optional()
});

export const issueCodesRequestSchema = z.object({
  entries: z.array(issueCodesEntrySchema).min(1)
});

export const issueCodesResponseSchema = z.object({
  issued: z.array(
    z.object({
      student_id: z.string(),
      full_name: z.string(),
      role: userRoleSchema,
      activation_code: z.string(),
      can_vote: z.boolean()
    })
  ),
  skipped: z.array(
    z.object({
      student_id: z.string(),
      reason: z.string()
    })
  )
});

export const resetActivationRequestSchema = z.object({
  student_id: studentIdStrictSchema
});

export const resetActivationResponseSchema = z.object({
  student_id: z.string(),
  activation_code: z.string()
});

export const changeRoleRequestSchema = z.object({
  student_id: studentIdStrictSchema,
  role: userRoleSchema,
  can_vote: z.boolean().optional()
});

export const changeRoleResponseSchema = z.object({
  student_id: z.string(),
  role: userRoleSchema,
  can_vote: z.boolean()
});

export const adminStudentsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  role: userRoleSchema.optional(),
  activation_status: z.enum(["all", "activated", "pending"]).default("all")
});

export const adminStudentRowSchema = z.object({
  student_id: z.string(),
  full_name: z.string(),
  role: userRoleSchema,
  can_vote: z.boolean(),
  activated: z.boolean(),
  activated_at: z.string().datetime().nullable(),
  last_login_at: z.string().datetime().nullable()
});

export const adminStudentsResponseSchema = z.object({
  students: z.array(adminStudentRowSchema)
});

export const voteRequestSchema = z.object({
  position_id: uuidSchema,
  candidate_id: uuidSchema
});

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional()
});

export const electionWindowSchema = z.object({
  id: uuidSchema.optional(),
  poll_opens: z.string().datetime(),
  poll_closes: z.string().datetime(),
  is_locked: z.boolean(),
  results_counted_at: z.string().datetime().nullable().optional(),
  results_counted_by: z.string().uuid().nullable().optional(),
  results_released_at: z.string().datetime().nullable().optional(),
  results_released_by: z.string().uuid().nullable().optional()
});

export const ballotCandidateSchema = z.object({
  id: uuidSchema,
  full_name: z.string(),
  photo_url: z.string().url().nullable(),
  ballot_num: z.number().int().positive(),
  manifesto_url: z.string().url().nullable()
});

export const ballotPositionSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  display_order: z.number().int(),
  has_voted: z.boolean(),
  candidates: z.array(ballotCandidateSchema)
});

export const ballotResponseSchema = z.object({
  election: electionWindowSchema,
  student: z.object({
    student_id: z.string(),
    full_name: z.string(),
    is_eligible: z.boolean(),
    can_vote: z.boolean()
  }),
  voted_positions: z.array(uuidSchema),
  positions: z.array(ballotPositionSchema)
});

export const sessionResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.number().int().optional(),
  expires_in: z.number().int().optional(),
  token_type: z.string().default("bearer"),
  role: userRoleSchema.optional(),
  can_vote: z.boolean().optional(),
  student: z.object({
    student_id: z.string(),
    full_name: z.string()
  })
});

export const voteConfirmationSchema = z.object({
  confirmation_hash: z.string().min(16),
  cast_at: z.string().datetime(),
  position_id: uuidSchema,
  candidate_id: uuidSchema
});

export const resultsRowSchema = z.object({
  position_id: uuidSchema,
  position: z.string(),
  display_order: z.number().int(),
  candidate_id: uuidSchema,
  candidate: z.string(),
  ballot_num: z.number().int().positive(),
  photo_url: z.string().url().nullable(),
  vote_count: z.number().int().nonnegative()
});

export const resultsResponseSchema = z.object({
  rows: z.array(resultsRowSchema),
  refreshed_at: z.string().datetime()
});

export const repResultsSummarySchema = z.object({
  total_votes_cast: z.number().int().nonnegative(),
  total_eligible: z.number().int().nonnegative()
});

export const repResultsResponseSchema = z.object({
  rows: z.array(resultsRowSchema),
  summary: repResultsSummarySchema,
  count_state: z.object({
    is_results_counted: z.boolean(),
    results_counted_at: z.string().datetime().nullable(),
    results_counted_by: z.string().uuid().nullable()
  }),
  verification_state: z.object({
    is_verified_by_any_rep: z.boolean(),
    total_verifications: z.number().int().nonnegative()
  }),
  refreshed_at: z.string().datetime()
});

export const ecConfigUpdateSchema = z
  .object({
    poll_opens: z.string().datetime(),
    poll_closes: z.string().datetime(),
    is_locked: z.boolean()
  })
  .refine((value) => new Date(value.poll_opens).getTime() < new Date(value.poll_closes).getTime(), {
    message: "Poll open time must be before poll close time",
    path: ["poll_closes"]
  });

export const ecConfigResponseSchema = z.object({
  election: electionWindowSchema,
  refreshed_at: z.string().datetime()
});

export const releaseStatusSchema = z.object({
  is_results_counted: z.boolean(),
  results_counted_at: z.string().datetime().nullable(),
  results_counted_by: z.string().uuid().nullable(),
  is_results_released: z.boolean(),
  results_released_at: z.string().datetime().nullable(),
  results_released_by: z.string().uuid().nullable(),
  poll_closes: z.string().datetime()
});

export const repVerificationSchema = z.object({
  id: uuidSchema,
  verifier_auth_user_id: uuidSchema,
  message: z.string(),
  verified_at: z.string().datetime()
});

export const ecResultsResponseSchema = z.object({
  rows: z.array(resultsRowSchema),
  summary: repResultsSummarySchema,
  release: releaseStatusSchema,
  verifications: z.array(repVerificationSchema),
  refreshed_at: z.string().datetime()
});

export const ecReleaseResponseSchema = z.object({
  message: z.string(),
  release: releaseStatusSchema
});

export const ecCountResponseSchema = z.object({
  message: z.string(),
  release: releaseStatusSchema,
  rows: z.array(resultsRowSchema),
  summary: repResultsSummarySchema
});

export const repVerifyRequestSchema = z.object({
  message: z.string().trim().min(5).max(500)
});

export const repVerifyResponseSchema = z.object({
  message: z.string(),
  verification: repVerificationSchema,
  verification_state: z.object({
    is_verified_by_any_rep: z.boolean(),
    total_verifications: z.number().int().nonnegative()
  })
});

export const auditEntrySchema = z.object({
  id: z.number().int().nonnegative(),
  event_type: z.string(),
  actor_token: z.string().nullable(),
  ip_address: z.string().nullable(),
  payload_hash: z.string().nullable(),
  metadata: z.record(z.any()).nullable(),
  logged_at: z.string().datetime()
});

export const auditResponseSchema = z.object({
  entries: z.array(auditEntrySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().nonnegative(),
  summary: repResultsSummarySchema
});

export const apiErrorSchema = z.object({
  message: z.string()
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ActivationRequest = z.infer<typeof activationRequestSchema>;
export type IssueCodesRequest = z.infer<typeof issueCodesRequestSchema>;
export type IssueCodesResponse = z.infer<typeof issueCodesResponseSchema>;
export type ResetActivationRequest = z.infer<typeof resetActivationRequestSchema>;
export type ResetActivationResponse = z.infer<typeof resetActivationResponseSchema>;
export type ChangeRoleRequest = z.infer<typeof changeRoleRequestSchema>;
export type ChangeRoleResponse = z.infer<typeof changeRoleResponseSchema>;
export type AdminStudentsQuery = z.infer<typeof adminStudentsQuerySchema>;
export type AdminStudentsResponse = z.infer<typeof adminStudentsResponseSchema>;
export type VoteRequest = z.infer<typeof voteRequestSchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type BallotResponse = z.infer<typeof ballotResponseSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type VoteConfirmation = z.infer<typeof voteConfirmationSchema>;
export type ResultsRow = z.infer<typeof resultsRowSchema>;
export type ResultsResponse = z.infer<typeof resultsResponseSchema>;
export type RepResultsResponse = z.infer<typeof repResultsResponseSchema>;
export type EcConfigUpdate = z.infer<typeof ecConfigUpdateSchema>;
export type EcConfigResponse = z.infer<typeof ecConfigResponseSchema>;
export type ReleaseStatus = z.infer<typeof releaseStatusSchema>;
export type RepVerification = z.infer<typeof repVerificationSchema>;
export type EcResultsResponse = z.infer<typeof ecResultsResponseSchema>;
export type EcReleaseResponse = z.infer<typeof ecReleaseResponseSchema>;
export type EcCountResponse = z.infer<typeof ecCountResponseSchema>;
export type RepVerifyRequest = z.infer<typeof repVerifyRequestSchema>;
export type RepVerifyResponse = z.infer<typeof repVerifyResponseSchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type AuditResponse = z.infer<typeof auditResponseSchema>;
