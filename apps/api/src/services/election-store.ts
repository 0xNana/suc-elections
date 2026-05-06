import type { Pool, PoolClient } from "pg";

import { DuplicateVoteError } from "../lib/errors.js";

export interface StudentRow {
  id: string;
  student_id: string;
  auth_user_id: string | null;
  activation_code: string | null;
  activated_at: Date | null;
  role: "voter" | "aspirant_rep" | "ec_admin";
  can_vote: boolean;
  voter_token: string;
  full_name: string;
  is_eligible: boolean;
  created_at: Date;
}

export interface ElectionConfigRow {
  id: string;
  poll_opens: Date;
  poll_closes: Date;
  is_locked: boolean;
  results_counted_at: Date | null;
  results_counted_by: string | null;
  results_released_at: Date | null;
  results_released_by: string | null;
}

export interface PositionCandidateRow {
  position_id: string;
  title: string;
  display_order: number;
  candidate_id: string;
  full_name: string;
  ballot_num: number;
  photo_url: string | null;
  manifesto_url: string | null;
}

export interface ResultsRow {
  position_id: string;
  position: string;
  display_order: number;
  candidate_id: string;
  candidate: string;
  ballot_num: number;
  photo_url: string | null;
  vote_count: number;
}

export interface AuditInsertInput {
  eventType: string;
  actorToken: string | null;
  ipAddress: string | null;
  payloadHash: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ResultVerificationRow {
  id: string;
  election_config_id: string;
  verifier_auth_user_id: string;
  message: string;
  verified_at: Date;
}

export interface AdminStudentRow {
  student_id: string;
  full_name: string;
  role: "voter" | "aspirant_rep" | "ec_admin";
  can_vote: boolean;
  activated: boolean;
  activated_at: Date | null;
  last_login_at: Date | null;
}

export class ElectionStore {
  public constructor(private readonly pool: Pool) {}

  public async findStudentByStudentId(studentId: string) {
    const result = await this.pool.query<StudentRow>(
      `select id, student_id, auth_user_id, activation_code, activated_at, role, can_vote, voter_token, full_name, is_eligible, created_at
       from public.students
       where student_id = $1`,
      [studentId]
    );

    return result.rows[0] ?? null;
  }

  public async findStudentByAuthUserId(authUserId: string) {
    const result = await this.pool.query<StudentRow>(
      `select id, student_id, auth_user_id, activation_code, activated_at, role, can_vote, voter_token, full_name, is_eligible, created_at
       from public.students
       where auth_user_id = $1`,
      [authUserId]
    );

    return result.rows[0] ?? null;
  }

  public async createStudentWithActivationCode(input: {
    studentId: string;
    fullName: string;
    role: "voter" | "aspirant_rep" | "ec_admin";
    canVote: boolean;
    activationCode: string;
  }) {
    const result = await this.pool.query<StudentRow>(
      `insert into public.students (
         student_id,
         full_name,
         role,
         can_vote,
         activation_code,
         voter_token,
         is_eligible
       ) values (
         $1,
         $2,
         $3,
         $4,
         $5,
         encode(gen_random_bytes(24), 'hex'),
         true
       )
       returning id, student_id, auth_user_id, activation_code, activated_at, role, can_vote, voter_token, full_name, is_eligible, created_at`,
      [input.studentId, input.fullName, input.role, input.canVote, input.activationCode]
    );

    return result.rows[0] ?? null;
  }

  public async refreshPendingStudentActivation(input: {
    studentId: string;
    fullName: string;
    role: "voter" | "aspirant_rep" | "ec_admin";
    canVote: boolean;
    activationCode: string;
  }) {
    const result = await this.pool.query<StudentRow>(
      `update public.students
       set
         full_name = $2,
         role = $3,
         can_vote = $4,
         activation_code = $5
       where student_id = $1
         and activated_at is null
       returning id, student_id, auth_user_id, activation_code, activated_at, role, can_vote, voter_token, full_name, is_eligible, created_at`,
      [input.studentId, input.fullName, input.role, input.canVote, input.activationCode]
    );

    return result.rows[0] ?? null;
  }

