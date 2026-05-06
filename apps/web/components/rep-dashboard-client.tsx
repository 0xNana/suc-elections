"use client";

import Link from "next/link";
import { startTransition, useEffect, useRef, useState } from "react";

import type { AuditResponse, RepResultsResponse } from "@suc-vote/shared";

import { BackendError, getAudit, getRepResults, loginStudent, logoutCurrentUser, verifyRepResults } from "../lib/api";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";
import { HCaptchaWidget } from "./hcaptcha-widget";
import { SiteFrame } from "./site-frame";

type LiveStatus = "connecting" | "live" | "offline";

function downloadCsv(audit: AuditResponse) {
  const headers = ["id", "event_type", "actor_token", "ip_address", "payload_hash", "logged_at"];
  const lines = [headers.join(",")];

  for (const entry of audit.entries) {
    lines.push(
      [
        entry.id,
        entry.event_type,
        entry.actor_token ?? "",
        entry.ip_address ?? "",
        entry.payload_hash ?? "",
        entry.logged_at
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    );
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "rep-activity-log.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatEventLabel(eventType: string) {
  return eventType
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatNumber(value?: number) {
  if (value === undefined) {
    return "--";
  }

  return new Intl.NumberFormat().format(value);
}

function buildPositionGroups(rows: RepResultsResponse["rows"] = []) {
  const groups = new Map<
    string,
    {
      title: string;
      positionId: string;
      rows: RepResultsResponse["rows"];
    }
  >();

  for (const row of rows) {
    const existing = groups.get(row.position_id);
    if (existing) {
      existing.rows.push(row);
      continue;
    }

    groups.set(row.position_id, {
      title: row.position,
      positionId: row.position_id,
      rows: [row]
    });
  }

  return [...groups.values()];
}

function buildAuditCounts(entries: AuditResponse["entries"] = []) {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    counts.set(entry.event_type, (counts.get(entry.event_type) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function getTurnout(results: RepResultsResponse | null) {
  const cast = results?.summary.total_votes_cast ?? 0;
  const eligible = results?.summary.total_eligible ?? 0;

  if (!eligible) {
    return "0%";
  }

  return `${Math.round((cast / eligible) * 100)}%`;
}

function StatusBadge({ liveStatus }: { liveStatus: LiveStatus }) {
  const tone =
    liveStatus === "live"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : liveStatus === "connecting"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-red-200 bg-red-50 text-red-700";

  const label =
    liveStatus === "live" ? "Live updates on" : liveStatus === "connecting" ? "Connecting" : "Live updates off";

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] ${tone}`}>
      {label}
    </span>
  );
}

function StatCard({
  label,
  value,
  note
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-[24px] border border-navy/10 bg-white px-5 py-5">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold">{label}</p>
      <p className="mt-3 text-4xl font-semibold text-navy">{value}</p>
      <p className="mt-2 text-sm leading-6 text-stone">{note}</p>
    </div>
  );
}

function PositionCard({
  title,
  rows
}: {
  title: string;
  rows: RepResultsResponse["rows"];
}) {
  const leaderVotes = rows[0]?.vote_count ?? 0;

  return (
    <div className="rounded-[26px] border border-navy/10 bg-white px-5 py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-xl font-semibold text-navy">{title}</h3>
        <span className="text-xs font-semibold uppercase tracking-[0.22em] text-gold">
          {rows.length} candidates
        </span>
      </div>
      <div className="space-y-4">
        {rows.map((row, index) => {
          const width = leaderVotes === 0 ? 0 : Math.max(12, Math.round((row.vote_count / leaderVotes) * 100));

          return (
            <div key={row.candidate_id} className="space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-base font-semibold text-navy">{row.candidate}</p>
                  <p className="text-sm text-stone">Ballot #{row.ballot_num}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-navy">{formatNumber(row.vote_count)}</p>
                  <p className="text-xs uppercase tracking-[0.22em] text-stone">
                    {index === 0 ? "Leading" : "Running"}
                  </p>
                </div>
              </div>
              <div className="h-2 rounded-full bg-cream/90">
                <div
                  className="h-2 rounded-full bg-[#b8913a] transition-[width] duration-500"
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RepLoginGate({
  studentId,
  password,
  captchaToken,
  captchaResetSignal,
  error,
  loading,
  onStudentIdChange,
  onCaptchaTokenChange,
  onPasswordChange,
  onSubmit
}: {
  studentId: string;
  password: string;
  captchaToken: string | null;
  captchaResetSignal: number;
  error: string | null;
  loading: boolean;
  onStudentIdChange: (value: string) => void;
  onCaptchaTokenChange: (value: string | null) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const loginErrorId = "rep-login-error";

  return (
    <section className="mx-auto flex w-full flex-1 items-center justify-center py-10 lg:py-16">
      <div className="section-panel w-full max-w-lg shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
        <form className="space-y-5" onSubmit={onSubmit} aria-busy={loading}>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-navy">Aspirant Reps</h2>
            <p className="text-sm leading-6 text-stone">Enter your Student ID and password to open the dashboard.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-navy" htmlFor="rep-student-id">
              Student ID
            </label>
            <input
              id="rep-student-id"
              className="input-field"
              value={studentId}
              onChange={(event) => onStudentIdChange(event.target.value.toUpperCase())}
              autoComplete="username"
              placeholder="SUC100001"
              aria-describedby={error ? loginErrorId : undefined}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-navy" htmlFor="rep-password">
              Password
            </label>
            <input
              id="rep-password"
              className="input-field"
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              autoComplete="current-password"
              placeholder="Enter your password"
              aria-describedby={error ? loginErrorId : undefined}
            />
          </div>

          {error ? (
            <div
              id={loginErrorId}
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          <HCaptchaWidget
            token={captchaToken}
            onTokenChange={onCaptchaTokenChange}
            resetSignal={captchaResetSignal}
          />

          <button className="button-primary w-full" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Open dashboard"}
          </button>
        </form>
      </div>
    </section>
  );
}

export function RepDashboardClient() {
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [results, setResults] = useState<RepResultsResponse | null>(null);
  const [resultsNotice, setResultsNotice] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationMessage, setVerificationMessage] = useState("I have checked the count and verified it.");
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const accessTokenRef = useRef<string | null>(null);
  const activeSearchRef = useRef("");
  const dashboardErrorId = "rep-dashboard-error";

  accessTokenRef.current = accessToken;
  activeSearchRef.current = activeSearch;

  async function refreshDashboard(
    token: string,
    searchTerm = activeSearchRef.current,
    options?: { silent?: boolean }
  ) {
    if (!options?.silent) {
      setLoading(true);
    }

    setError(null);

    try {
      let nextResults: RepResultsResponse | null = null;
      let nextResultsNotice: string | null = null;

      try {
        nextResults = await getRepResults(token);
      } catch (cause) {
        if (cause instanceof BackendError && cause.status === 403) {
          nextResultsNotice = cause.message;
        } else {
          throw cause;
        }
      }

      const nextAudit = await getAudit(token, searchTerm);

      startTransition(() => {
        setResults(nextResults);
        setResultsNotice(nextResultsNotice);
        setAudit(nextAudit);
      });
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to load dashboard");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }

      const token = data.session?.access_token ?? null;
      setAccessToken(token);

      if (token) {
        void refreshDashboard(token, "", { silent: false });
      }

      setBootstrapping(false);
    });

    const channel = supabase
      .channel("results")
      .on("broadcast", { event: "results.refresh" }, () => {
        const token = accessTokenRef.current;
        if (token) {
          void refreshDashboard(token, activeSearchRef.current, { silent: true });
        }
      })
      .subscribe((status) => {
        if (!active) {
          return;
        }

        if (status === "SUBSCRIBED") {
          setLiveStatus("live");
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setLiveStatus("offline");
          return;
        }

        setLiveStatus("connecting");
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  async function handleRepLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!captchaToken) {
      setError("Complete the verification check to continue.");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const session = await loginStudent(studentId, password, captchaToken);
      if (session.role !== "aspirant_rep") {
        setError("This account does not have Aspirant Rep access.");
        setLoading(false);
        return;
      }

      const supabase = getSupabaseBrowserClient();
      const response = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token
      });

      if (response.error) {
        throw response.error;
      }

      setAccessToken(session.access_token);
      await refreshDashboard(session.access_token, "");
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to sign in");
    } finally {
      setLoading(false);
      setCaptchaResetSignal((value) => value + 1);
    }
  }

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    if (accessToken) {
      try {
        await logoutCurrentUser(accessToken);
      } catch {}
    }
    await supabase.auth.signOut();
    setAccessToken(null);
    setResults(null);
    setResultsNotice(null);
    setAudit(null);
    setSearchInput("");
    setActiveSearch("");
    setNotice(null);
    setError(null);
  }

  async function handleVerifyResults() {
    if (!accessToken) {
      return;
    }

    setVerifying(true);
    setError(null);
    setNotice(null);

    try {
      const response = await verifyRepResults(accessToken, verificationMessage);
      setNotice(response.message);
      await refreshDashboard(accessToken, activeSearchRef.current, { silent: true });
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to record verification");
    } finally {
      setVerifying(false);
    }
  }

  async function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!accessToken) {
      return;
    }

    const nextSearch = searchInput.trim();
    setActiveSearch(nextSearch);
    await refreshDashboard(accessToken, nextSearch);
  }

  async function handleClearSearch() {
    if (!accessToken) {
      return;
    }

    setSearchInput("");
    setActiveSearch("");
    await refreshDashboard(accessToken, "");
  }

  const positionGroups = buildPositionGroups(results?.rows);
  const auditCounts = buildAuditCounts(audit?.entries);
  const turnout = getTurnout(results);

  return (
    <SiteFrame
      eyebrow="Representative access"
      title="Aspirant Reps"
      lead="Live vote totals and activity for aspirant reps."
      fullWidth
    >
      {bootstrapping ? (
        <section className="mx-auto flex w-full flex-1 items-center justify-center py-10 lg:py-16">
          <div className="section-panel w-full max-w-md text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-gold">Checking access</p>
            <p className="mt-3 text-base text-stone">Please wait...</p>
          </div>
        </section>
      ) : !accessToken ? (
        <RepLoginGate
          studentId={studentId}
          password={password}
          captchaToken={captchaToken}
          captchaResetSignal={captchaResetSignal}
          error={error}
          loading={loading}
          onStudentIdChange={setStudentId}
          onCaptchaTokenChange={setCaptchaToken}
          onPasswordChange={setPassword}
          onSubmit={handleRepLogin}
        />
      ) : (
        <section className="space-y-6">
          <div className="grid gap-6 2xl:grid-cols-[1.2fr_0.8fr]">
            <div className="section-panel space-y-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="eyebrow">Overview</p>
                  <h2 className="text-3xl font-semibold text-navy">Election totals</h2>
                </div>
                <StatusBadge liveStatus={liveStatus} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Votes cast"
                  value={formatNumber(results?.summary.total_votes_cast)}
                  note={results ? "Total votes recorded so far." : "Shown after the EC counts the results."}
                />
                <StatCard
                  label="Eligible voters"
                  value={formatNumber(results?.summary.total_eligible)}
                  note="Students cleared to vote."
                />
                <StatCard
                  label="Turnout"
                  value={results ? turnout : "--"}
                  note="Votes cast compared with eligible voters."
                />
                <StatCard
                  label="Verification"
                  value={results?.verification_state.is_verified_by_any_rep ? "Sent" : "Pending"}
                  note={results ? `${results.verification_state.total_verifications} verification message(s) recorded.` : "Available after EC count."}
                />
              </div>
            </div>

            <div className="section-panel space-y-5">
              <div className="space-y-2">
                <p className="eyebrow">Actions</p>
                <h2 className="text-3xl font-semibold text-navy">Review and confirm.</h2>
              </div>
              <p className="text-sm leading-7 text-stone">
                Wait for the EC to count the results, review what is shown, then send your verification message.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  className="button-primary"
                  type="button"
                  onClick={() => accessToken && void refreshDashboard(accessToken)}
                  disabled={loading}
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => audit && downloadCsv(audit)}
                  disabled={!audit}
                >
                  Export CSV
                </button>
                <button className="button-secondary" type="button" onClick={() => void handleSignOut()}>
                  Sign out
                </button>
              </div>
              {results ? (
                <div className="space-y-3 rounded-[22px] border border-navy/10 bg-cream/70 px-4 py-4">
                  <label htmlFor="rep-verification-message" className="text-sm font-semibold text-navy">
                    Verification message
                  </label>
                  <textarea
                    id="rep-verification-message"
                    className="input-field min-h-28 resize-y"
                    value={verificationMessage}
                    onChange={(event) => setVerificationMessage(event.target.value)}
                  />
                  <button
                    className="button-primary"
                    type="button"
                    onClick={() => void handleVerifyResults()}
                    disabled={verifying}
                  >
                    {verifying ? "Sending..." : "Send verification"}
                  </button>
                </div>
              ) : (
                <div className="rounded-[22px] border border-navy/10 bg-cream/70 px-4 py-4 text-sm text-stone">
                  {resultsNotice ?? "Results will appear here after the EC counts them."}
                </div>
              )}
              {results ? (
                <div className="rounded-[22px] border border-navy/10 bg-cream/70 px-4 py-4 text-sm text-stone">
                  Last updated {new Date(results.refreshed_at).toLocaleTimeString()}.
                </div>
              ) : null}
            </div>
          </div>

          <div className="section-panel space-y-5">
            <div className="space-y-2">
              <p className="eyebrow">Standings</p>
              <h2 className="text-3xl font-semibold text-navy">Vote totals by position</h2>
            </div>
            {results ? (
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                {positionGroups.map((group) => (
                  <PositionCard key={group.positionId} title={group.title} rows={group.rows} />
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-navy/10 bg-cream/70 px-5 py-5 text-sm text-stone">
                {resultsNotice ?? "Vote totals will appear here after the EC counts the results."}
              </div>
            )}
          </div>

          {notice ? (
            <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {notice}
            </div>
          ) : null}

          <div className="section-panel space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <p className="eyebrow">Activity log</p>
                <h2 className="text-3xl font-semibold text-navy">Recent actions</h2>
              </div>
              <form className="flex w-full max-w-2xl flex-col gap-3 sm:flex-row" onSubmit={handleSearchSubmit}>
                <label htmlFor="rep-dashboard-search" className="visually-hidden">
                  Search activity log
                </label>
                <input
                  id="rep-dashboard-search"
                  className="input-field"
                  placeholder="Search event, token, or details"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
                <button className="button-primary" type="submit" disabled={loading}>
                  Search
                </button>
                <button className="button-secondary" type="button" onClick={() => void handleClearSearch()}>
                  Clear
                </button>
              </form>
            </div>

            {auditCounts.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {auditCounts.map(([eventType, count]) => (
                  <div key={eventType} className="rounded-full border border-navy/10 bg-cream/75 px-4 py-2 text-sm text-navy">
                    <span className="font-semibold">{formatEventLabel(eventType)}</span>
                    <span className="ml-2 text-stone">{formatNumber(count)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {error ? (
              <div
                id={dashboardErrorId}
                role="alert"
                className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </div>
            ) : null}

            <div className="overflow-hidden rounded-[24px] border border-navy/10">
              <table className="min-w-full divide-y divide-navy/10 text-left text-sm">
                <caption className="visually-hidden">
                  Activity log showing recent representative-visible election actions.
                </caption>
                <thead className="bg-navy text-cream">
                  <tr>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Who</th>
                    <th className="px-4 py-3 font-medium">Address</th>
                    <th className="px-4 py-3 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy/10 bg-white">
                  {audit?.entries.length ? (
                    audit.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-4 py-3 font-semibold text-navy">{formatEventLabel(entry.event_type)}</td>
                        <td className="px-4 py-3 text-stone">{entry.actor_token ?? "N/A"}</td>
                        <td className="px-4 py-3 text-stone">{entry.ip_address ?? "N/A"}</td>
                        <td className="px-4 py-3 text-stone">{new Date(entry.logged_at).toLocaleString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-stone">
                        No matching activity yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {activeSearch ? <p className="text-sm text-stone">Current search: "{activeSearch}"</p> : null}

            <div className="flex justify-end">
              <Link href="/" className="button-secondary">
                Back to home
              </Link>
            </div>
          </div>
        </section>
      )}
    </SiteFrame>
  );
}
