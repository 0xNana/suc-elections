import { Client } from "pg";

import { loadWorkspaceEnv } from "./load-workspace-env.js";
import { normalizeDatabaseUrl } from "./normalize-database-url.js";

loadWorkspaceEnv();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

const client = new Client({ connectionString: normalizeDatabaseUrl(databaseUrl) });

const candidates = [
  {
    positionTitle: "President",
    fullName: "Henry Kwaku Annorh",
    ballotNum: 1,
    photoUrl: null,
    manifestoUrl: null
  },
  {
    positionTitle: "President",
    fullName: "Justice Lay Amanfo",
    ballotNum: 2,
    photoUrl: null,
    manifestoUrl: null
  },
  {
    positionTitle: "General Secretary",
    fullName: "Vicotria Bamidele",
    ballotNum: 3,
    photoUrl: null,
    manifestoUrl: null
  }
] as const;

async function main() {
  await client.connect();

  try {
    await client.query("begin");

    const positionRows = await client.query<{ id: string; title: string }>(
      `select id, title
         from public.positions
        where title = any($1::text[])`,
      [[...new Set(candidates.map((candidate) => candidate.positionTitle))]]
    );

    const positionIds = new Map(positionRows.rows.map((row) => [row.title, row.id]));

    for (const positionTitle of new Set(candidates.map((candidate) => candidate.positionTitle))) {
      if (!positionIds.has(positionTitle)) {
        throw new Error(`Missing position: ${positionTitle}. Seed positions first.`);
      }
    }

    const applied: Array<{
      position_title: string;
      full_name: string;
      ballot_num: number;
      id: string;
      action: "inserted" | "updated";
    }> = [];

    for (const candidate of candidates) {
      const positionId = positionIds.get(candidate.positionTitle)!;

      const updated = await client.query<{ id: string }>(
        `update public.candidates
            set full_name = $3,
                photo_url = $4,
                manifesto_url = $5
          where position_id = $1
            and ballot_num = $2
          returning id`,
        [
          positionId,
          candidate.ballotNum,
          candidate.fullName,
          candidate.photoUrl,
          candidate.manifestoUrl
        ]
      );

      if (updated.rowCount && updated.rows[0]) {
        applied.push({
          position_title: candidate.positionTitle,
          full_name: candidate.fullName,
          ballot_num: candidate.ballotNum,
          id: updated.rows[0].id,
          action: "updated"
        });
        continue;
      }

      const inserted = await client.query<{ id: string }>(
        `insert into public.candidates (
           position_id,
           full_name,
           ballot_num,
           photo_url,
           manifesto_url
         ) values ($1, $2, $3, $4, $5)
         returning id`,
        [
          positionId,
          candidate.fullName,
          candidate.ballotNum,
          candidate.photoUrl,
          candidate.manifestoUrl
        ]
      );

      applied.push({
        position_title: candidate.positionTitle,
        full_name: candidate.fullName,
        ballot_num: candidate.ballotNum,
        id: inserted.rows[0]!.id,
        action: "inserted"
      });
    }

    await client.query("commit");

    console.log(
      JSON.stringify(
        {
          seeded_candidates: applied
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
