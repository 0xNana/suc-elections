import { randomBytes, randomInt } from "node:crypto";

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

const supabase = createClient(env.supabaseUrl!, env.serviceRoleKey!, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const client = new Client({ connectionString: normalizeDatabaseUrl(env.databaseUrl!) });

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const seededStudents = [
  {
    studentId: "SUC100001",
    fullName: "Ama Nyarko",
    role: "voter"
  },
  {
    studentId: "SUC100002",
    fullName: "Kwame Mensah",
    role: "voter"
  },
  {
    studentId: "SUC100003",
    fullName: "Akosua Lamptey",
    role: "aspirant_rep"
  }
] as const;

const seededAdmin = {
  studentId: "ECADMIN01",
  fullName: "Electoral Commission Admin",
  role: "ec_admin" as const,
  password: "EcSecure123!"
};

const positions = [
  { title: "President", displayOrder: 1 },
  { title: "General Secretary", displayOrder: 2 }
] as const;

const candidates = {
  President: [
    { fullName: "Henry Kwaku Annorh", ballotNum: 1 },
    { fullName: "Justice Lay Amanfo", ballotNum: 2 }
  ],
  "General Secretary": [
    { fullName: "Vicotria Bamidele", ballotNum: 3 }
  ]
} as const;

async function getOrCreateUser(email: string, password: string, role: string, fullName: string) {
  const existing = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const match = existing.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());

  if (match) {
    const updated = await supabase.auth.admin.updateUserById(match.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { role }
    });

    if (updated.error) {
      throw updated.error;
    }

    return updated.data.user;
  }

  const created = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role }
  });

  if (created.error) {
    throw created.error;
  }

  return created.data.user;
}

function generateActivationCode() {
  return Array.from({ length: 6 }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join("");
}

function buildSyntheticEmail(studentId: string) {
  return `${studentId}@suc-vote.internal`;
}

async function main() {
  const ecAdminUser = await getOrCreateUser(
    buildSyntheticEmail(seededAdmin.studentId),
    seededAdmin.password,
    seededAdmin.role,
    seededAdmin.fullName
  );

  await client.connect();

  try {
    await client.query("begin");
    await client.query("delete from public.votes");
    await client.query("delete from public.audit_log");
    await client.query("delete from public.candidates");
    await client.query("delete from public.positions");
    await client.query("delete from public.election_config");

    const now = new Date();
    const opens = new Date(now.getTime() - 60 * 60 * 1000);
    const closes = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await client.query(
      `insert into public.election_config (poll_opens, poll_closes, is_locked)
       values ($1, $2, false)`,
      [opens.toISOString(), closes.toISOString()]
    );

    const positionIds = new Map<string, string>();

    for (const position of positions) {
      const inserted = await client.query<{ id: string }>(
        `insert into public.positions (title, display_order, is_active)
         values ($1, $2, true)
         returning id`,
        [position.title, position.displayOrder]
      );
      positionIds.set(position.title, inserted.rows[0]!.id);
    }

    for (const [title, rowSet] of Object.entries(candidates)) {
      const positionId = positionIds.get(title);
      if (!positionId) {
        throw new Error(`Missing position for ${title}`);
      }

      for (const candidate of rowSet) {
        await client.query(
          `insert into public.candidates (
             position_id,
             full_name,
             ballot_num,
             photo_url,
             manifesto_url
           ) values ($1, $2, $3, $4, $5)`,
          [
            positionId,
            candidate.fullName,
            candidate.ballotNum,
            `https://images.suc-vote.example/${candidate.ballotNum}.jpg`,
            `https://manifesto.suc-vote.example/${candidate.ballotNum}.pdf`
          ]
        );
      }
    }

    const activationOutputs: Array<{ studentId: string; fullName: string; role: string; activationCode: string }> = [];

    for (const student of seededStudents) {
      const activationCode = generateActivationCode();
      activationOutputs.push({
        studentId: student.studentId,
        fullName: student.fullName,
        role: student.role,
        activationCode
      });

      await client.query(
        `insert into public.students (
           student_id,
           auth_user_id,
           activation_code,
           activated_at,
           role,
           voter_token,
           full_name,
           is_eligible
         ) values ($1, null, $2, null, $3, $4, $5, true)
         on conflict (student_id)
         do update set
           auth_user_id = excluded.auth_user_id,
           activation_code = excluded.activation_code,
           activated_at = excluded.activated_at,
           role = excluded.role,
           voter_token = excluded.voter_token,
           full_name = excluded.full_name,
           is_eligible = excluded.is_eligible`,
        [
          student.studentId,
          activationCode,
          student.role,
          randomBytes(24).toString("hex"),
          student.fullName
        ]
      );
    }

    await client.query(
      `insert into public.students (
         student_id,
         auth_user_id,
         activation_code,
         activated_at,
         role,
         voter_token,
         full_name,
         is_eligible
       ) values ($1, $2, null, now(), $3, $4, $5, true)
       on conflict (student_id)
       do update set
         auth_user_id = excluded.auth_user_id,
         activation_code = excluded.activation_code,
         activated_at = excluded.activated_at,
         role = excluded.role,
         voter_token = excluded.voter_token,
         full_name = excluded.full_name,
         is_eligible = excluded.is_eligible`,
      [
        seededAdmin.studentId,
        ecAdminUser.id,
        seededAdmin.role,
        randomBytes(24).toString("hex"),
        seededAdmin.fullName
      ]
    );

    await client.query("commit");

    console.log("Seed complete.");
    console.log("Activation codes:");
    for (const student of activationOutputs) {
      console.log(`- ${student.studentId} / ${student.role} / ${student.activationCode}`);
    }
    console.log(`EC admin: ${seededAdmin.studentId} / ${seededAdmin.password}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
