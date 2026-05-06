import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Pool, type PoolClient } from "pg";

const execFileAsync = promisify(execFile);

export class PostgresHarness {
  public readonly port = randomInt(20_000, 40_000);
  public readonly dataDirPromise = mkdtemp(path.join(os.tmpdir(), "suc-vote-pg-"));
  public connectionString = "";
  public pool!: Pool;

  public async start(migrationsPath: string) {
    const dataDir = await this.dataDirPromise;
    const logFile = path.join(dataDir, "postgres.log");

    await execFileAsync("initdb", ["-D", dataDir, "-A", "trust", "-U", "postgres", "--no-locale"]);
    await execFileAsync("pg_ctl", [
      "-D",
      dataDir,
      "-l",
      logFile,
      "-o",
      `-F -p ${this.port} -k ${dataDir}`,
      "start"
    ]);

    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await execFileAsync("pg_isready", ["-h", "127.0.0.1", "-p", String(this.port), "-d", "postgres"]);
        break;
      } catch (error) {
        if (attempt === 59) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    this.connectionString = `postgresql://postgres@127.0.0.1:${this.port}/postgres`;
    this.pool = new Pool({ connectionString: this.connectionString });

    await this.bootstrapSupabaseCompat();

    const stats = await readdir(migrationsPath, { withFileTypes: true });
    const files = stats
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name)
      .sort();

    for (const file of files) {
      console.log(`Applying test migration ${file}`);
      const migrationSql = (await readFile(path.join(migrationsPath, file), "utf8")).replace(
        /^create extension if not exists pgcrypto;\s*/m,
        ""
      );
      await this.pool.query(migrationSql);
      console.log(`Applied test migration ${file}`);
    }
  }

  public async stop() {
    const dataDir = await this.dataDirPromise;

    if (this.pool) {
      await this.pool.end();
    }

    await execFileAsync("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"]).catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }

  public async resetData() {
    await this.pool.query(
      "truncate table public.result_verifications, public.votes, public.audit_log, public.candidates, public.positions, public.students, public.election_config restart identity cascade"
    );
    await this.pool.query("truncate table auth.users restart identity cascade");
  }

  public async asRole<T>(
    role: "authenticated" | "anon" | "service_role",
    claims: Record<string, unknown>,
    callback: (client: PoolClient) => Promise<T>
  ) {
    const quotedClaims = JSON.stringify(claims).replace(/'/g, "''");
    const client = await this.pool.connect();

    await client.query("begin");
    await client.query(`set local role ${role}`);
    await client.query(`select set_config('request.jwt.claims', '${quotedClaims}', true)`);

    try {
      const result = await callback(client);
      await client.query("rollback");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async bootstrapSupabaseCompat() {
    await this.pool.query(`
      create schema if not exists auth;

      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then
          create role anon nologin;
        end if;

        if not exists (select 1 from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin;
        end if;

        if not exists (select 1 from pg_roles where rolname = 'service_role') then
          create role service_role nologin bypassrls;
        end if;
      end $$;

      create table if not exists auth.users (
        id uuid primary key,
        email text unique not null
      );

      create or replace function auth.jwt()
      returns jsonb
      language sql
      stable
      as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
      $$;

      create or replace function auth.uid()
      returns uuid
      language sql
      stable
      as $$
        select nullif(auth.jwt() ->> 'sub', '')::uuid;
      $$;

      create or replace function public.gen_random_uuid()
      returns uuid
      language sql
      volatile
      as $$
        select (
          substr(md5(random()::text || clock_timestamp()::text), 1, 8) || '-' ||
          substr(md5(random()::text || clock_timestamp()::text), 1, 4) || '-' ||
          '4' || substr(md5(random()::text || clock_timestamp()::text), 1, 3) || '-' ||
          substr('89ab', 1 + floor(random() * 4)::int, 1) || substr(md5(random()::text || clock_timestamp()::text), 1, 3) || '-' ||
          substr(md5(random()::text || clock_timestamp()::text) || md5(clock_timestamp()::text || random()::text), 1, 12)
        )::uuid;
      $$;

      create or replace function public.gen_random_bytes(length integer)
      returns bytea
      language sql
      volatile
      as $$
        select decode(
          substr(
            repeat(md5(random()::text || clock_timestamp()::text), ceil((length * 2)::numeric / 32)::int),
            1,
            length * 2
          ),
          'hex'
        );
      $$;

      grant usage on schema public to anon, authenticated, service_role;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.jwt() to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
    `);
  }
}
