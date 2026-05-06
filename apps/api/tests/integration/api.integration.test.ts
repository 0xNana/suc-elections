import path from "node:path";
import { fileURLToPath } from "node:url";

import jwt from "jsonwebtoken";
import type { Pool } from "pg";
import request from "supertest";
import { vi } from "vitest";

vi.mock("../../src/utils/hcaptcha.js", () => ({
  verifyHCaptchaToken: vi.fn(async () => [true, []] as const)
}));

import { createApp } from "../../src/app.js";
import type { AuthProvider, StudentRole, StudentSession } from "../../src/services/auth-provider.js";
import { ElectionStore } from "../../src/services/election-store.js";
import { NoopResultsBroadcaster } from "../../src/services/results-broadcaster.js";
import { JwtSessionVerifier } from "../../src/services/session-verifier.js";
import { PostgresHarness } from "../helpers/postgres-harness.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsPath = path.resolve(__dirname, "../../../../packages/db/migrations");

const jwtSecret = "integration-test-secret";

const seeded = {
  voterAuthId: "11111111-1111-4111-8111-111111111111",
  secondVoterAuthId: "22222222-2222-4222-8222-222222222222",
  repAuthId: "33333333-3333-4333-8333-333333333333",
  ecAuthId: "44444444-4444-4444-8444-444444444444",
  presidentPositionId: "aaaa1111-1111-4111-8111-111111111111",
  secretaryPositionId: "bbbb2222-2222-4222-8222-222222222222",
  firstCandidateId: "c1111111-1111-4111-8111-111111111111",
  secondCandidateId: "c2222222-2222-4222-8222-222222222222",
  thirdCandidateId: "c3333333-3333-4333-8333-333333333333"
} as const;

let ipCounter = 10;

function nextIp() {
  ipCounter += 1;
  return `10.0.0.${ipCounter}`;
}

class FakeAuthProvider implements AuthProvider {
  private readonly passwords = new Map<string, string>();
  private readonly authUsers = new Map<string, { authUserId: string; role: StudentRole; canVote: boolean }>();
  private activationCounter = 0;

  public constructor(
    private readonly pool: Pool,
    private readonly secret: string
  ) {
    this.passwords.set("CSM20252340", "VoteSecure123!");
    this.passwords.set("BFN20251287", "VoteSecure123!");
    this.passwords.set("ACC20254502", "VoteSecure123!");
    this.passwords.set("ECADMIN01", "EcSecure123!");

    this.authUsers.set("CSM20252340", {
      authUserId: seeded.voterAuthId,
      role: "voter",
      canVote: true
    });
    this.authUsers.set("BFN20251287", {
      authUserId: seeded.secondVoterAuthId,
      role: "voter",
      canVote: true
    });
    this.authUsers.set("ACC20254502", {
      authUserId: seeded.repAuthId,
      role: "aspirant_rep",
      canVote: true
    });
    this.authUsers.set("ECADMIN01", {
      authUserId: seeded.ecAuthId,
      role: "ec_admin",
      canVote: false
    });
  }

  public async signInWithStudentId(studentId: string, password: string): Promise<StudentSession> {
    const expectedPassword = this.passwords.get(studentId);
    const user = this.authUsers.get(studentId);

    if (!expectedPassword || expectedPassword !== password || !user) {
      throw new Error("Invalid credentials");
    }

    return {
      access_token: jwt.sign(
        {
          sub: user.authUserId,
          role: user.role,
          can_vote: user.canVote,
          student_id: studentId,
          voter_token: `hashed-${studentId}`
        },
        this.secret,
        { expiresIn: "1h" }
      ),
      refresh_token: `refresh-${studentId}`,
      token_type: "bearer",
      expires_in: 3600
    };
  }

