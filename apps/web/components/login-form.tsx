"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { BackendError, loginStudent } from "../lib/api";
import { HCaptchaWidget } from "./hcaptcha-widget";
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

export function LoginForm() {
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const errorId = "student-login-error";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!captchaToken) {
      setError("Complete the verification check to continue.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const session = await loginStudent(studentId, password, captchaToken);
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
      setError(cause instanceof BackendError ? cause.message : "Unable to sign in");
    } finally {
      setSubmitting(false);
      setCaptchaResetSignal((value) => value + 1);
    }
  }

  return (
    <SiteFrame
      eyebrow="Student access"
      title="Students"
      lead="Enter your Student ID and password to continue."
    >
      <section className="mx-auto flex w-full flex-1 items-center justify-center py-10 lg:py-16">
        <div className="section-panel w-full max-w-lg shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
          <form className="space-y-5" onSubmit={handleSubmit} aria-busy={submitting}>
            <div className="space-y-2">
              <label htmlFor="student-id" className="text-sm font-semibold text-navy">
                Student ID
              </label>
              <input
                id="student-id"
                className="input-field"
                autoComplete="username"
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
                placeholder="SUC100001"
                aria-describedby={error ? errorId : undefined}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-semibold text-navy">
                Password
              </label>
              <input
                id="password"
                className="input-field"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
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

            <HCaptchaWidget
              token={captchaToken}
              onTokenChange={setCaptchaToken}
              resetSignal={captchaResetSignal}
            />

            <div className="flex flex-wrap gap-3">
              <button className="button-primary" type="submit" disabled={submitting}>
                {submitting ? "Signing in..." : "Continue"}
              </button>
              <Link href="/activate" className="button-secondary">
                Activate account
              </Link>
              <Link href="/" className="button-secondary">
                Return home
              </Link>
            </div>
          </form>
        </div>
      </section>
    </SiteFrame>
  );
}
