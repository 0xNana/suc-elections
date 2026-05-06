import { existsSync } from "node:fs";
import path from "node:path";

import { config as loadDotenv } from "dotenv";

export function loadWorkspaceEnv() {
  const candidates = [
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(process.cwd(), "../../.env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), ".env.local")
  ];

  for (const file of candidates) {
    if (existsSync(file)) {
      loadDotenv({ path: file, override: true });
    }
  }
}
