import { randomInt } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateActivationCode(): string {
  return Array.from({ length: 6 }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join("");
}

export async function generateUniqueCode(
  supabase: SupabaseClient
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateActivationCode();
    const { data, error } = await supabase
      .from("students")
      .select("id")
      .eq("activation_code", code)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return code;
    }
  }

  throw new Error("Could not generate unique activation code after 10 attempts");
}
