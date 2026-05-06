import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

import { loadWorkspaceEnv } from "./load-workspace-env.js";
import { normalizeDatabaseUrl } from "./normalize-database-url.js";

loadWorkspaceEnv();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

async function main() {
  const client = new Client({ connectionString: normalizeDatabaseUrl(databaseUrl!) });
  await client.connect();

  try {
    const migrationDir = path.resolve(process.cwd(), "migrations");
    const files = (await readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort();

    await client.query(`
      create table if not exists public.schema_migrations (
        file_name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    for (const file of files) {
      const alreadyApplied = await client.query<{ exists: boolean }>(
        `select exists (
           select 1
           from public.schema_migrations
           where file_name = $1
         ) as exists`,
        [file]
      );

      if (alreadyApplied.rows[0]?.exists) {
        console.log(`Skipping ${file}`);
        continue;
      }

      const sql = await readFile(path.join(migrationDir, file), "utf8");
      console.log(`Applying ${file}`);
      await client.query("begin");

      try {
        await client.query(sql);
        await client.query(
          `insert into public.schema_migrations (file_name)
           values ($1)
           on conflict (file_name) do nothing`,
          [file]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    console.log("Migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
