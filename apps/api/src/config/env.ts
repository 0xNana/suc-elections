export interface ApiEnv {
  port: number;
  databaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  jwtSecret: string | undefined;
  corsOrigin: string;
  hcaptchaSecret: string;
  hcaptchaSiteKey: string;
}

function readRequired(...names: string[]) {
  const value = names.map((name) => process.env[name]).find(Boolean);
  if (!value) {
    throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
  }

  return value;
}

export function loadEnv(): ApiEnv {
  return {
    port: Number.parseInt(process.env.PORT ?? "4000", 10),
    databaseUrl: readRequired("DATABASE_URL"),
    supabaseUrl: readRequired("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: readRequired(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_ANON_KEY"
    ),
    supabaseServiceRoleKey: readRequired(
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
      "SUPABASE_SECRET_KEY"
    ),
    jwtSecret: process.env.JWT_SECRET,
    corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
    hcaptchaSecret: process.env.HCAPTCHA_SECRET ?? "ES_7d4c434b3ebb4c19b838301e49db888d",
    hcaptchaSiteKey:
      process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ??
      process.env.HCAPTCHA_SITE_KEY ??
      "ab043336-4a7c-4ea2-a284-7836a49c63fa"
  };
}