  public async createActivationUser(input: {
    studentId: string;
    password: string;
    role: StudentRole;
    canVote: boolean;
    fullName: string;
    voterTokenHash: string;
  }) {
    const existing = this.authUsers.get(input.studentId);
    if (existing) {
      this.passwords.set(input.studentId, input.password);
      this.authUsers.set(input.studentId, {
        authUserId: existing.authUserId,
        role: input.role,
        canVote: input.canVote
      });
      await this.pool.query(
        `insert into auth.users (id, email)
         values ($1, $2)
         on conflict (id) do update set email = excluded.email`,
        [existing.authUserId, `${input.studentId}@suc-vote.internal`]
      );
      return {
        authUserId: existing.authUserId,
        email: `${input.studentId}@suc-vote.internal`
      };
    }

    const authUserId = `55555555-5555-4555-8555-${String(this.activationCounter).padStart(12, "0")}`;
    this.activationCounter += 1;
    this.passwords.set(input.studentId, input.password);
    this.authUsers.set(input.studentId, {
      authUserId,
      role: input.role,
      canVote: input.canVote
    });
    await this.pool.query(`insert into auth.users (id, email) values ($1, $2)`, [
      authUserId,
      `${input.studentId}@suc-vote.internal`
    ]);
    return {
      authUserId,
      email: `${input.studentId}@suc-vote.internal`
    };
  }