  public async activateStudentAccount(input: {
    studentId: string;
    activationCode: string;
    authUserId: string;
  }) {
    const result = await this.pool.query<StudentRow>(
      `update public.students
       set
         auth_user_id = $3,
         activated_at = now(),
         activation_code = null
       where student_id = $1
         and activation_code = $2
         and activated_at is null
       returning id, student_id, auth_user_id, activation_code, activated_at, role, can_vote, voter_token, full_name, is_eligible, created_at`,
      [input.studentId, input.activationCode, input.authUserId]
    );

    return result.rows[0] ?? null;
  }

  public async resetStudentActivation(input: {
    studentId: string;
    activationCode: string;
  }) {
    const result = await this.pool.query<StudentRow>(
      `update public.students
       set
         activation_code = $2,
         activated_at = null,
         auth_user_id = null
       where student_id = $1
       returning id, student_id, auth_user_id, activation_code, activated_at, role, can_vote, voter_token, full_name, is_eligible, created_at`,
      [input.studentId, input.activationCode]
    );

    return result.rows[0] ?? null;
  }

  public async updateStudentRole(input: {
    studentId: string;
    role: "voter" | "aspirant_rep" | "ec_admin";
    canVote?: boolean | undefined;
  }) {
    const result = await this.pool.query<StudentRow>(
      `update public.students
       set
         role = $2,
         can_vote = coalesce($3, can_vote)
       where student_id = $1
       returning id, student_id, auth_user_id, activation_code, activated_at, role, can_vote, voter_token, full_name, is_eligible, created_at`,
      [input.studentId, input.role, input.canVote ?? null]
    );

    return result.rows[0] ?? null;
  }

  public async listStudentsForAdmin(input: {
    search?: string | undefined;
    role?: "voter" | "aspirant_rep" | "ec_admin" | undefined;
    activationStatus: "all" | "activated" | "pending";
  }) {
    const search = input.search?.trim() || null;
    const role = input.role ?? null;
    const activationStatus = input.activationStatus;

    const result = await this.pool.query<AdminStudentRow>(
      `select
         s.student_id,
         s.full_name,
         s.role,
         s.can_vote,
         (s.activated_at is not null) as activated,
         s.activated_at,
         last_login.logged_at as last_login_at
       from public.students s
       left join lateral (
         select a.logged_at
         from public.audit_log a
         where a.event_type = 'LOGIN'
           and a.actor_token = s.voter_token
         order by a.logged_at desc
         limit 1
       ) last_login on true
       where
         ($1::text is null
           or s.student_id ilike '%' || $1 || '%'
           or s.full_name ilike '%' || $1 || '%')
         and ($2::text is null or s.role = $2)
         and (
           $3::text = 'all'
           or ($3::text = 'activated' and s.activated_at is not null)
           or ($3::text = 'pending' and s.activated_at is null)
         )
       order by s.full_name asc`,
      [search, role, activationStatus]
    );

    return result.rows;
  }

  public async getElectionConfig() {
    const result = await this.pool.query<ElectionConfigRow>(
      `select id, poll_opens, poll_closes, is_locked, results_counted_at, results_counted_by, results_released_at, results_released_by
       from public.election_config
       order by poll_closes desc
       limit 1`
    );

    return result.rows[0] ?? null;
  }

  public async getBallotRows() {
    const result = await this.pool.query<PositionCandidateRow>(
      `select
         p.id as position_id,
         p.title,
         p.display_order,
         c.id as candidate_id,
         c.full_name,
         c.ballot_num,
         c.photo_url,
         c.manifesto_url
       from public.positions p
       join public.candidates c
         on c.position_id = p.id
       where p.is_active = true
       order by p.display_order asc, c.ballot_num asc`
    );

    return result.rows;
  }

  public async getVotedPositionIds(voterToken: string) {
    const result = await this.pool.query<{ position_id: string }>(
      `select position_id
       from public.votes
       where voter_token = $1`,
      [voterToken]
    );

    return result.rows.map((row) => row.position_id);
  }

