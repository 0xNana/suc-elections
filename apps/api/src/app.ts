import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

import {
  activationRequestSchema,
  adminStudentsQuerySchema,
  adminStudentsResponseSchema,
  auditQuerySchema,
  ballotResponseSchema,
  changeRoleRequestSchema,
  changeRoleResponseSchema,
  ecConfigResponseSchema,
  ecConfigUpdateSchema,
  ecCountResponseSchema,
  ecReleaseResponseSchema,
  ecResultsResponseSchema,
  issueCodesRequestSchema,
  issueCodesResponseSchema,
  loginRequestSchema,
  repResultsResponseSchema,
  repVerifyRequestSchema,
  repVerifyResponseSchema,
  resetActivationRequestSchema,
  resetActivationResponseSchema,
  resultsResponseSchema,
  sessionResponseSchema,
  voteConfirmationSchema,
  voteRequestSchema
} from "@suc-vote/shared";

import { getRoleFromClaims, type SessionClaims } from "./lib/auth.js";
import { ApiError, DuplicateVoteError } from "./lib/errors.js";
import { sha256 } from "./lib/hash.js";
import { asyncHandler } from "./middleware/async-handler.js";
import type { AuthProvider, StudentRole } from "./services/auth-provider.js";
import type { ElectionStore } from "./services/election-store.js";
import type { ResultsBroadcaster } from "./services/results-broadcaster.js";
import type { SessionVerifier } from "./services/session-verifier.js";
import { verifyHCaptchaToken } from "./utils/hcaptcha.js";

interface AppDependencies {
  authProvider: AuthProvider;
  broadcaster: ResultsBroadcaster;
  corsOrigin: string;
  hcaptchaSecret: string;
  hcaptchaSiteKey: string;
  sessionVerifier: SessionVerifier;
  store: ElectionStore;
}

interface AuthenticatedRequest extends Request {
  auth?: SessionClaims;
}

function getClientIp(request: Request) {
  return request.ip ?? null;
}

function getBearerToken(request: Request) {
  const header = request.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.replace("Bearer ", "").trim();
}

function shuffle<T>(items: readonly T[]) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    const current = copy[index]!;
    copy[index] = copy[target]!;
    copy[target] = current;
  }

  return copy;
}

function requireAuth(sessionVerifier: SessionVerifier) {
  return (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
    const header = request.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      return next(new ApiError(401, "Missing bearer token"));
    }

    sessionVerifier
      .verify(header.replace("Bearer ", "").trim())
      .then((claims) => {
        request.auth = claims;
        next();
      })
      .catch(() => {
        next(new ApiError(401, "Invalid session token"));
      });
  };
}

function requireRepRole(request: AuthenticatedRequest, _response: Response, next: NextFunction) {
  const claims = request.auth;
  if (!claims || getRoleFromClaims(claims) !== "aspirant_rep") {
    return next(new ApiError(403, "Aspirant representative access is required"));
  }

  next();
}

function requireAuditViewerRole(request: AuthenticatedRequest, _response: Response, next: NextFunction) {
  const claims = request.auth;
  const role = claims ? getRoleFromClaims(claims) : null;
  if (role !== "aspirant_rep" && role !== "ec_admin") {
    return next(new ApiError(403, "Audit access is required"));
  }

  next();
}

function requireEcRole(request: AuthenticatedRequest, _response: Response, next: NextFunction) {
  const claims = request.auth;
  if (!claims || getRoleFromClaims(claims) !== "ec_admin") {
    return next(new ApiError(403, "EC admin access is required"));
  }

  next();
}

function assertElectionOpen(config: { poll_opens: Date; poll_closes: Date; is_locked: boolean } | null) {
  if (!config) {
    throw new ApiError(503, "Election configuration is unavailable");
  }

  const now = new Date();
  if (config.is_locked || now < config.poll_opens || now > config.poll_closes) {
    throw new ApiError(403, "Polls are closed");
  }
}

function serializeAuditRows(
  rows: Array<{
    id: number;
    event_type: string;
    actor_token: string | null;
    ip_address: string | null;
    payload_hash: string | null;
    metadata: Record<string, unknown> | null;
    logged_at: Date;
  }>
) {
  return rows.map((row) => ({
    ...row,
    logged_at: row.logged_at.toISOString()
  }));
}

