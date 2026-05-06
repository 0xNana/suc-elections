import { Client } from "pg";

import { loadWorkspaceEnv } from "./load-workspace-env.js";
import { normalizeDatabaseUrl } from "./normalize-database-url.js";

loadWorkspaceEnv();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

const client = new Client({ connectionString: normalizeDatabaseUrl(databaseUrl) });

const positions = [
  { title: "President", displayOrder: 1 },
  { title: "General Secretary", displayOrder: 2 }
] as const;

async function main() {
  await client.connect();

  try {
    await client.query("begin");

    const applied: Array<{ title: string; display_order: number; id: string; action: "inserted" | "updated" }> = [];

    for (const position of positions) {
      const updated = await client.query<{ id: string }>(
        `update public.positions
            set display_order = $2,
                is_active = true
          where title = $1
          returning id`,
        [position.title, position.displayOrder]
      );

      if (updated.rowCount && updated.rows[0]) {
        applied.push({
          title: position.title,
          display_order: position.displayOrder,
          id: updated.rows[0].id,
          action: "updated"
        });
        continue;
      }

      const inserted = await client.query<{ id: string }>(
        `insert into public.positions (title, display_order, is_active)
         values ($1, $2, true)
         returning id`,
        [position.title, position.displayOrder]
      );

      applied.push({
        title: position.title,
        display_order: position.displayOrder,
        id: inserted.rows[0]!.id,
        action: "inserted"
      });
    }

    await client.query("commit");

    console.log(
      JSON.stringify(
        {
          seeded_positions: applied
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