  public async deleteUser(authUserId: string) {
    await this.pool.query(`delete from auth.users where id = $1`, [authUserId]);
    for (const [studentId, user] of this.authUsers.entries()) {
      if (user.authUserId === authUserId) {
        this.authUsers.delete(studentId);
        this.passwords.delete(studentId);
      }
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
    const existing = this.authUsers.get(input.studentId);
    this.authUsers.set(input.studentId, {
      authUserId: existing?.authUserId ?? input.authUserId,
      role: input.role,
      canVote: input.canVote
    });
  }

  public async signOut() {}

  public async generateUniqueActivationCode() {
    return `ABC${String(this.activationCounter++).padStart(3, "0")}`;
  }
}

async function seedDatabase(
  harness: PostgresHarness,
  options?: {
    pollClosesOffsetMs?: number;
    pollOpensOffsetMs?: number;
    countResults?: boolean;
    releaseResults?: boolean;
  }
) {
  const opensOffset = options?.pollOpensOffsetMs ?? -60 * 60 * 1000;
  const closesOffset = options?.pollClosesOffsetMs ?? 60 * 60 * 1000;
  const now = Date.now();

  await harness.resetData();

  await harness.pool.query(
    `insert into auth.users (id, email)
     values
       ($1, 'CSM20252340@suc-vote.internal'),
       ($2, 'BFN20251287@suc-vote.internal'),
       ($3, 'ACC20254502@suc-vote.internal'),
       ($4, 'ECADMIN01@suc-vote.internal')`,
    [seeded.voterAuthId, seeded.secondVoterAuthId, seeded.repAuthId, seeded.ecAuthId]
  );

  await harness.pool.query(
    `insert into public.students (
       student_id,
       auth_user_id,
       activation_code,
       activated_at,
       role,
       can_vote,
       voter_token,
       full_name,
       is_eligible
     ) values
       ('CSM20252340', $1, null, now(), 'voter', true, 'token-student-1', 'Abena Serwaa Mensah', true),
       ('BFN20251287', $2, null, now(), 'voter', true, 'token-student-2', 'Mariam Aissatou Diallo', true),
       ('ACC20254502', $3, null, now(), 'aspirant_rep', true, 'token-rep-1', 'Kwesi Boadi Asante', true),
       ('PCC20252119', null, 'REP234', null, 'aspirant_rep', false, 'token-rep-2', 'Ruth Eniola Adebayo', true),
       ('ECADMIN01', $4, null, now(), 'ec_admin', false, 'token-ec-1', 'Electoral Commission Admin', true),
       ('CSM20254008', null, 'ACT23Q', null, 'voter', true, 'token-pending-1', 'Esther Wanjiku Njoroge', true)`,
    [seeded.voterAuthId, seeded.secondVoterAuthId, seeded.repAuthId, seeded.ecAuthId]
  );

  await harness.pool.query(
    `insert into public.positions (id, title, display_order, is_active)
     values
       ($1, 'President', 1, true),
       ($2, 'General Secretary', 2, true)`,
    [seeded.presidentPositionId, seeded.secretaryPositionId]
  );

  await harness.pool.query(
    `insert into public.candidates (id, position_id, full_name, ballot_num, photo_url, manifesto_url)
     values
       ($1, $2, 'Henry Kwaku Annorh', 1, null, null),
       ($3, $2, 'Justice Lay Amanfo', 2, null, null),
       ($4, $5, 'Vicotria Bamidele', 3, null, null)`,
    [
      seeded.firstCandidateId,
      seeded.presidentPositionId,
      seeded.secondCandidateId,
      seeded.thirdCandidateId,
      seeded.secretaryPositionId
    ]
  );

  const insertedConfig = await harness.pool.query<{ id: string }>(
    `insert into public.election_config (
       poll_opens,
       poll_closes,
       is_locked,
       results_counted_at,
       results_counted_by,
       results_released_at,
       results_released_by
     ) values ($1, $2, false, $3, $4, $5, $6)
     returning id`,
    [
      new Date(now + opensOffset),
      new Date(now + closesOffset),
      options?.countResults ? new Date(now).toISOString() : null,
      options?.countResults ? seeded.ecAuthId : null,
      options?.releaseResults ? new Date(now).toISOString() : null,
      options?.releaseResults ? seeded.ecAuthId : null
    ]
  );

  const electionConfigId = insertedConfig.rows[0]!.id;

  if (options?.countResults) {
    await harness.pool.query(
      `insert into public.result_verifications (
         election_config_id,
         verifier_auth_user_id,
         message
       ) values ($1, $2, 'I have checked the count and verified it.')`,
      [electionConfigId, seeded.repAuthId]
    );
  }
}

describe.sequential("SUC-VOTE activation flow integration", () => {
  const harness = new PostgresHarness();
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    await harness.start(migrationsPath);
    app = createApp({
      authProvider: new FakeAuthProvider(harness.pool, jwtSecret),
      broadcaster: new NoopResultsBroadcaster(),
      corsOrigin: "http://localhost:3000",
      hcaptchaSecret: "test-secret",
      hcaptchaSiteKey: "test-site-key",
      sessionVerifier: new JwtSessionVerifier(jwtSecret),
      store: new ElectionStore(harness.pool)
    });
  });

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await seedDatabase(harness);
  });

  async function loginStudent(studentId = "CSM20252340", password = "VoteSecure123!", ip = nextIp()) {
    return request(app)
      .post("/auth/login")
      .set("X-Forwarded-For", ip)
      .send({
        student_id: studentId,
        password,
        captcha_token: "test-captcha"
      });
  }

  function issueRoleToken(subject: string, role: StudentRole, canVote = false) {
    return jwt.sign(
      {
        sub: subject,
        role,
        can_vote: canVote,
        student_id: subject,
        voter_token: "hashed-token"
      },
      jwtSecret,
      { expiresIn: "1h" }
    );
  }

  it("cannot activate with an already-used activation code", async () => {
    const response = await request(app).post("/auth/activate").send({
      student_id: "CSM20252340",
      activation_code: "ABCD23",
      new_password: "NewPassword1",
      captcha_token: "test-captcha"
    });

    expect(response.status).toBe(401);
  });

  it("cannot activate with the wrong code even with the correct student ID", async () => {
    const response = await request(app).post("/auth/activate").send({
      student_id: "CSM20254008",
      activation_code: "ABCD23",
      new_password: "NewPassword1",
      captcha_token: "test-captcha"
    });

    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/invalid student id or activation code/i);
  });

  it("activates a pending account, burns the code, and auto-logs the user in", async () => {
    const response = await request(app).post("/auth/activate").send({
      student_id: "CSM20254008",
      activation_code: "ACT23Q",
      new_password: "NewPassword1",
      captcha_token: "test-captcha"
    });

    expect(response.status).toBe(200);
    expect(response.body.role).toBe("voter");

    const student = await harness.pool.query(
      `select activation_code, activated_at, auth_user_id
       from public.students
       where student_id = 'CSM20254008'`
    );

    expect(student.rows[0]?.activation_code).toBeNull();
    expect(student.rows[0]?.activated_at).not.toBeNull();
    expect(student.rows[0]?.auth_user_id).not.toBeNull();
  });

  it("allows only one winner when two activations race on the same code", async () => {
    const [first, second] = await Promise.all([
      request(app).post("/auth/activate").send({
        student_id: "CSM20254008",
        activation_code: "ACT23Q",
        new_password: "RacePass1",
        captcha_token: "test-captcha"
      }),
      request(app).post("/auth/activate").send({
        student_id: "CSM20254008",
        activation_code: "ACT23Q",
        new_password: "RacePass1",
        captcha_token: "test-captcha"
      })
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 401]);
  });

  it("cannot login if the account is not activated", async () => {
    const response = await loginStudent("CSM20254008", "Whatever123");

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/account not activated/i);
  });

  it("rate limits login after five failed attempts", async () => {
    const attempts = [];
    const rateLimitIp = "10.0.0.250";
    for (let count = 0; count < 6; count += 1) {
      attempts.push(
        request(app)
          .post("/auth/login")
          .set("X-Forwarded-For", rateLimitIp)
          .send({
            student_id: "CSM20252340",
            password: "WrongPassword1",
            captcha_token: "test-captcha"
          })
      );
    }

    const responses = await Promise.all(attempts);
    expect(responses.at(-1)?.status).toBe(429);
  });

  it("rejects the old password after reset activation", async () => {
    const ecToken = issueRoleToken(seeded.ecAuthId, "ec_admin");
    const reset = await request(app)
      .post("/auth/admin/reset-activation")
      .set("Authorization", `Bearer ${ecToken}`)
      .send({ student_id: "CSM20252340" });

    expect(reset.status).toBe(200);

    const login = await loginStudent("CSM20252340", "VoteSecure123!");
    expect(login.status).toBe(403);
  });

  it("allows EC admin to issue codes and blocks ordinary voters", async () => {
    const ecToken = issueRoleToken(seeded.ecAuthId, "ec_admin");
    const voterToken = issueRoleToken(seeded.voterAuthId, "voter", true);

    const allowed = await request(app)
      .post("/auth/admin/issue-codes")
      .set("Authorization", `Bearer ${ecToken}`)
      .send({
        entries: [
          {
            student_id: "HRM20250001",
            full_name: "Demo Student",
            role: "voter",
            can_vote: true
          }
        ]
      });

    expect(allowed.status).toBe(200);
    expect(allowed.body.issued).toHaveLength(1);

    const denied = await request(app)
      .post("/auth/admin/issue-codes")
      .set("Authorization", `Bearer ${voterToken}`)
      .send({
        entries: [
          {
            student_id: "HRM20250002",
            full_name: "Denied Student",
            role: "voter",
            can_vote: true
          }
        ]
      });

    expect(denied.status).toBe(403);
  });

  it("prevents double voting with a 409 response", async () => {
    const login = await loginStudent();
    expect(login.status).toBe(200);
    const token = login.body.access_token as string;

    const first = await request(app)
      .post("/vote")
      .set("Authorization", `Bearer ${token}`)
      .send({
        position_id: seeded.presidentPositionId,
        candidate_id: seeded.firstCandidateId
      });

    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/vote")
      .set("Authorization", `Bearer ${token}`)
      .send({
        position_id: seeded.presidentPositionId,
        candidate_id: seeded.firstCandidateId
      });

    expect(second.status).toBe(409);
  });

  it("rejects ballot access and voting for users who cannot vote", async () => {
    const repLogin = await loginStudent("ACC20254502", "VoteSecure123!");
    expect(repLogin.status).toBe(200);
    const repToken = repLogin.body.access_token as string;

    const blockedBallot = await request(app)
      .get("/ballot")
      .set("Authorization", `Bearer ${issueRoleToken(seeded.ecAuthId, "ec_admin", false)}`);

    expect(blockedBallot.status).toBe(403);

    const voteBlocked = await request(app)
      .post("/vote")
      .set("Authorization", `Bearer ${issueRoleToken(seeded.ecAuthId, "ec_admin", false)}`)
      .send({
        position_id: seeded.presidentPositionId,
        candidate_id: seeded.firstCandidateId
      });

    expect(voteBlocked.status).toBe(403);

    expect(repToken).toBeTruthy();
  });

  it("returns no rows when an authenticated voter selects directly from votes", async () => {
    await harness.pool.query(
      `insert into public.votes (position_id, candidate_id, voter_token)
       values ($1, $2, 'token-student-1')`,
      [seeded.presidentPositionId, seeded.firstCandidateId]
    );

    const result = await harness.asRole(
      "authenticated",
      { sub: seeded.voterAuthId, role: "authenticated" },
      async (client) => client.query("select * from public.votes")
    );

    expect(result.rows).toHaveLength(0);
  });

  it("records login and vote events in the audit log", async () => {
    const login = await loginStudent();
    const token = login.body.access_token as string;

    await request(app)
      .post("/vote")
      .set("Authorization", `Bearer ${token}`)
      .send({
        position_id: seeded.presidentPositionId,
        candidate_id: seeded.firstCandidateId
      });

    const audit = await harness.pool.query<{ event_type: string }>(
      `select event_type from public.audit_log order by id asc`
    );

    expect(audit.rows.map((row) => row.event_type)).toEqual(["LOGIN", "VOTE_CAST"]);
  });

  it("blocks rep results until the EC has counted them", async () => {
    await seedDatabase(harness, { pollClosesOffsetMs: -1_000, countResults: false });
    const repToken = issueRoleToken(seeded.repAuthId, "aspirant_rep", true);

    const response = await request(app)
      .get("/rep/results")
      .set("Authorization", `Bearer ${repToken}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/awaiting ec count/i);
  });

  it("records rep verification after EC count", async () => {
    await seedDatabase(harness, { pollClosesOffsetMs: -1_000, countResults: true });
    const repToken = issueRoleToken(seeded.repAuthId, "aspirant_rep", true);

    const response = await request(app)
      .post("/rep/verify")
      .set("Authorization", `Bearer ${repToken}`)
      .send({ message: "I have approved and verified this count." });

    expect(response.status).toBe(200);
    expect(response.body.verification_state.total_verifications).toBeGreaterThan(0);
  });

  it("does not allow public results before EC release", async () => {
    await seedDatabase(harness, { pollClosesOffsetMs: -1_000, countResults: true, releaseResults: false });

    const response = await request(app).get("/results");
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/awaiting ec release/i);
  });

  it("does not allow EC release before rep verification", async () => {
    await seedDatabase(harness, { pollClosesOffsetMs: -1_000, countResults: false, releaseResults: false });
    const ecToken = issueRoleToken(seeded.ecAuthId, "ec_admin");

    const counted = await request(app)
      .post("/ec/results/count")
      .set("Authorization", `Bearer ${ecToken}`)
      .send({});

    expect(counted.status).toBe(200);

    await harness.pool.query("delete from public.result_verifications");

    const response = await request(app)
      .post("/ec/results/release")
      .set("Authorization", `Bearer ${ecToken}`)
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/verification is required/i);
  });
});
