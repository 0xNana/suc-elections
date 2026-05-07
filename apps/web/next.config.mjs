import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../../.env.local"),
  path.resolve(__dirname, ".env"),
  path.resolve(__dirname, ".env.local")
];

for (const file of envCandidates) {
  if (existsSync(file)) {
    const content = readFileSync(file, "utf8");

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
      process.env[key] = value;
    }
  }
}

function getOrigin(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function readRequiredPublicEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const supabaseUrl = readRequiredPublicEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = readRequiredPublicEnv(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);
const apiUrl = readRequiredPublicEnv(
  "NEXT_PUBLIC_API_URL",
  process.env.NODE_ENV === "production" ? undefined : "http://localhost:4000"
);

const apiOrigin = getOrigin(apiUrl);
const supabaseOrigin = getOrigin(supabaseUrl);
const supabaseRealtimeOrigin = supabaseOrigin?.replace(/^http/, "ws") ?? null;
const connectSrc = ["'self'", apiOrigin, supabaseOrigin, supabaseRealtimeOrigin].filter(Boolean).join(" ");
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self' https://admissions.southshore.edu.gh",
  "img-src 'self' data: https://www.southshore.edu.gh",
  "media-src 'self' https://www.southshore.edu.gh",
  `connect-src ${connectSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "font-src 'self' data:"
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  transpilePackages: ["@suc-vote/shared", "@suc-vote/db"],
  async headers() {
    if (process.env.NODE_ENV !== "production") {
      return [];
    }

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" }
        ]
      }
    ];
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_HCAPTCHA_SITE_KEY:
      process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ??
      process.env.HCAPTCHA_SITE_KEY ??
      "ab043336-4a7c-4ea2-a284-7836a49c63fa"
  }
};

export default nextConfig;
