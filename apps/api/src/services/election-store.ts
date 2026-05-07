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

export interface RepRegisterRow {
  student_id: string;
  full_name: string;
  can_vote: boolean;
}

export interface ElectionSetupSummary {
  positions_count: number;
  candidates_count: number;
  eligible_voters: number;
  activated_users: number;
  votes_cast: number;
  is_ready_for_polling: boolean;
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
    page: number;
    pageSize: number;
    search?: string | undefined;
    role?: "voter" | "aspirant_rep" | "ec_admin" | undefined;
    activationStatus: "all" | "activated" | "pending";
  }) {
    const offset = (input.page - 1) * input.pageSize;
    const search = input.search?.trim() || null;
    const role = input.role ?? null;
    const activationStatus = input.activationStatus;

    const [countResult, rowsResult] = await Promise.all([
      this.pool.query<{ total: string }>(
        `select count(*)::text as total
         from public.students s
         where
           ($1::text is null
             or s.student_id ilike '%' || $1 || '%'
             or s.full_name ilike '%' || $1 || '%')
           and ($2::text is null or s.role = $2)
           and (
             $3::text = 'all'
             or ($3::text = 'activated' and s.activated_at is not null)
             or ($3::text = 'pending' and s.activated_at is null)
           )`,
        [search, role, activationStatus]
      ),
      this.pool.query<AdminStudentRow>(
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
         order by s.full_name asc
         limit $4
         offset $5`,
        [search, role, activationStatus, input.pageSize, offset]
      )
    ]);

    return {
      rows: rowsResult.rows,
      total: Number.parseInt(countResult.rows[0]!.total, 10)
    };
  }

  public async listRepRegisterRows(input?: { page: number; pageSize: number }) {
    const page = input?.page ?? 1;
    const pageSize = input?.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const [countResult, rowsResult] = await Promise.all([
      this.pool.query<{ total: string }>(
        `select count(*)::text as total
         from public.students
         where is_eligible = true`
      ),
      this.pool.query<RepRegisterRow>(
      `select
         student_id,
         full_name,
         can_vote
       from public.students
       where is_eligible = true
       order by full_name asc
       limit $1
       offset $2`,
        [pageSize, offset]
      )
    ]);

    return {
      rows: rowsResult.rows,
      total: Number.parseInt(countResult.rows[0]!.total, 10)
    };
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

  public async getElectionSetupSummary() {
    const result = await this.pool.query<{
      positions_count: string;
      candidates_count: string;
      eligible_voters: string;
      activated_users: string;
      votes_cast: string;
    }>(
      `select
         (select count(*) from public.positions where is_active = true)::text as positions_count,
         (select count(*) from public.candidates)::text as candidates_count,
         (select count(*) from public.students where is_eligible = true and can_vote = true)::text as eligible_voters,
         (select count(*) from public.students where activated_at is not null)::text as activated_users,
         (select count(*) from public.votes)::text as votes_cast`
    );

    const row = result.rows[0]!;
    const summary: ElectionSetupSummary = {
      positions_count: Number.parseInt(row.positions_count, 10),
      candidates_count: Number.parseInt(row.candidates_count, 10),
      eligible_voters: Number.parseInt(row.eligible_voters, 10),
      activated_users: Number.parseInt(row.activated_users, 10),
      votes_cast: Number.parseInt(row.votes_cast, 10),
      is_ready_for_polling:
        Number.parseInt(row.positions_count, 10) > 0 &&
        Number.parseInt(row.candidates_count, 10) > 0
    };

    return summary;
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

  public async upsertElectionConfig(input: {
    pollOpens: string;
    pollCloses: string;
    isLocked: boolean;
  }) {
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      const existing = await this.getElectionConfigWithClient(client);

      let config: ElectionConfigRow | null = null;
      if (existing) {
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
           where id = $4
           returning id, poll_opens, poll_closes, is_locked, results_counted_at, results_counted_by, results_released_at, results_released_by`,
          [input.pollOpens, input.pollCloses, input.isLocked, existing.id]
        );
        config = result.rows[0] ?? null;
      } else {
        const result = await client.query<ElectionConfigRow>(
          `insert into public.election_config (
             poll_opens,
             poll_closes,
             is_locked,
             results_counted_at,
             results_counted_by,
             results_released_at,
             results_released_by
           ) values ($1, $2, $3, null, null, null, null)
           returning id, poll_opens, poll_closes, is_locked, results_counted_at, results_counted_by, results_released_at, results_released_by`,
          [input.pollOpens, input.pollCloses, input.isLocked]
        );
        config = result.rows[0] ?? null;
      }

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
      const existing = await this.getElectionConfigWithClient(client);
      let result;
      if (existing) {
        result = await client.query<ElectionConfigRow>(
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
           where id = $1
           returning id, poll_opens, poll_closes, is_locked, results_counted_at, results_counted_by, results_released_at, results_released_by`,
          [existing.id]
        );
      } else {
        result = await client.query<ElectionConfigRow>(
          `insert into public.election_config (
             poll_opens,
             poll_closes,
             is_locked,
             results_counted_at,
             results_counted_by,
             results_released_at,
             results_released_by
           ) values (now(), now() + interval '4 hours', false, null, null, null, null)
           returning id, poll_opens, poll_closes, is_locked, results_counted_at, results_counted_by, results_released_at, results_released_by`
        );
      }

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

  public async extendPollByMinutes(minutes: number) {
    const result = await this.pool.query<ElectionConfigRow>(
      `update public.election_config
       set
         poll_closes = case
           when poll_closes <= now() then now() + make_interval(mins => $1)
           else poll_closes + make_interval(mins => $1)
         end
       where id = (
         select id
         from public.election_config
         order by poll_closes desc
         limit 1
       )
       returning id, poll_opens, poll_closes, is_locked, results_counted_at, results_counted_by, results_released_at, results_released_by`,
      [minutes]
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

  public async listAuditEntries(input: {
    page: number;
    pageSize: number;
    search?: string | undefined;
    event_type?: string | undefined;
  }) {
    const offset = (input.page - 1) * input.pageSize;
    const search = input.search?.trim() || null;
    const eventType = input.event_type?.trim() || null;

    const [countResult, rowsResult, eventCountsResult] = await Promise.all([
      this.pool.query<{ total: string }>(
        `select count(*)::text as total
         from public.audit_log
         where ($1::text is null or event_type = $1)
           and (
             $2::text is null
             or event_type ilike '%' || $2 || '%'
             or coalesce(actor_token, '') ilike '%' || $2 || '%'
             or coalesce(metadata::text, '') ilike '%' || $2 || '%'
           )`,
        [eventType, search]
      ),
      this.pool.query<{
        id: number;
        event_type: string;
        actor_token: string | null;
        actor_role: "voter" | "aspirant_rep" | "ec_admin" | null;
        ip_address: string | null;
        payload_hash: string | null;
        metadata: Record<string, unknown> | null;
        logged_at: Date;
      }>(
        `select
           a.id,
           a.event_type,
           a.actor_token,
           actor_student.role::text as actor_role,
           a.ip_address::text,
           a.payload_hash,
           a.metadata,
           a.logged_at
         from public.audit_log a
         left join lateral (
           select s.role
           from public.students s
           where s.voter_token = a.actor_token
              or s.auth_user_id::text = a.actor_token
              or s.student_id = coalesce(a.metadata ->> 'student_id', a.metadata ->> 'target_student_id')
           order by case
             when s.voter_token = a.actor_token then 1
             when s.auth_user_id::text = a.actor_token then 2
             when s.student_id = a.metadata ->> 'student_id' then 3
             when s.student_id = a.metadata ->> 'target_student_id' then 4
             else 5
           end
           limit 1
         ) actor_student on true
         where ($1::text is null or a.event_type = $1)
           and (
            $2::text is null
            or a.event_type ilike '%' || $2 || '%'
            or coalesce(a.actor_token, '') ilike '%' || $2 || '%'
            or coalesce(a.metadata::text, '') ilike '%' || $2 || '%'
         )
         order by a.logged_at desc
         limit $3
         offset $4`,
        [eventType, search, input.pageSize, offset]
      ),
      this.pool.query<{ event_type: string; total: string }>(
        `select event_type, count(*)::text as total
         from public.audit_log
         where $1::text is null
            or event_type ilike '%' || $1 || '%'
            or coalesce(actor_token, '') ilike '%' || $1 || '%'
            or coalesce(metadata::text, '') ilike '%' || $1 || '%'
         group by event_type
         order by count(*) desc, event_type asc`,
        [search]
      )
    ]);

    const eventCounts = Object.fromEntries(
      eventCountsResult.rows.map((row) => [row.event_type, Number.parseInt(row.total, 10)])
    );

    return {
      event_counts: eventCounts,
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

  private async getElectionConfigWithClient(client: PoolClient) {
    const result = await client.query<ElectionConfigRow>(
      `select id, poll_opens, poll_closes, is_locked, results_counted_at, results_counted_by, results_released_at, results_released_by
       from public.election_config
       order by poll_closes desc
       limit 1`
    );

    return result.rows[0] ?? null;
  }
}
