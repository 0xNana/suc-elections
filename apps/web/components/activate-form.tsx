"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { activateStudentAccount, BackendError } from "../lib/api";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";
import { SiteFrame } from "./site-frame";

function getRoleDestination(role?: string) {
  if (role === "aspirant_rep") {
    return "/rep/dashboard";
  }

  if (role === "ec_admin") {
    return "/admin";
  }

  return "/ballot";
}

function getPasswordStrength(password: string) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Za-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 1) return "Weak";
  if (score === 2) return "Fair";
  if (score === 3) return "Good";
  return "Strong";
}

export function ActivateForm() {
  const [studentId, setStudentId] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const errorId = "activate-error";
  const passwordStrength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const session = await activateStudentAccount(studentId, activationCode, newPassword);
      const supabase = getSupabaseBrowserClient();
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token
      });

      if (sessionError) {
        throw sessionError;
      }

      router.push(getRoleDestination(session.role));
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to activate account");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SiteFrame eyebrow="Account activation" title="Activate account" lead="Use the code from the EC, then set your own password.">
      <section className="mx-auto flex w-full flex-1 items-center justify-center py-10 lg:py-16">
        <div className="section-panel w-full max-w-lg shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
          <form className="space-y-5" onSubmit={handleSubmit} aria-busy={submitting}>
            <div className="space-y-2">
              <label htmlFor="activate-student-id" className="text-sm font-semibold text-navy">
                Student ID
              </label>
              <input
                id="activate-student-id"
                className="input-field"
                value={studentId}
                onChange={(event) => setStudentId(event.target.value.toUpperCase())}
                autoComplete="username"
                placeholder="SUC100001"
                aria-describedby={error ? errorId : undefined}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="activate-code" className="text-sm font-semibold text-navy">
                Activation code
              </label>
              <input
                id="activate-code"
                className="input-field uppercase tracking-[0.28em]"
                value={activationCode}
                onChange={(event) => setActivationCode(event.target.value.toUpperCase())}
                inputMode="text"
                autoComplete="one-time-code"
                placeholder="ABC123"
                maxLength={6}
                aria-describedby={error ? errorId : undefined}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="activate-password" className="text-sm font-semibold text-navy">
                New password
              </label>
              <input
                id="activate-password"
                className="input-field"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="Create a password"
                aria-describedby={error ? errorId : undefined}
              />
              <p className="text-sm text-stone">Password strength: {passwordStrength}</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="activate-password-confirm" className="text-sm font-semibold text-navy">
                Confirm password
              </label>
              <input
                id="activate-password-confirm"
                className="input-field"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="Repeat your password"
                aria-describedby={error ? errorId : undefined}
              />
            </div>

            {error ? (
              <div
                id={errorId}
                role="alert"
                className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </div>
            ) : null}

            {/* TODO: Restore hCaptcha here before re-enabling bot protection. */}

            <div className="flex flex-wrap gap-3">
              <button className="button-primary" type="submit" disabled={submitting}>
                {submitting ? "Activating..." : "Activate account"}
              </button>
              <Link href="/login" className="button-secondary">
                Back to login
              </Link>
            </div>
          </form>
        </div>
      </section>
    </SiteFrame>
  );
}
