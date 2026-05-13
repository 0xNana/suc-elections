"use client";

import { startTransition, useEffect, useRef, useState } from "react";

import type { AuditResponse, RepRegisterResponse, RepResultsResponse } from "@suc-vote/shared";

import { BackendError, getAudit, getRepRegister, getRepResults, loginStudent, logoutCurrentUser, verifyRepResults } from "../lib/api";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";
import { SiteFrame } from "./site-frame";

type LiveStatus = "connecting" | "live" | "offline";
const REP_AUDIT_PAGE_SIZE = 20;
const REP_REGISTER_PAGE_SIZE = 20;

function isEmptyElectionConfigError(cause: unknown) {
  return cause instanceof BackendError && cause.status === 503 && cause.message === "Election configuration is unavailable";
}

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
  if (eventType === "REP_VERIFIED_RESULTS") {
    return "Signed EC Register";
  }

  return eventType
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatActorRole(
  entry: AuditResponse["entries"][number]
) {
  if (entry.actor_role === "ec_admin") {
    return "EC Admin";
  }

  if (entry.actor_role === "aspirant_rep") {
    return "Aspirant Rep";
  }

  if (entry.actor_role === "voter") {
    return "Voter";
  }

  if (entry.event_type === "REP_VERIFIED_RESULTS") {
    return "Aspirant Rep";
  }

  if (
    [
      "CODE_ISSUED",
      "RESET_ACTIVATION",
      "ROLE_CHANGE",
      "ELECTION_CONFIG_UPDATED",
      "POLL_OPENED",
      "POLL_CLOSED",
      "RESULTS_COUNTED",
      "RESULTS_RELEASED"
    ].includes(entry.event_type)
  ) {
    return "EC Admin";
  }

  if (entry.event_type === "VOTE_CAST") {
    return "Voter";
  }

  return entry.actor_token ? "User" : "System";
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

function buildAuditCounts(
  audit: AuditResponse | null,
  options?: { useAuthoritativeVoteCount?: boolean }
) {
  const counts = new Map(
    Object.entries(audit?.event_counts ?? {}).map(([eventType, count]) => [eventType, count as number])
  );

  if (options?.useAuthoritativeVoteCount && audit) {
    counts.set("VOTE_CAST", audit.summary.total_votes_cast);
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
    <span className={`inline-flex max-w-full items-center rounded-full border px-3 py-1 text-center text-xs font-semibold uppercase leading-4 tracking-[0.14em] sm:tracking-[0.22em] ${tone}`}>
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
    <div className="rounded-[22px] border border-navy/10 bg-white px-4 py-4 sm:rounded-[24px] sm:px-5 sm:py-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold sm:tracking-[0.24em]">{label}</p>
      <p className="mt-3 break-words text-3xl font-semibold text-navy sm:text-4xl">{value}</p>
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
    <div className="rounded-[22px] border border-navy/10 bg-white px-4 py-4 sm:rounded-[26px] sm:px-5 sm:py-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <h3 className="break-words text-xl font-semibold text-navy">{title}</h3>
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gold sm:tracking-[0.22em]">
          {rows.length} candidates
        </span>
      </div>
      <div className="space-y-4">
        {rows.map((row, index) => {
          const width = leaderVotes === 0 ? 0 : Math.max(12, Math.round((row.vote_count / leaderVotes) * 100));

          return (
            <div key={row.candidate_id} className="space-y-2">
              <div className="flex items-start justify-between gap-3 sm:gap-4">
                <div className="min-w-0">
                  <p className="break-words text-base font-semibold text-navy">{row.candidate}</p>
                  <p className="text-sm text-stone">Ballot #{row.ballot_num}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-2xl font-semibold text-navy">{formatNumber(row.vote_count)}</p>
                  <p className="text-xs uppercase tracking-[0.16em] text-stone sm:tracking-[0.22em]">
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
  error,
  loading,
  onStudentIdChange,
  onPasswordChange,
  onSubmit
}: {
  studentId: string;
  password: string;
  error: string | null;
  loading: boolean;
  onStudentIdChange: (value: string) => void;
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

          {/* TODO: Restore hCaptcha here before re-enabling bot protection. */}

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
  const [activeAuditFilter, setActiveAuditFilter] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [results, setResults] = useState<RepResultsResponse | null>(null);
  const [register, setRegister] = useState<RepRegisterResponse | null>(null);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [registerPage, setRegisterPage] = useState(1);
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [resultsNotice, setResultsNotice] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registerRemarks, setRegisterRemarks] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const accessTokenRef = useRef<string | null>(null);
  const activeAuditFilterRef = useRef<string | null>(null);
  const auditPageRef = useRef(1);
  const dashboardErrorId = "rep-dashboard-error";

  accessTokenRef.current = accessToken;
  activeAuditFilterRef.current = activeAuditFilter;
  auditPageRef.current = auditPage;

  async function refreshDashboard(
    token: string,
    options?: {
      silent?: boolean;
      eventType?: string | null;
      auditPage?: number;
      registerPage?: number;
    }
  ) {
    const hasEventTypeOverride = !!options && Object.prototype.hasOwnProperty.call(options, "eventType");
    const eventType = hasEventTypeOverride ? (options?.eventType ?? null) : activeAuditFilterRef.current;
    const nextAuditPage = options?.auditPage ?? auditPageRef.current;

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
        } else if (isEmptyElectionConfigError(cause)) {
          nextResultsNotice = null;
        } else {
          throw cause;
        }
      }

      const [nextAudit, nextRegister] = await Promise.all([
        getAudit(token, "", {
          eventType: eventType ?? undefined,
          page: nextAuditPage,
          pageSize: REP_AUDIT_PAGE_SIZE
        }),
        getRepRegister(token, {
          page: options?.registerPage ?? registerPage,
          pageSize: REP_REGISTER_PAGE_SIZE
        })
      ]);

      startTransition(() => {
        setResults(nextResults);
        setResultsNotice(nextResultsNotice);
        setAudit(nextAudit);
        setAuditPage(nextAudit.page);
        setRegister(nextRegister);
        setRegisterPage(nextRegister.page);
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
        void refreshDashboard(token, {
          eventType: null,
          auditPage: 1,
          silent: false
        });
      }

      setBootstrapping(false);
    });

    const channel = supabase
      .channel("results")
      .on("broadcast", { event: "results.refresh" }, () => {
        const token = accessTokenRef.current;
        if (token) {
          void refreshDashboard(token, {
            eventType: activeAuditFilterRef.current,
            auditPage: auditPageRef.current,
            silent: true
          });
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
    setLoading(true);
    setError(null);

    try {
      const session = await loginStudent(studentId, password);
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
      await refreshDashboard(session.access_token, {
        eventType: null,
        auditPage: 1
      });
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to sign in");
    } finally {
      setLoading(false);
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
    setRegister(null);
    setIsRegisterOpen(false);
    setIsActivityLogOpen(false);
    setRegisterPage(1);
    setAudit(null);
    setActiveAuditFilter(null);
    setAuditPage(1);
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
      const remarks = registerRemarks.trim();
      const response = await verifyRepResults(
        accessToken,
        remarks.length > 0 ? { remarks } : undefined
      );
      setNotice(response.message);
      await refreshDashboard(accessToken, {
        eventType: activeAuditFilterRef.current,
        auditPage: auditPageRef.current,
        silent: true
      });
      setRegisterRemarks("");
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to record verification");
    } finally {
      setVerifying(false);
    }
  }

  async function handleAuditFilterChange(nextFilter: string | null) {
    if (!accessToken) {
      return;
    }

    setActiveAuditFilter(nextFilter);
    setAuditPage(1);
    await refreshDashboard(accessToken, {
      eventType: nextFilter,
      auditPage: 1
    });
  }

  async function handleAuditPageChange(nextPage: number) {
    if (!accessToken || nextPage < 1) {
      return;
    }

    setAuditPage(nextPage);
    await refreshDashboard(accessToken, {
      eventType: activeAuditFilterRef.current,
      auditPage: nextPage
    });
  }

  async function handleRegisterPageChange(nextPage: number) {
    if (!accessToken || nextPage < 1) {
      return;
    }

    setRegisterPage(nextPage);
    await refreshDashboard(accessToken, {
      eventType: activeAuditFilterRef.current,
      auditPage: auditPageRef.current,
      registerPage: nextPage
    });
  }

  const positionGroups = buildPositionGroups(results?.rows);
  const auditCounts = buildAuditCounts(audit, {
    useAuthoritativeVoteCount: true
  });
  const turnout = getTurnout(results);
  const hasCountedResults = results?.count_state.is_results_counted === true;
  const isProvisionalSummary = !!results && !hasCountedResults;
  const currentAuditPage = audit?.page ?? auditPage;
  const auditPageSize = audit?.pageSize ?? REP_AUDIT_PAGE_SIZE;
  const auditTotal = audit?.total ?? 0;
  const auditStart = auditTotal === 0 ? 0 : (currentAuditPage - 1) * auditPageSize + 1;
  const auditEnd = auditTotal === 0 ? 0 : Math.min(currentAuditPage * auditPageSize, auditTotal);
  const canGoToPreviousAuditPage = currentAuditPage > 1;
  const canGoToNextAuditPage = auditEnd < auditTotal;
  const currentRegisterPage = register?.page ?? registerPage;
  const registerPageSize = register?.pageSize ?? REP_REGISTER_PAGE_SIZE;
  const registerTotal = register?.total ?? 0;
  const registerStart = registerTotal === 0 ? 0 : (currentRegisterPage - 1) * registerPageSize + 1;
  const registerEnd = registerTotal === 0 ? 0 : Math.min(currentRegisterPage * registerPageSize, registerTotal);
  const canGoToPreviousRegisterPage = currentRegisterPage > 1;
  const canGoToNextRegisterPage = registerEnd < registerTotal;

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
          error={error}
          loading={loading}
          onStudentIdChange={setStudentId}
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
                  <h2 className="break-words text-2xl font-semibold text-navy sm:text-3xl">
                    {isProvisionalSummary ? "Provisional Election Snapshot" : "Election totals"}
                  </h2>
                </div>
                <StatusBadge liveStatus={liveStatus} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Votes cast"
                  value={formatNumber(results?.summary.total_votes_cast)}
                  note={
                    results
                      ? hasCountedResults
                        ? "Official votes recorded."
                        : "Votes recorded so far."
                      : "Shown after polls close."
                  }
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
                  label="Signoff"
                  value={results?.verification_state.is_verified_by_any_rep ? "Signed" : "Pending"}
                  note={
                    results
                      ? hasCountedResults
                        ? `${results.verification_state.total_verifications} signoff(s) recorded.`
                        : "Signoff opens after the EC counts the results."
                      : "Available after polls close."
                  }
                />
              </div>
            </div>

            <div className="section-panel space-y-5">
              <div className="space-y-2">
                <p className="eyebrow">Actions</p>
                <h2 className="break-words text-2xl font-semibold text-navy sm:text-3xl">Review and sign.</h2>
              </div>
              <p className="text-sm leading-7 text-stone">
                Wait for the EC to count the results, review what is shown, then sign the EC register. Add remarks only if needed.
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
              {hasCountedResults ? (
                <div className="space-y-3 rounded-[22px] border border-navy/10 bg-cream/70 px-4 py-4">
                  <p className="text-sm leading-7 text-stone">
                    By signing, you confirm that you have reviewed the EC count and entered the register.
                  </p>
                  <label htmlFor="rep-register-remarks" className="text-sm font-semibold text-navy">
                    Remarks (optional)
                  </label>
                  <textarea
                    id="rep-register-remarks"
                    className="input-field min-h-28 resize-y"
                    value={registerRemarks}
                    onChange={(event) => setRegisterRemarks(event.target.value)}
                    placeholder="Add any objection, clarification, or note for the EC register."
                  />
                  <button
                    className="button-primary"
                    type="button"
                    onClick={() => void handleVerifyResults()}
                    disabled={verifying}
                  >
                    {verifying ? "Signing..." : "Sign EC register"}
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
              <p className="eyebrow">Register</p>
              <button
                type="button"
                onClick={() => setIsRegisterOpen((current) => !current)}
                className="flex w-full items-center justify-between rounded-[20px] border border-navy/10 bg-cream/70 px-4 py-4 text-left"
                aria-expanded={isRegisterOpen}
              >
                <div>
                  <h2 className="text-2xl font-semibold text-navy">Voter register</h2>
                  <p className="mt-1 text-sm leading-6 text-stone">
                    {formatNumber(registerTotal)} voter(s). Cross-check this register against your copy.
                  </p>
                </div>
                <span className="text-sm font-semibold text-navy">
                  {isRegisterOpen ? "Hide" : "View"}
                </span>
              </button>
            </div>
            {isRegisterOpen ? (
              <>
                <div className="max-w-full overflow-x-auto rounded-[20px] border border-navy/10 sm:rounded-[24px]">
                  <table className="min-w-[36rem] divide-y divide-navy/10 text-left text-sm">
                    <thead className="bg-navy text-cream">
                      <tr>
                        <th className="px-4 py-3 font-medium">Student ID</th>
                        <th className="px-4 py-3 font-medium">Full Name</th>
                        <th className="px-4 py-3 font-medium">Can Vote</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy/10 bg-white">
                      {register?.rows.length ? (
                        register.rows.map((row) => (
                          <tr key={row.student_id}>
                            <td className="px-4 py-3 text-navy">{row.student_id}</td>
                            <td className="px-4 py-3 text-stone">{row.full_name}</td>
                            <td className="px-4 py-3 text-stone">{row.can_vote ? "Yes" : "No"}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-4 py-10 text-center text-stone">
                            No register rows yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-stone">
                    {registerTotal > 0
                      ? `Showing ${registerStart}-${registerEnd} of ${formatNumber(registerTotal)} voter(s).`
                      : "No voters yet."}
                  </p>
                  <div className="flex gap-3">
                    <button
                      className="button-secondary"
                      type="button"
                      onClick={() => void handleRegisterPageChange(currentRegisterPage - 1)}
                      disabled={!canGoToPreviousRegisterPage || loading}
                    >
                      Previous
                    </button>
                    <button
                      className="button-secondary"
                      type="button"
                      onClick={() => void handleRegisterPageChange(currentRegisterPage + 1)}
                      disabled={!canGoToNextRegisterPage || loading}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <div className="section-panel space-y-5">
            <div className="space-y-2">
              <p className="eyebrow">Standings</p>
              <h2 className="break-words text-2xl font-semibold text-navy sm:text-3xl">Vote totals by position</h2>
            </div>
            {hasCountedResults ? (
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
              <div className="w-full space-y-2">
                <p className="eyebrow">Activity log</p>
                <button
                  type="button"
                  onClick={() => setIsActivityLogOpen((current) => !current)}
                  className="flex w-full items-center justify-between rounded-[20px] border border-navy/10 bg-cream/70 px-4 py-4 text-left"
                  aria-expanded={isActivityLogOpen}
                >
                  <div>
                    <h2 className="text-2xl font-semibold text-navy">Recent actions</h2>
                    <p className="mt-1 text-sm leading-6 text-stone">
                      {formatNumber(auditTotal)} action(s) in the log.
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-navy">
                    {isActivityLogOpen ? "Hide" : "View"}
                  </span>
                </button>
              </div>
            </div>

            {isActivityLogOpen ? (
              <>
                {auditCounts.length > 0 ? (
                  <div className="flex flex-wrap gap-3">
                    <button
                      className={`rounded-full border px-4 py-2 text-sm ${
                        activeAuditFilter === null
                          ? "border-navy bg-navy text-cream"
                          : "border-navy/10 bg-cream/75 text-navy"
                      }`}
                      type="button"
                      onClick={() => void handleAuditFilterChange(null)}
                    >
                      <span className="font-semibold">All</span>
                    </button>
                    {auditCounts.map(([eventType, count]) => (
                      <button
                        key={eventType}
                        className={`rounded-full border px-4 py-2 text-sm ${
                          activeAuditFilter === eventType
                            ? "border-navy bg-navy text-cream"
                            : "border-navy/10 bg-cream/75 text-navy"
                        }`}
                        type="button"
                        onClick={() => void handleAuditFilterChange(activeAuditFilter === eventType ? null : eventType)}
                      >
                        <span className="font-semibold">{formatEventLabel(eventType)}</span>
                        <span className={`ml-2 ${activeAuditFilter === eventType ? "text-cream/80" : "text-stone"}`}>
                          {formatNumber(count)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : activeAuditFilter ? (
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="rounded-full border border-navy bg-navy px-4 py-2 text-sm text-cream"
                      type="button"
                      onClick={() => void handleAuditFilterChange(null)}
                    >
                      <span className="font-semibold">All</span>
                    </button>
                    <button
                      className="rounded-full border border-navy bg-navy px-4 py-2 text-sm text-cream"
                      type="button"
                      onClick={() => void handleAuditFilterChange(null)}
                    >
                      <span className="font-semibold">{formatEventLabel(activeAuditFilter)}</span>
                    </button>
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

                <div className="max-w-full overflow-x-auto rounded-[20px] border border-navy/10 sm:rounded-[24px]">
                  <table className="min-w-[44rem] divide-y divide-navy/10 text-left text-sm">
                    <caption className="visually-hidden">
                      Activity log showing recent representative-visible election actions.
                    </caption>
                    <thead className="bg-navy text-cream">
                      <tr>
                        <th className="px-4 py-3 font-medium">Action</th>
                        <th className="px-4 py-3 font-medium">Role</th>
                        <th className="px-4 py-3 font-medium">Address</th>
                        <th className="px-4 py-3 font-medium">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy/10 bg-white">
                      {audit?.entries.length ? (
                        audit.entries.map((entry) => (
                          <tr key={entry.id}>
                            <td className="px-4 py-3 font-semibold text-navy">{formatEventLabel(entry.event_type)}</td>
                            <td className="px-4 py-3 text-stone">{formatActorRole(entry)}</td>
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

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-stone">
                    {auditTotal > 0 ? `Showing ${auditStart}-${auditEnd} of ${formatNumber(auditTotal)} actions.` : "No actions yet."}
                  </p>
                  <div className="flex gap-3">
                    <button
                      className="button-secondary"
                      type="button"
                      onClick={() => void handleAuditPageChange(currentAuditPage - 1)}
                      disabled={!canGoToPreviousAuditPage || loading}
                    >
                      Previous
                    </button>
                    <button
                      className="button-secondary"
                      type="button"
                      onClick={() => void handleAuditPageChange(currentAuditPage + 1)}
                      disabled={!canGoToNextAuditPage || loading}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </section>
      )}
    </SiteFrame>
  );
}