function buildReleaseStatus(config: {
  poll_closes: Date;
  results_counted_at: Date | null;
  results_counted_by: string | null;
  results_released_at: Date | null;
  results_released_by: string | null;
}) {
  return {
    is_results_counted: config.results_counted_at !== null,
    results_counted_at: config.results_counted_at?.toISOString() ?? null,
    results_counted_by: config.results_counted_by ?? null,
    is_results_released: config.results_released_at !== null,
    results_released_at: config.results_released_at?.toISOString() ?? null,
    results_released_by: config.results_released_by ?? null,
    poll_closes: config.poll_closes.toISOString()
  };
}

function serializeElectionConfig(config: {
  id: string;
  poll_opens: Date;
  poll_closes: Date;
  is_locked: boolean;
  results_counted_at: Date | null;
  results_counted_by: string | null;
  results_released_at: Date | null;
  results_released_by: string | null;
}) {
  return {
    id: config.id,
    poll_opens: config.poll_opens.toISOString(),
    poll_closes: config.poll_closes.toISOString(),
    is_locked: config.is_locked,
    results_counted_at: config.results_counted_at?.toISOString() ?? null,
    results_counted_by: config.results_counted_by ?? null,
    results_released_at: config.results_released_at?.toISOString() ?? null,
    results_released_by: config.results_released_by ?? null
  };
}

function serializeResultVerifications(
  rows: Array<{
    id: string;
    verifier_auth_user_id: string;
    message: string;
    verified_at: Date;
  }>
) {
  return rows.map((row) => ({
    id: row.id,
    verifier_auth_user_id: row.verifier_auth_user_id,
    message: row.message,
    verified_at: row.verified_at.toISOString()
  }));
}

