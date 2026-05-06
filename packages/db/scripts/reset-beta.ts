import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { loadWorkspaceEnv } from "./load-workspace-env.js";
import { normalizeDatabaseUrl } from "./normalize-database-url.js";

loadWorkspaceEnv();

const env = {
  databaseUrl: process.env.DATABASE_URL,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceRoleKey:
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SECRET_KEY
};

for (const [key, value] of Object.entries(env)) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const pg = new Client({ connectionString: normalizeDatabaseUrl(env.databaseUrl!) });
const supabase = createClient(env.supabaseUrl!, env.serviceRoleKey!, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

function isProjectAuthEmail(email: string | null | undefined) {
  const value = (email ?? "").toLowerCase();
  return value.endsWith("@suc-vote.internal") || value.endsWith("@suc-vote.local");
}

async function main() {
  await pg.connect();

  try {
    const usersResponse = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersResponse.error) {
      throw usersResponse.error;
    }

    const authUsersToDelete = usersResponse.data.users.filter((user) => isProjectAuthEmail(user.email));

    await pg.query("begin");
    await pg.query(
      "truncate table public.result_verifications, public.votes, public.audit_log, public.candidates, public.positions, public.election_config, public.students restart identity cascade"
    );
    await pg.query("commit");

    const deletedAuthUsers: string[] = [];
    const failedAuthDeletes: Array<{ email: string | null | undefined; error: string }> = [];

    for (const user of authUsersToDelete) {
      const deleted = await supabase.auth.admin.deleteUser(user.id);
      if (deleted.error) {
        failedAuthDeletes.push({
          email: user.email,
          error: deleted.error.message
        });
        continue;
      }

      deletedAuthUsers.push(user.email ?? user.id);
    }

    console.log(
      JSON.stringify(
        {
          reset: "complete",
          truncated_tables: [
            "public.result_verifications",
            "public.votes",
            "public.audit_log",
            "public.candidates",
            "public.positions",
            "public.election_config",
            "public.students"
          ],
          deleted_auth_users: deletedAuthUsers,
          failed_auth_deletes: failedAuthDeletes
        },
        null,
        2
      )
    );
  } catch (error) {
    await pg.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