  public async candidateExists(positionId: string, candidateId: string) {
    const result = await this.pool.query(
      `select 1
       from public.candidates
       where id = $1 and position_id = $2`,
      [candidateId, positionId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async insertAuditEvent(input: AuditInsertInput) {
    await this.pool.query(
      `insert into public.audit_log (event_type, actor_token, ip_address, payload_hash, metadata)
       values ($1, $2, $3, $4, $5)`,
      [input.eventType, input.actorToken, input.ipAddress, input.payloadHash, input.metadata]
    );
  }

  public async castVote(input: {
    positionId: string;
    candidateId: string;
    voterToken: string;
    ipAddress: string | null;
    confirmationHash: string;
  }) {
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      const insertVote = await client.query<{ id: string; cast_at: Date }>(
        `insert into public.votes (position_id, candidate_id, voter_token)
         values ($1, $2, $3)
         returning id, cast_at`,
        [input.positionId, input.candidateId, input.voterToken]
      );

      const vote = insertVote.rows[0]!;

      await this.insertAuditEventWithClient(client, {
        eventType: "VOTE_CAST",
        actorToken: input.voterToken,
        ipAddress: input.ipAddress,
        payloadHash: input.confirmationHash,
        metadata: {
          vote_id: vote.id,
          position_id: input.positionId,
          candidate_id: input.candidateId,
          confirmation_hash: input.confirmationHash
        }
      });

      await client.query("commit");

      return {
        id: vote.id,
        castAt: vote.cast_at
      };
    } catch (error) {
      await client.query("rollback");

      const pgError = error as { code?: string };
      if (pgError.code === "23505") {
        throw new DuplicateVoteError();
      }

      throw error;
    } finally {
      client.release();
    }
  }

  public async getResults() {
    const result = await this.pool.query<ResultsRow>(
      `select
         position_id,
         position,
         display_order,
         candidate_id,
         candidate,
         ballot_num,
         photo_url,
         vote_count
       from public.results
       order by display_order asc, vote_count desc, ballot_num asc`
    );

    return result.rows;
  }

  public async getRepSummary() {
    const result = await this.pool.query<{ total_votes_cast: string; total_eligible: string }>(
      `select
         (select count(*) from public.votes)::text as total_votes_cast,
         (select count(*) from public.students where is_eligible = true)::text as total_eligible`
    );

    const row = result.rows[0]!;

    return {
      total_votes_cast: Number.parseInt(row.total_votes_cast, 10),
      total_eligible: Number.parseInt(row.total_eligible, 10)
    };
  }

  public async releaseResults(ecAuthUserId: string) {
    const result = await this.pool.query<ElectionConfigRow>(
      `update public.election_config
       set
         results_released_at = coalesce(results_released_at, now()),
         results_released_by = coalesce(results_released_by, $1)
       where id = (
         select id
         from public.election_config
         order by poll_closes desc
         limit 1
       )
       returning id, poll_opens, poll_closes, is_locked, results_counted_at, results_counted_by, results_released_at, results_released_by`,
      [ecAuthUserId]
    );

    return result.rows[0] ?? null;
  }

  public async countResults(ecAuthUserId: string) {
    const result = await this.pool.query<ElectionConfigRow>(
      `update public.election_config
       set
         results_counted_at = coalesce(results_counted_at, now()),
         results_counted_by = coalesce(results_counted_by, $1),
         results_released_at = null,
         results_released_by = null
       where id = (
         select id
         from public.election_config
         order by poll_closes desc
         limit 1
       )
       returning id, poll_opens, poll_closes, is_locked, results_counted_at, results_counted_by, results_released_at, results_released_by`,
      [ecAuthUserId]
    );

    return result.rows[0] ?? null;
  }

  public async updateElectionConfig(input: {
    pollOpens: string;
    pollCloses: string;
    isLocked: boolean;
  }) {
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      const result = await client.query<ElectionConfigRow>(
        `update public.election_config
         set
           poll_opens = $1,
           poll_closes = $2,
           is_locked = $3,
           results_counted_at = null,
           results_counted_by = null,
           results_released_at = null,
           results_released_by = null
         where id = (
           select id
           from public.election_config
           order by poll_closes desc
           limit 1
         )
         returning id, poll_opens, poll_closes, is_locked, results_counted_at, results_counted_by, results_released_at, results_released_by`,
        [input.pollOpens, input.pollCloses, input.isLocked]
      );

      const config = result.rows[0] ?? null;
      if (config) {
        await client.query(`delete from public.result_verifications where election_config_id = $1`, [config.id]);
      }

      await client.query("commit");
      return config;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  public async openPollNow() {
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      const result = await client.query<ElectionConfigRow>(
        `update public.election_config
         set
           poll_opens = now(),
           poll_closes = case
             when poll_closes <= now() then now() + interval '4 hours'
             else poll_closes
           end,
           is_locked = false,
           results_counted_at = null,
           results_counted_by = null,
           results_released_at = null,
           results_released_by = null
         where id = (
           select id
           from public.election_config
           order by poll_closes desc
           limit 1
         )
         returning id, poll_opens, poll_closes, is_locked, results_counted_at, results_counted_by, results_released_at, results_released_by`
      );

      const config = result.rows[0] ?? null;
      if (config) {
        await client.query(`delete from public.result_verifications where election_config_id = $1`, [config.id]);
      }

      await client.query("commit");
      return config;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  public async closePollNow() {
    const result = await this.pool.query<ElectionConfigRow>(
      `update public.election_config
       set
         poll_closes = now(),
         is_locked = true
       where id = (
         select id
         from public.election_config
         order by poll_closes desc
         limit 1
       )
       returning id, poll_opens, poll_closes, is_locked, results_counted_at, results_counted_by, results_released_at, results_released_by`
    );

    return result.rows[0] ?? null;
  }

  public async listResultVerifications(electionConfigId: string) {
    const result = await this.pool.query<ResultVerificationRow>(
      `select id, election_config_id, verifier_auth_user_id, message, verified_at
       from public.result_verifications
       where election_config_id = $1
       order by verified_at asc`,
      [electionConfigId]
    );

    return result.rows;
  }

  public async saveResultVerification(input: {
    electionConfigId: string;
    verifierAuthUserId: string;
    message: string;
  }) {
    const result = await this.pool.query<ResultVerificationRow>(
      `insert into public.result_verifications (
         election_config_id,
         verifier_auth_user_id,
         message
       ) values ($1, $2, $3)
       on conflict (election_config_id, verifier_auth_user_id)
       do update set
         message = excluded.message,
         verified_at = now()
       returning id, election_config_id, verifier_auth_user_id, message, verified_at`,
      [input.electionConfigId, input.verifierAuthUserId, input.message]
    );

    return result.rows[0] ?? null;
  }

  public async listAuditEntries(input: { page: number; pageSize: number; search?: string | undefined }) {
    const offset = (input.page - 1) * input.pageSize;
    const search = input.search?.trim() || null;

    const [countResult, rowsResult] = await Promise.all([
      this.pool.query<{ total: string }>(
        `select count(*)::text as total
         from public.audit_log
         where $1::text is null
            or event_type ilike '%' || $1 || '%'
            or coalesce(actor_token, '') ilike '%' || $1 || '%'
            or coalesce(metadata::text, '') ilike '%' || $1 || '%'`,
        [search]
      ),
      this.pool.query<{
        id: number;
        event_type: string;
        actor_token: string | null;
        ip_address: string | null;
        payload_hash: string | null;
        metadata: Record<string, unknown> | null;
        logged_at: Date;
      }>(
        `select id, event_type, actor_token, ip_address::text, payload_hash, metadata, logged_at
         from public.audit_log
         where $1::text is null
            or event_type ilike '%' || $1 || '%'
            or coalesce(actor_token, '') ilike '%' || $1 || '%'
            or coalesce(metadata::text, '') ilike '%' || $1 || '%'
         order by logged_at desc
         limit $2
         offset $3`,
        [search, input.pageSize, offset]
      )
    ]);

    return {
      total: Number.parseInt(countResult.rows[0]!.total, 10),
      entries: rowsResult.rows
    };
  }

  private async insertAuditEventWithClient(client: PoolClient, input: AuditInsertInput) {
    await client.query(
      `insert into public.audit_log (event_type, actor_token, ip_address, payload_hash, metadata)
       values ($1, $2, $3, $4, $5)`,
      [input.eventType, input.actorToken, input.ipAddress, input.payloadHash, input.metadata]
    );
  }
}