export function createApp(dependencies: AppDependencies) {
  const app = express();
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: {
        policy: "cross-origin"
      },
      frameguard: {
        action: "deny"
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      },
      referrerPolicy: {
        policy: "strict-origin-when-cross-origin"
      }
    })
  );
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-XSS-Protection", "1; mode=block");
    response.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    next();
  });
  app.use(
    cors({
      origin: dependencies.corsOrigin,
      credentials: false,
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type", "Authorization"]
    })
  );
  app.use(express.json({ limit: "32kb" }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: "Too many login attempts. Try again later."
    }
  });

  const voteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: "Too many vote submissions. Slow down."
    }
  });

  const auditLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: "Too many audit requests. Slow down."
    }
  });

  const activationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: "Too many activation attempts. Try again later."
    }
  });

  const issueCodesLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request) => (request as AuthenticatedRequest).auth?.sub ?? request.ip ?? "unknown",
    message: {
      message: "Too many code issuance requests. Try again later."
    }
  });

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.post(
    "/auth/admin/issue-codes",
    requireAuth(dependencies.sessionVerifier),
    requireEcRole,
    issueCodesLimiter,
    asyncHandler(async (request: AuthenticatedRequest, response) => {
      const parsed = issueCodesRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(400, "Invalid code issuance payload");
      }

      const issued: Array<{
        student_id: string;
        full_name: string;
        role: StudentRole;
        activation_code: string;
        can_vote: boolean;
      }> = [];
      const skipped: Array<{ student_id: string; reason: string }> = [];

      for (const entry of parsed.data.entries) {
        const existing = await dependencies.store.findStudentByStudentId(entry.student_id);

        if (existing?.activated_at) {
          skipped.push({
            student_id: entry.student_id,
            reason: "Account already activated"
          });
          continue;
        }

        const activationCode = await dependencies.authProvider.generateUniqueActivationCode();

        const student = existing
          ? await dependencies.store.refreshPendingStudentActivation({
              studentId: entry.student_id,
              fullName: entry.full_name,
              role: entry.role,
              canVote: entry.can_vote ?? entry.role === "voter",
              activationCode
            })
          : await dependencies.store.createStudentWithActivationCode({
              studentId: entry.student_id,
              fullName: entry.full_name,
              role: entry.role,
              canVote: entry.can_vote ?? entry.role === "voter",
              activationCode
            });

        if (!student) {
          skipped.push({
            student_id: entry.student_id,
            reason: "Unable to issue activation code"
          });
          continue;
        }

        issued.push({
          student_id: student.student_id,
          full_name: student.full_name,
          role: student.role,
          activation_code: activationCode,
          can_vote: student.can_vote
        });

        await dependencies.store.insertAuditEvent({
          eventType: "CODE_ISSUED",
          actorToken: request.auth!.sub,
          ipAddress: getClientIp(request),
          payloadHash: sha256(`${student.student_id}:${activationCode}`),
          metadata: {
            target_student_id: student.student_id,
            role: student.role
          }
        });
      }

      response.json(
        issueCodesResponseSchema.parse({
          issued,
          skipped
        })
      );
    })
  );

  app.post(
    "/auth/activate",
    activationLimiter,
    asyncHandler(async (request, response) => {
      const parsed = activationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(400, "Invalid activation payload");
      }

      const [verified] = await verifyHCaptchaToken(parsed.data.captcha_token, getClientIp(request), {
        secret: dependencies.hcaptchaSecret,
        siteKey: dependencies.hcaptchaSiteKey
      });
      if (!verified) {
        throw new ApiError(403, "Verification check failed. Please try again.");
      }

      const student = await dependencies.store.findStudentByStudentId(parsed.data.student_id);
      if (
        !student ||
        student.activated_at !== null ||
        student.activation_code !== parsed.data.activation_code
      ) {
        throw new ApiError(401, "Invalid student ID or activation code");
      }

      try {
        const createdUser = await dependencies.authProvider.createActivationUser({
          studentId: student.student_id,
          password: parsed.data.new_password,
          role: student.role,
          canVote: student.can_vote,
          fullName: student.full_name,
          voterTokenHash: sha256(student.voter_token)
        });

        const activated = await dependencies.store.activateStudentAccount({
          studentId: student.student_id,
          activationCode: parsed.data.activation_code,
          authUserId: createdUser.authUserId
        });

        if (!activated) {
          throw new ApiError(401, "Invalid student ID or activation code");
        }

        const session = await dependencies.authProvider.signInWithStudentId(
          activated.student_id,
          parsed.data.new_password
        );

        await dependencies.store.insertAuditEvent({
          eventType: "ACTIVATION",
          actorToken: activated.voter_token,
          ipAddress: getClientIp(request),
          payloadHash: sha256(`${activated.student_id}:${session.access_token}`),
          metadata: {
            student_id: activated.student_id,
            auth_user_id: activated.auth_user_id,
            role: activated.role
          }
        });

        response.json(
          sessionResponseSchema.parse({
            ...session,
            role: activated.role,
            can_vote: activated.can_vote,
            student: {
              student_id: activated.student_id,
              full_name: activated.full_name
            }
          })
        );
      } catch (error) {
        if (error instanceof ApiError) {
          throw error;
        }

        throw error;
      }
    })
  );

  app.post(
    "/auth/login",
    loginLimiter,
    asyncHandler(async (request, response) => {
      const parsed = loginRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(400, "Invalid login payload");
      }

      const [verified] = await verifyHCaptchaToken(parsed.data.captcha_token, getClientIp(request), {
        secret: dependencies.hcaptchaSecret,
        siteKey: dependencies.hcaptchaSiteKey
      });
      if (!verified) {
        throw new ApiError(403, "Verification check failed. Please try again.");
      }

      const student = await dependencies.store.findStudentByStudentId(parsed.data.student_id);
      if (!student) {
        await dependencies.store.insertAuditEvent({
          eventType: "FAILED_LOGIN",
          actorToken: null,
          ipAddress: getClientIp(request),
          payloadHash: sha256(`${parsed.data.student_id}:failed:${Date.now()}`),
          metadata: { student_id: parsed.data.student_id }
        });

        throw new ApiError(401, "Invalid student ID or password");
      }

      if (!student.activated_at || !student.auth_user_id) {
        throw new ApiError(
          403,
          "Account not activated. See your EC representative for an activation code."
        );
      }

      try {
        const session = await dependencies.authProvider.signInWithStudentId(
          student.student_id,
          parsed.data.password
        );

        await dependencies.store.insertAuditEvent({
          eventType: "LOGIN",
          actorToken: student.voter_token,
          ipAddress: getClientIp(request),
          payloadHash: sha256(`${student.student_id}:${session.access_token}`),
          metadata: {
            student_id: student.student_id,
            auth_user_id: student.auth_user_id,
            role: student.role
          }
        });

        response.json(
          sessionResponseSchema.parse({
            ...session,
            role: student.role,
            can_vote: student.can_vote,
            student: {
              student_id: student.student_id,
              full_name: student.full_name
            }
          })
        );
      } catch {
        await dependencies.store.insertAuditEvent({
          eventType: "FAILED_LOGIN",
          actorToken: student.voter_token,
          ipAddress: getClientIp(request),
          payloadHash: sha256(`${student.student_id}:failed:${Date.now()}`),
          metadata: { student_id: student.student_id }
        });

        throw new ApiError(401, "Invalid student ID or password");
      }
    })
  );

  app.post(
    "/auth/logout",
    requireAuth(dependencies.sessionVerifier),
    asyncHandler(async (request: AuthenticatedRequest, response) => {
      const token = getBearerToken(request);
      if (!token) {
        throw new ApiError(401, "Missing bearer token");
      }

      const student = await dependencies.store.findStudentByAuthUserId(request.auth!.sub);
      await dependencies.authProvider.signOut(token);

      await dependencies.store.insertAuditEvent({
        eventType: "LOGOUT",
        actorToken: student?.voter_token ?? request.auth!.sub,
        ipAddress: getClientIp(request),
        payloadHash: sha256(`logout:${request.auth!.sub}:${Date.now()}`),
        metadata: {
          student_id: student?.student_id ?? null,
          auth_user_id: request.auth!.sub
        }
      });

      response.json({ message: "Logged out" });
    })
  );

  app.post(
    "/auth/admin/reset-activation",
    requireAuth(dependencies.sessionVerifier),
    requireEcRole,
    asyncHandler(async (request: AuthenticatedRequest, response) => {
      const parsed = resetActivationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(400, "Invalid reset activation payload");
      }

      const student = await dependencies.store.findStudentByStudentId(parsed.data.student_id);
      if (!student) {
        throw new ApiError(404, "Student not found");
      }

      const activationCode = await dependencies.authProvider.generateUniqueActivationCode();
      const reset = await dependencies.store.resetStudentActivation({
        studentId: student.student_id,
        activationCode
      });

      if (!reset) {
        throw new ApiError(404, "Student not found");
      }

      await dependencies.store.insertAuditEvent({
        eventType: "RESET_ACTIVATION",
        actorToken: request.auth!.sub,
        ipAddress: getClientIp(request),
        payloadHash: sha256(`${reset.student_id}:${activationCode}`),
        metadata: {
          target_student_id: reset.student_id,
          sensitive: true
        }
      });

      response.json(
        resetActivationResponseSchema.parse({
          student_id: reset.student_id,
          activation_code: activationCode
        })
      );
    })
  );

  app.post(
    "/auth/admin/change-role",
    requireAuth(dependencies.sessionVerifier),
    requireEcRole,
    asyncHandler(async (request: AuthenticatedRequest, response) => {
      const parsed = changeRoleRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(400, "Invalid role change payload");
      }

      const updated = await dependencies.store.updateStudentRole({
        studentId: parsed.data.student_id,
        role: parsed.data.role,
        canVote: parsed.data.can_vote
      });

      if (!updated) {
        throw new ApiError(404, "Student not found");
      }

      if (updated.auth_user_id) {
        await dependencies.authProvider.updateUserRole({
          authUserId: updated.auth_user_id,
          studentId: updated.student_id,
          role: updated.role,
          canVote: updated.can_vote,
          voterTokenHash: sha256(updated.voter_token),
          fullName: updated.full_name
        });
      }

      await dependencies.store.insertAuditEvent({
        eventType: "ROLE_CHANGE",
        actorToken: request.auth!.sub,
        ipAddress: getClientIp(request),
        payloadHash: sha256(`${updated.student_id}:${updated.role}`),
        metadata: {
          target_student_id: updated.student_id,
          role: updated.role
        }
      });

      response.json(
        changeRoleResponseSchema.parse({
          student_id: updated.student_id,
          role: updated.role,
          can_vote: updated.can_vote
        })
      );
    })
  );

  app.get(
    "/auth/admin/students",
    requireAuth(dependencies.sessionVerifier),
    requireEcRole,
    asyncHandler(async (request, response) => {
      const parsed = adminStudentsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ApiError(400, "Invalid student query");
      }

      const students = await dependencies.store.listStudentsForAdmin({
        search: parsed.data.search,
        role: parsed.data.role,
        activationStatus: parsed.data.activation_status
      });

      response.json(
        adminStudentsResponseSchema.parse({
          students: students.map((student) => ({
            student_id: student.student_id,
            full_name: student.full_name,
            role: student.role,
            can_vote: student.can_vote,
            activated: student.activated,
            activated_at: student.activated_at?.toISOString() ?? null,
            last_login_at: student.last_login_at?.toISOString() ?? null
          }))
        })
      );
    })
  );

  app.get(
    "/ballot",
    requireAuth(dependencies.sessionVerifier),
    asyncHandler(async (request: AuthenticatedRequest, response) => {
      const auth = request.auth!;
      const student = await dependencies.store.findStudentByAuthUserId(auth.sub);

      if (!student || !student.is_eligible || !student.can_vote) {
        throw new ApiError(403, "Student is not eligible to vote");
      }

      const [config, ballotRows, votedPositionIds] = await Promise.all([
        dependencies.store.getElectionConfig(),
        dependencies.store.getBallotRows(),
        dependencies.store.getVotedPositionIds(student.voter_token)
      ]);

      if (!config) {
        throw new ApiError(503, "Election configuration is unavailable");
      }

      const positionMap = new Map<
        string,
        {
          id: string;
          title: string;
          display_order: number;
          has_voted: boolean;
          candidates: Array<{
            id: string;
            full_name: string;
            photo_url: string | null;
            ballot_num: number;
            manifesto_url: string | null;
          }>;
        }
      >();

      for (const row of ballotRows) {
        const existing = positionMap.get(row.position_id);
        const candidate = {
          id: row.candidate_id,
          full_name: row.full_name,
          photo_url: row.photo_url,
          ballot_num: row.ballot_num,
          manifesto_url: row.manifesto_url
        };

        if (existing) {
          existing.candidates.push(candidate);
        } else {
          positionMap.set(row.position_id, {
            id: row.position_id,
            title: row.title,
            display_order: row.display_order,
            has_voted: votedPositionIds.includes(row.position_id),
            candidates: [candidate]
          });
        }
      }

      const payload = {
        election: {
          id: config.id,
          poll_opens: config.poll_opens.toISOString(),
          poll_closes: config.poll_closes.toISOString(),
          is_locked: config.is_locked,
          results_counted_at: config.results_counted_at?.toISOString() ?? null,
          results_counted_by: config.results_counted_by ?? null,
          results_released_at: config.results_released_at?.toISOString() ?? null,
          results_released_by: config.results_released_by ?? null
        },
        student: {
          student_id: student.student_id,
          full_name: student.full_name,
          is_eligible: student.is_eligible,
          can_vote: student.can_vote
        },
        voted_positions: votedPositionIds,
        positions: [...positionMap.values()].map((position) => ({
          ...position,
          candidates: shuffle(position.candidates)
        }))
      };

      response.json(ballotResponseSchema.parse(payload));
    })
  );

  app.post(
    "/vote",
    voteLimiter,
    requireAuth(dependencies.sessionVerifier),
    asyncHandler(async (request: AuthenticatedRequest, response) => {
      const parsed = voteRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(400, "Invalid vote payload");
      }

      const [student, config] = await Promise.all([
        dependencies.store.findStudentByAuthUserId(request.auth!.sub),
        dependencies.store.getElectionConfig()
      ]);

      if (!student || !student.is_eligible || !student.can_vote) {
        throw new ApiError(403, "Student is not eligible to vote");
      }

      assertElectionOpen(config);

      const candidateExists = await dependencies.store.candidateExists(
        parsed.data.position_id,
        parsed.data.candidate_id
      );

      if (!candidateExists) {
        throw new ApiError(400, "Candidate does not belong to that position");
      }

      const seed = `${student.voter_token}:${parsed.data.position_id}:${parsed.data.candidate_id}:${Date.now()}`;
      const confirmationHash = sha256(seed);

      try {
        const vote = await dependencies.store.castVote({
          positionId: parsed.data.position_id,
          candidateId: parsed.data.candidate_id,
          voterToken: student.voter_token,
          ipAddress: getClientIp(request),
          confirmationHash
        });

        dependencies.broadcaster
          .publishRefresh(parsed.data.position_id)
          .catch((error) => console.error("Realtime broadcast failed", error));

        response.json(
          voteConfirmationSchema.parse({
            confirmation_hash: confirmationHash,
            cast_at: vote.castAt.toISOString(),
            position_id: parsed.data.position_id,
            candidate_id: parsed.data.candidate_id
          })
        );
      } catch (error) {
        if (error instanceof DuplicateVoteError) {
          response.status(error.statusCode).json({ message: error.message });
          return;
        }

        throw error;
      }
    })
  );

  app.get(
    "/ec/config",
    requireAuth(dependencies.sessionVerifier),
    requireEcRole,
    asyncHandler(async (_request: AuthenticatedRequest, response) => {
      const config = await dependencies.store.getElectionConfig();
      if (!config) {
        throw new ApiError(503, "Election configuration is unavailable");
      }

      response.json(
        ecConfigResponseSchema.parse({
          election: serializeElectionConfig(config),
          refreshed_at: new Date().toISOString()
        })
      );
    })
  );

  app.post(
    "/ec/config",
    requireAuth(dependencies.sessionVerifier),
    requireEcRole,
    asyncHandler(async (request: AuthenticatedRequest, response) => {
      const parsed = ecConfigUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(400, "Invalid election configuration");
      }

      const config = await dependencies.store.updateElectionConfig({
        pollOpens: parsed.data.poll_opens,
        pollCloses: parsed.data.poll_closes,
        isLocked: parsed.data.is_locked
      });

      if (!config) {
        throw new ApiError(503, "Election configuration is unavailable");
      }

      await dependencies.store.insertAuditEvent({
        eventType: "ELECTION_CONFIG_UPDATED",
        actorToken: request.auth!.sub,
        ipAddress: getClientIp(request),
        payloadHash: sha256(`${parsed.data.poll_opens}:${parsed.data.poll_closes}:${parsed.data.is_locked}`),
        metadata: {
          ec_auth_user_id: request.auth!.sub,
          poll_opens: parsed.data.poll_opens,
          poll_closes: parsed.data.poll_closes,
          is_locked: parsed.data.is_locked
        }
      });

      response.json(
        ecConfigResponseSchema.parse({
          election: serializeElectionConfig(config),
          refreshed_at: new Date().toISOString()
        })
      );
    })
  );

  app.post(
    "/ec/config/open",
    requireAuth(dependencies.sessionVerifier),
    requireEcRole,
    asyncHandler(async (request: AuthenticatedRequest, response) => {
      const config = await dependencies.store.openPollNow();
      if (!config) {
        throw new ApiError(503, "Election configuration is unavailable");
      }

      await dependencies.store.insertAuditEvent({
        eventType: "POLL_OPENED",
        actorToken: request.auth!.sub,
        ipAddress: getClientIp(request),
        payloadHash: sha256(`poll-opened:${config.poll_opens.toISOString()}`),
        metadata: {
          ec_auth_user_id: request.auth!.sub,
          poll_opens: config.poll_opens.toISOString(),
          poll_closes: config.poll_closes.toISOString()
        }
      });

      response.json(
        ecConfigResponseSchema.parse({
          election: serializeElectionConfig(config),
          refreshed_at: new Date().toISOString()
        })
      );
    })
  );

  app.post(
    "/ec/config/close",
    requireAuth(dependencies.sessionVerifier),
    requireEcRole,
    asyncHandler(async (request: AuthenticatedRequest, response) => {
      const config = await dependencies.store.closePollNow();
      if (!config) {
        throw new ApiError(503, "Election configuration is unavailable");
      }

      await dependencies.store.insertAuditEvent({
        eventType: "POLL_CLOSED",
        actorToken: request.auth!.sub,
        ipAddress: getClientIp(request),
        payloadHash: sha256(`poll-closed:${config.poll_closes.toISOString()}`),
        metadata: {
          ec_auth_user_id: request.auth!.sub,
          poll_closes: config.poll_closes.toISOString(),
          is_locked: config.is_locked
        }
      });

      response.json(
        ecConfigResponseSchema.parse({
          election: serializeElectionConfig(config),
          refreshed_at: new Date().toISOString()
        })
      );
    })
  );

  app.get(
    "/results",
    asyncHandler(async (_request, response) => {
      const config = await dependencies.store.getElectionConfig();
      if (!config) {
        throw new ApiError(503, "Election configuration is unavailable");
      }

      if (new Date() < config.poll_closes) {
        response.status(403).json({ message: "Results sealed until polls close" });
        return;
      }

       if (!config.results_released_at) {
        response.status(403).json({ message: "Results are awaiting EC release" });
        return;
      }

      const rows = await dependencies.store.getResults();
      response.json(
        resultsResponseSchema.parse({
          rows,
          refreshed_at: new Date().toISOString()
        })
      );
    })
  );

  app.get(
    "/ec/results",
    requireAuth(dependencies.sessionVerifier),
    requireEcRole,
    asyncHandler(async (_request: AuthenticatedRequest, response) => {
      const config = await dependencies.store.getElectionConfig();
      if (!config) {
        throw new ApiError(503, "Election configuration is unavailable");
      }

      if (new Date() < config.poll_closes) {
        throw new ApiError(403, "Results are unavailable until polls close");
      }

      const [rows, summary] = await Promise.all([
        dependencies.store.getResults(),
        dependencies.store.getRepSummary()
      ]);

      response.json(
        ecResultsResponseSchema.parse({
          rows,
          summary,
          release: buildReleaseStatus(config),
          refreshed_at: new Date().toISOString()
        })
      );
    })
  );

  app.post(
    "/ec/results/count",
    requireAuth(dependencies.sessionVerifier),
    requireEcRole,
    asyncHandler(async (request: AuthenticatedRequest, response) => {
      const config = await dependencies.store.getElectionConfig();
      if (!config) {
        throw new ApiError(503, "Election configuration is unavailable");
      }

      if (new Date() < config.poll_closes) {
        throw new ApiError(403, "Results cannot be counted before polls close");
      }

      const counted = await dependencies.store.countResults(request.auth!.sub);
      if (!counted) {
        throw new ApiError(503, "Election configuration is unavailable");
      }

      const [rows, summary] = await Promise.all([
        dependencies.store.getResults(),
        dependencies.store.getRepSummary()
      ]);

      await dependencies.store.insertAuditEvent({
        eventType: "RESULTS_COUNTED",
        actorToken: request.auth!.sub,
        ipAddress: getClientIp(request),
        payloadHash: sha256(`results-counted:${counted.results_counted_at?.toISOString() ?? Date.now()}`),
        metadata: {
          ec_auth_user_id: request.auth!.sub,
          counted_at: counted.results_counted_at?.toISOString() ?? null
        }
      });

      response.json(
        ecCountResponseSchema.parse({
          message: "Official count generated",
          release: buildReleaseStatus(counted),
          rows,
          summary
        })
      );
    })
  );

  app.post(
    "/ec/results/release",
    requireAuth(dependencies.sessionVerifier),
    requireEcRole,
    asyncHandler(async (request: AuthenticatedRequest, response) => {
      const config = await dependencies.store.getElectionConfig();
      if (!config) {
        throw new ApiError(503, "Election configuration is unavailable");
      }

      if (new Date() < config.poll_closes) {
        throw new ApiError(403, "Results cannot be released before polls close");
      }

      if (!config.results_counted_at) {
        throw new ApiError(403, "The EC must count the results before release");
      }

      const verifications = await dependencies.store.listResultVerifications(config.id);
      if (verifications.length === 0) {
        throw new ApiError(403, "At least one aspirant rep verification is required before release");
      }

      const released = await dependencies.store.releaseResults(request.auth!.sub);
      if (!released) {
        throw new ApiError(503, "Election configuration is unavailable");
      }

      await dependencies.store.insertAuditEvent({
        eventType: "RESULTS_RELEASED",
        actorToken: request.auth!.sub,
        ipAddress: getClientIp(request),
        payloadHash: sha256(`results-release:${released.results_released_at?.toISOString() ?? Date.now()}`),
        metadata: {
          ec_auth_user_id: request.auth!.sub,
          released_at: released.results_released_at?.toISOString() ?? null
        }
      });

      response.json(
        ecReleaseResponseSchema.parse({
          message: "Results released to the public",
          release: buildReleaseStatus(released)
        })
      );
    })
  );

  app.get(
    "/rep/results",
    requireAuth(dependencies.sessionVerifier),
    requireRepRole,
    asyncHandler(async (_request: AuthenticatedRequest, response) => {
      const config = await dependencies.store.getElectionConfig();
      if (!config) {
        throw new ApiError(503, "Election configuration is unavailable");
      }

      if (new Date() < config.poll_closes) {
        throw new ApiError(403, "Results are unavailable until polls close");
      }

      if (!config.results_counted_at) {
        throw new ApiError(403, "Results are awaiting EC count");
      }

      const verifications = await dependencies.store.listResultVerifications(config.id);
      const [rows, summary] = await Promise.all([
        dependencies.store.getResults(),
        dependencies.store.getRepSummary()
      ]);

      response.json(
        repResultsResponseSchema.parse({
          rows,
          summary,
          count_state: {
            is_results_counted: true,
            results_counted_at: config.results_counted_at.toISOString(),
            results_counted_by: config.results_counted_by
          },
          verification_state: {
            is_verified_by_any_rep: verifications.length > 0,
            total_verifications: verifications.length
          },
          refreshed_at: new Date().toISOString()
        })
      );
    })
  );

  app.post(
    "/rep/verify",
    requireAuth(dependencies.sessionVerifier),
    requireRepRole,
    asyncHandler(async (request: AuthenticatedRequest, response) => {
      const parsed = repVerifyRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ApiError(400, "Invalid verification message");
      }

      const config = await dependencies.store.getElectionConfig();
      if (!config) {
        throw new ApiError(503, "Election configuration is unavailable");
      }

      if (new Date() < config.poll_closes) {
        throw new ApiError(403, "Results are unavailable until polls close");
      }

      if (!config.results_counted_at) {
        throw new ApiError(403, "Results are awaiting EC count");
      }

      const verification = await dependencies.store.saveResultVerification({
        electionConfigId: config.id,
        verifierAuthUserId: request.auth!.sub,
        message: parsed.data.message
      });

      const verifications = await dependencies.store.listResultVerifications(config.id);

      await dependencies.store.insertAuditEvent({
        eventType: "REP_VERIFIED_RESULTS",
        actorToken: request.auth!.sub,
        ipAddress: getClientIp(request),
        payloadHash: sha256(`rep-verify:${request.auth!.sub}:${parsed.data.message}`),
        metadata: {
          rep_auth_user_id: request.auth!.sub,
          message: parsed.data.message
        }
      });

      response.json(
        repVerifyResponseSchema.parse({
          message: "Verification recorded",
          verification: {
            id: verification!.id,
            verifier_auth_user_id: verification!.verifier_auth_user_id,
            message: verification!.message,
            verified_at: verification!.verified_at.toISOString()
          },
          verification_state: {
            is_verified_by_any_rep: verifications.length > 0,
            total_verifications: verifications.length
          }
        })
      );
    })
  );

  app.get(
    "/audit",
    auditLimiter,
    requireAuth(dependencies.sessionVerifier),
    requireAuditViewerRole,
    asyncHandler(async (request: AuthenticatedRequest, response) => {
      const parsed = auditQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ApiError(400, "Invalid audit query");
      }

      const [audit, summary] = await Promise.all([
        dependencies.store.listAuditEntries(parsed.data),
        dependencies.store.getRepSummary()
      ]);

      response.json({
        entries: serializeAuditRows(audit.entries),
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        total: audit.total,
        summary
      });
    })
  );

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      response.status(error.statusCode).json({ message: error.message });
      return;
    }

    console.error(error);
    response.status(500).json({ message: "Internal server error" });
  });

  return app;
}
