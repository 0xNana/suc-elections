import { Pool } from "pg";

import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { loadWorkspaceEnv } from "./config/load-workspace-env.js";
import { normalizeDatabaseUrl } from "./lib/normalize-database-url.js";
import { SupabaseAuthProvider } from "./services/auth-provider.js";
import { ElectionStore } from "./services/election-store.js";
import {
  NoopResultsBroadcaster,
  SupabaseResultsBroadcaster
} from "./services/results-broadcaster.js";
import {
  JwtSessionVerifier,
  SupabaseSessionVerifier
} from "./services/session-verifier.js";

loadWorkspaceEnv();
const env = loadEnv();
const pool = new Pool({
  connectionString: normalizeDatabaseUrl(env.databaseUrl),
  max: 5
});

const app = createApp({
  authProvider: new SupabaseAuthProvider(
    env.supabaseUrl,
    env.supabaseAnonKey,
    env.supabaseServiceRoleKey
  ),
  broadcaster:
    process.env.NODE_ENV === "test"
      ? new NoopResultsBroadcaster()
      : new SupabaseResultsBroadcaster(env.supabaseUrl, env.supabaseServiceRoleKey),
  corsOrigin: env.corsOrigin,
  hcaptchaSecret: env.hcaptchaSecret,
  hcaptchaSiteKey: env.hcaptchaSiteKey,
  sessionVerifier: env.jwtSecret
    ? new JwtSessionVerifier(env.jwtSecret)
    : new SupabaseSessionVerifier(env.supabaseUrl, env.supabaseServiceRoleKey),
  store: new ElectionStore(pool)
});

app.disable("x-powered-by");

const server = app.listen(env.port, () => {
  console.log(`SUC-VOTE API listening on port ${env.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  });
}
