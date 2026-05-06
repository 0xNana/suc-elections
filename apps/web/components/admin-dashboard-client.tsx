"use client";

import { ChangeEvent, startTransition, useEffect, useMemo, useRef, useState } from "react";

import type { AdminStudentsResponse, AuditResponse, EcConfigResponse, EcResultsResponse, IssueCodesResponse } from "@suc-vote/shared";

import {
  BackendError,
  changeStudentRole,
  closeEcPoll,
  countEcResults,
  getAdminStudents,
  getAudit,
  getEcConfig,
  getEcResults,
  issueActivationCodes,
  loginStudent,
  logoutCurrentUser,
  openEcPoll,
  releaseEcResults,
  resetStudentActivation,
  saveEcConfig
} from "../lib/api";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";
import { SiteFrame } from "./site-frame";

type LiveStatus = "connecting" | "live" | "offline";
type AdminTab = "issue-codes" | "manage-users" | "election-control" | "audit-log";
type UserRole = "voter" | "aspirant_rep" | "ec_admin";

interface ScheduleFormState {
  poll_opens: string;
  poll_closes: string;
  is_locked: boolean;
}

function isEmptyElectionConfigError(cause: unknown) {
  return cause instanceof BackendError && cause.status === 503 && cause.message === "Election configuration is unavailable";
}

function formatNumber(value?: number) {
  if (value === undefined) {
    return "--";
  }

  return new Intl.NumberFormat().format(value);
}

function toDateTimeLocalValue(isoString: string) {
  const date = new Date(isoString);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoFromLocal(value: string) {
  return new Date(value).toISOString();
}

function getElectionPhase(config: EcConfigResponse["election"] | null) {
  if (!config) {
    return "Unknown";
  }

  const now = Date.now();
  const opens = new Date(config.poll_opens).getTime();
  const closes = new Date(config.poll_closes).getTime();

  if (config.is_locked) {
    return "Polls are locked";
  }

  if (now < opens) {
    return "Polls open soon";
  }

  if (now >= closes) {
    return "Polls are closed";
  }

  return "Polls are open";
}

function buildPositionGroups(rows: EcResultsResponse["rows"] = []) {
  const groups = new Map<
    string,
    {
      title: string;
      positionId: string;
      rows: EcResultsResponse["rows"];
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

function downloadIssueCodesCsv(result: IssueCodesResponse) {
  const headers = ["Student ID", "Full Name", "Role", "Can Vote", "Activation Code"];
  const lines = [headers.join(",")];

  for (const row of result.issued) {
    lines.push(
      [row.student_id, row.full_name, row.role, row.can_vote ? "Yes" : "No", row.activation_code]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    );
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "activation-codes.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadAuditCsv(audit: AuditResponse) {
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
  anchor.download = "admin-audit-log.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseIssueEntries(raw: string, role: UserRole, canVote: boolean) {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const firstRow = lines[0]!.split(",").map((part) => part.trim().toLowerCase());
  const hasHeader = firstRow.some((cell) =>
    ["student_id", "student id", "full_name", "full name", "name", "role", "can_vote", "can vote"].includes(cell)
  );

  if (!hasHeader) {
    return lines
      .map((line) => {
        const [student_id, full_name] = line.split(",").map((part) => part.trim());
        if (!student_id) {
          return null;
        }
        return {
          student_id,
          full_name: full_name || student_id,
          role,
          can_vote: canVote
        };
      })
      .filter(
        (entry): entry is { student_id: string; full_name: string; role: UserRole; can_vote: boolean } => entry !== null
      );
  }

  const headerMap = new Map(firstRow.map((cell, index) => [cell, index]));
  const getIndex = (...names: string[]) => {
    for (const name of names) {
      const index = headerMap.get(name);
      if (index !== undefined) {
        return index;
      }
    }
    return -1;
  };

  const studentIdIndex = getIndex("student_id", "student id");
  const fullNameIndex = getIndex("full_name", "full name", "name");
  const roleIndex = getIndex("role");
  const canVoteIndex = getIndex("can_vote", "can vote");

  return lines
    .slice(1)
    .map((line) => {
      const cells = line.split(",").map((part) => part.trim());
      const student_id = studentIdIndex >= 0 ? cells[studentIdIndex] : cells[0];
      const full_name = fullNameIndex >= 0 ? cells[fullNameIndex] : student_id;
      const csvRole = roleIndex >= 0 ? cells[roleIndex]?.toLowerCase() : "";
      const csvCanVote = canVoteIndex >= 0 ? cells[canVoteIndex]?.toLowerCase() : "";

      if (!student_id) {
        return null;
      }

      const normalizedRole: UserRole =
        csvRole === "aspirant_rep" || csvRole === "aspirant rep"
          ? "aspirant_rep"
          : csvRole === "ec_admin" || csvRole === "ec admin"
            ? "ec_admin"
            : csvRole === "voter"
              ? "voter"
              : role;

      const normalizedCanVote =
        csvCanVote === "yes" || csvCanVote === "true" || csvCanVote === "1"
          ? true
          : csvCanVote === "no" || csvCanVote === "false" || csvCanVote === "0"
            ? false
            : canVote;

      return {
        student_id,
        full_name: full_name || student_id,
        role: normalizedRole,
        can_vote: normalizedCanVote
      };
    })
    .filter(
      (entry): entry is { student_id: string; full_name: string; role: UserRole; can_vote: boolean } => entry !== null
    );
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
  rows: EcResultsResponse["rows"];
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

function AdminLoginGate({
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
  const loginErrorId = "admin-login-error";

  return (
    <section className="mx-auto flex w-full flex-1 items-center justify-center py-10 lg:py-16">
      <div className="section-panel w-full max-w-lg shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
        <form className="space-y-5" onSubmit={onSubmit} aria-busy={loading}>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-navy">Electoral Commission</h2>
            <p className="text-sm leading-6 text-stone">Enter your Student ID and password to manage the election.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-navy" htmlFor="admin-student-id">
              Student ID
            </label>
            <input
              id="admin-student-id"
              className="input-field"
              value={studentId}
              onChange={(event) => onStudentIdChange(event.target.value.toUpperCase())}
              autoComplete="username"
              placeholder="SUC100001"
              aria-describedby={error ? loginErrorId : undefined}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-navy" htmlFor="admin-password">
              Password
            </label>
            <input
              id="admin-password"
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
            {loading ? "Signing in..." : "Open admin"}
          </button>
        </form>
      </div>
    </section>
  );
}

export function AdminDashboardClient() {
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("issue-codes");
  const [config, setConfig] = useState<EcConfigResponse | null>(null);
  const [results, setResults] = useState<EcResultsResponse | null>(null);
  const [resultsNotice, setResultsNotice] = useState<string | null>(null);
  const [students, setStudents] = useState<AdminStudentsResponse["students"]>([]);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [counting, setCounting] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>({
    poll_opens: "",
    poll_closes: "",
    is_locked: false
  });
  const [issueCodesText, setIssueCodesText] = useState("");
  const [issueRole, setIssueRole] = useState<UserRole>("voter");
  const [issueCanVote, setIssueCanVote] = useState(true);
  const [issueResult, setIssueResult] = useState<IssueCodesResponse | null>(null);
  const [studentsSearch, setStudentsSearch] = useState("");
  const [studentsRoleFilter, setStudentsRoleFilter] = useState<"" | UserRole>("");
  const [studentsActivationFilter, setStudentsActivationFilter] = useState<"all" | "activated" | "pending">("all");
  const [auditSearch, setAuditSearch] = useState("");
  const accessTokenRef = useRef<string | null>(null);

  accessTokenRef.current = accessToken;

  async function refreshElectionState(
    token: string,
    options?: { silent?: boolean; syncForm?: boolean }
  ) {
    if (!options?.silent) {
      setLoading(true);
    }

    setError(null);

    try {
      let nextConfig: EcConfigResponse | null = null;
      try {
        nextConfig = await getEcConfig(token);
      } catch (cause) {
        if (!isEmptyElectionConfigError(cause)) {
          throw cause;
        }
      }
      let nextResults: EcResultsResponse | null = null;
      let nextResultsNotice: string | null = null;

      if (nextConfig) {
        try {
          nextResults = await getEcResults(token);
        } catch (cause) {
          if (cause instanceof BackendError && cause.status === 403) {
            nextResultsNotice = cause.message;
          } else if (!isEmptyElectionConfigError(cause)) {
            throw cause;
          }
        }
      } else {
        nextResults = null;
        nextResultsNotice = null;
      }

      startTransition(() => {
        setConfig(nextConfig);
        setResults(nextResults);
        setResultsNotice(nextResultsNotice);
        if (options?.syncForm !== false) {
          if (nextConfig) {
            setScheduleForm({
              poll_opens: toDateTimeLocalValue(nextConfig.election.poll_opens),
              poll_closes: toDateTimeLocalValue(nextConfig.election.poll_closes),
              is_locked: nextConfig.election.is_locked
            });
          } else {
            setScheduleForm({
              poll_opens: "",
              poll_closes: "",
              is_locked: false
            });
          }
        }
      });
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to load admin dashboard");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  async function refreshStudents(token: string) {
    const query: {
      search?: string;
      role?: UserRole;
      activation_status?: "all" | "activated" | "pending";
    } = {
      activation_status: studentsActivationFilter
    };

    if (studentsSearch.trim()) {
      query.search = studentsSearch.trim();
    }

    if (studentsRoleFilter) {
      query.role = studentsRoleFilter;
    }

    const response = await getAdminStudents(token, query);
    setStudents(response.students);
  }

  async function refreshAudit(token: string) {
    const response = await getAudit(token, auditSearch);
    setAudit(response);
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
        void Promise.all([refreshElectionState(token), refreshStudents(token), refreshAudit(token)]);
      }

      setBootstrapping(false);
    });

    const channel = supabase
      .channel("results")
      .on("broadcast", { event: "results.refresh" }, () => {
        const token = accessTokenRef.current;
        if (token) {
          void refreshElectionState(token, { silent: true, syncForm: false });
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

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const session = await loginStudent(studentId, password);
      if (session.role !== "ec_admin") {
        setError("This account does not have Electoral Commission access.");
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
      await Promise.all([
        refreshElectionState(session.access_token),
        refreshStudents(session.access_token),
        refreshAudit(session.access_token)
      ]);
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
    setConfig(null);
    setResults(null);
    setResultsNotice(null);
    setStudents([]);
    setAudit(null);
    setIssueResult(null);
    setNotice(null);
    setError(null);
  }

  async function handleSaveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) return;

    setSavingConfig(true);
    setError(null);
    setNotice(null);

    try {
      const nextConfig = await saveEcConfig(accessToken, {
        poll_opens: toIsoFromLocal(scheduleForm.poll_opens),
        poll_closes: toIsoFromLocal(scheduleForm.poll_closes),
        is_locked: scheduleForm.is_locked
      });

      startTransition(() => setConfig(nextConfig));
      setNotice("Election timing updated.");
      await refreshElectionState(accessToken, { silent: true });
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to save the election timing");
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleOpenPollNow() {
    if (!accessToken) return;

    setSavingConfig(true);
    setError(null);
    setNotice(null);

    try {
      const nextConfig = await openEcPoll(accessToken);
      startTransition(() => {
        setConfig(nextConfig);
        setScheduleForm({
          poll_opens: toDateTimeLocalValue(nextConfig.election.poll_opens),
          poll_closes: toDateTimeLocalValue(nextConfig.election.poll_closes),
          is_locked: nextConfig.election.is_locked
        });
      });
      setNotice("Poll opened.");
      await refreshElectionState(accessToken, { silent: true, syncForm: false });
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to open the poll");
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleClosePollNow() {
    if (!accessToken) return;

    setSavingConfig(true);
    setError(null);
    setNotice(null);

    try {
      const nextConfig = await closeEcPoll(accessToken);
      startTransition(() => {
        setConfig(nextConfig);
        setScheduleForm({
          poll_opens: toDateTimeLocalValue(nextConfig.election.poll_opens),
          poll_closes: toDateTimeLocalValue(nextConfig.election.poll_closes),
          is_locked: nextConfig.election.is_locked
        });
      });
      setNotice("Poll closed.");
      await refreshElectionState(accessToken, { silent: true, syncForm: false });
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to close the poll");
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleCountResults() {
    if (!accessToken) return;

    setCounting(true);
    setError(null);
    setNotice(null);

    try {
      await countEcResults(accessToken);
      setNotice("Official count generated.");
      await refreshElectionState(accessToken, { silent: true, syncForm: false });
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to count results");
    } finally {
      setCounting(false);
    }
  }

  async function handleReleaseResults() {
    if (!accessToken) return;

    setReleasing(true);
    setError(null);
    setNotice(null);

    try {
      await releaseEcResults(accessToken);
      setNotice("Results released to the public.");
      await refreshElectionState(accessToken, { silent: true, syncForm: false });
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to release results");
    } finally {
      setReleasing(false);
    }
  }

  async function handleIssueCodes() {
    if (!accessToken) return;

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const entries = parseIssueEntries(issueCodesText, issueRole, issueCanVote);
      const result = await issueActivationCodes(accessToken, entries);
      setIssueResult(result);
      setNotice("Activation codes generated.");
      await refreshStudents(accessToken);
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to generate activation codes");
    } finally {
      setLoading(false);
    }
  }

  async function handleUploadCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setIssueCodesText(text);
  }

  async function handleRefreshStudents() {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      await refreshStudents(accessToken);
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to load users");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetActivation(studentId: string) {
    if (!accessToken) return;

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const reset = await resetStudentActivation(accessToken, studentId);
      setNotice(`New activation code issued for ${reset.student_id}.`);
      await refreshStudents(accessToken);
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to reset activation");
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleChange(studentId: string, role: UserRole, canVote?: boolean) {
    if (!accessToken) return;

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      await changeStudentRole(accessToken, studentId, role, canVote);
      setNotice(`Role updated for ${studentId}.`);
      await refreshStudents(accessToken);
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to change role");
    } finally {
      setLoading(false);
    }
  }

  async function handleRefreshAudit() {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      await refreshAudit(accessToken);
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to load audit log");
    } finally {
      setLoading(false);
    }
  }

  const positionGroups = buildPositionGroups(results?.rows);
  const auditCounts = buildAuditCounts(audit?.entries);
  const phase = getElectionPhase(config?.election ?? null);
  const resultsReleased = config?.election.results_released_at !== null;
  const resultsCounted = config?.election.results_counted_at !== null;
  const totalVerifications = results?.verifications.length ?? 0;
  const canReleaseResults =
    !!config &&
    Date.now() >= new Date(config.election.poll_closes).getTime() &&
    resultsCounted &&
    totalVerifications > 0;

  const filteredAuditEntries = useMemo(() => {
    return audit?.entries ?? [];
  }, [audit]);

  return (
    <SiteFrame
      eyebrow="EC admin"
      title="Electoral Commission"
      lead="Issue activation codes, manage users, control the election, and review the audit log."
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
        <AdminLoginGate
          studentId={studentId}
          password={password}
          error={error}
          loading={loading}
          onStudentIdChange={setStudentId}
          onPasswordChange={setPassword}
          onSubmit={handleLogin}
        />
      ) : (
        <section className="space-y-6">
          <div className="flex flex-wrap gap-3">
            {[
              ["issue-codes", "Issue Codes"],
              ["manage-users", "Manage Users"],
              ["election-control", "Election Control"],
              ["audit-log", "Audit Log"]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setActiveTab(value as AdminTab)}
                className={activeTab === value ? "button-primary" : "button-secondary"}
              >
                {label}
              </button>
            ))}
            <button className="button-secondary" type="button" onClick={() => void handleSignOut()}>
              Sign out
            </button>
          </div>

          {notice ? (
            <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {notice}
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {activeTab === "issue-codes" ? (
            <div className="section-panel space-y-5">
              <div className="space-y-2">
                <p className="eyebrow">Issue Codes</p>
                <h2 className="text-3xl font-semibold text-navy">Generate activation codes</h2>
                <p className="text-sm leading-7 text-stone">
                  Paste Student IDs one per line, or use Student ID and full name separated by a comma.
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                <textarea
                  className="input-field min-h-52 resize-y"
                  value={issueCodesText}
                  onChange={(event) => setIssueCodesText(event.target.value)}
                  placeholder={"SUC100001, Ama Nyarko\nSUC100002, Kwame Mensah"}
                />
                <div className="space-y-3">
                  <label className="space-y-2 text-sm font-semibold text-navy">
                    Role
                    <select
                      className="input-field"
                      value={issueRole}
                      onChange={(event) => {
                        const nextRole = event.target.value as UserRole;
                        setIssueRole(nextRole);
                        if (nextRole === "voter") {
                          setIssueCanVote(true);
                        }
                      }}
                    >
                      <option value="voter">Voter</option>
                      <option value="aspirant_rep">Aspirant Rep</option>
                      <option value="ec_admin">EC Admin</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border border-navy/10 bg-white px-4 py-3 text-sm text-navy">
                    <input
                      type="checkbox"
                      checked={issueCanVote}
                      onChange={(event) => setIssueCanVote(event.target.checked)}
                    />
                    <span>Also allowed to vote</span>
                  </label>
                  <label className="space-y-2 text-sm font-semibold text-navy">
                    Upload CSV
                    <input type="file" accept=".csv,.txt" className="input-field" onChange={handleUploadCsv} />
                  </label>
                  <button className="button-primary w-full" type="button" onClick={() => void handleIssueCodes()} disabled={loading}>
                    Generate codes
                  </button>
                </div>
              </div>

              <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                Print and distribute these codes securely. They will not be shown again after this page.
              </div>

              {issueResult ? (
                <div className="space-y-4">
                  <div className="flex justify-end">
                    <button className="button-secondary" type="button" onClick={() => downloadIssueCodesCsv(issueResult)}>
                      Download CSV
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-[24px] border border-navy/10">
                    <table className="min-w-full divide-y divide-navy/10 text-left text-sm">
                      <thead className="bg-navy text-cream">
                        <tr>
                          <th className="px-4 py-3 font-medium">Student ID</th>
                          <th className="px-4 py-3 font-medium">Full Name</th>
                          <th className="px-4 py-3 font-medium">Role</th>
                          <th className="px-4 py-3 font-medium">Can Vote</th>
                          <th className="px-4 py-3 font-medium">Activation Code</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-navy/10 bg-white">
                        {issueResult.issued.map((row) => (
                          <tr key={row.student_id}>
                            <td className="px-4 py-3 text-navy">{row.student_id}</td>
                            <td className="px-4 py-3 text-stone">{row.full_name}</td>
                            <td className="px-4 py-3 text-stone">{row.role}</td>
                            <td className="px-4 py-3 text-stone">{row.can_vote ? "Yes" : "No"}</td>
                            <td className="px-4 py-3 font-semibold text-navy">{row.activation_code}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {issueResult.skipped.length ? (
                    <div className="rounded-[22px] border border-navy/10 bg-cream/70 px-4 py-4 text-sm text-stone">
                      <p className="font-semibold text-navy">Skipped</p>
                      <ul className="mt-2 space-y-1">
                        {issueResult.skipped.map((row) => (
                          <li key={`${row.student_id}:${row.reason}`}>
                            {row.student_id}: {row.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === "manage-users" ? (
            <div className="section-panel space-y-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-2">
                  <p className="eyebrow">Manage Users</p>
                  <h2 className="text-3xl font-semibold text-navy">Students and roles</h2>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    className="input-field"
                    value={studentsSearch}
                    onChange={(event) => setStudentsSearch(event.target.value)}
                    placeholder="Search by Student ID or name"
                  />
                  <select
                    className="input-field"
                    value={studentsRoleFilter}
                    onChange={(event) => setStudentsRoleFilter(event.target.value as "" | UserRole)}
                  >
                    <option value="">All roles</option>
                    <option value="voter">Voter</option>
                    <option value="aspirant_rep">Aspirant Rep</option>
                    <option value="ec_admin">EC Admin</option>
                  </select>
                  <select
                    className="input-field"
                    value={studentsActivationFilter}
                    onChange={(event) => setStudentsActivationFilter(event.target.value as "all" | "activated" | "pending")}
                  >
                    <option value="all">All</option>
                    <option value="activated">Activated</option>
                    <option value="pending">Pending</option>
                  </select>
                  <button className="button-primary" type="button" onClick={() => void handleRefreshStudents()}>
                    Refresh
                  </button>
                </div>
              </div>

              <div className="overflow-hidden rounded-[24px] border border-navy/10">
                <table className="min-w-full divide-y divide-navy/10 text-left text-sm">
                  <thead className="bg-navy text-cream">
                    <tr>
                      <th className="px-4 py-3 font-medium">Student ID</th>
                      <th className="px-4 py-3 font-medium">Full Name</th>
                      <th className="px-4 py-3 font-medium">Role</th>
                      <th className="px-4 py-3 font-medium">Can Vote</th>
                      <th className="px-4 py-3 font-medium">Activated</th>
                      <th className="px-4 py-3 font-medium">Last login</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy/10 bg-white">
                    {students.map((student) => (
                      <tr key={student.student_id}>
                        <td className="px-4 py-3 text-navy">{student.student_id}</td>
                        <td className="px-4 py-3 text-stone">{student.full_name}</td>
                        <td className="px-4 py-3">
                          <select
                            className="input-field"
                            value={student.role}
                            onChange={(event) => void handleRoleChange(student.student_id, event.target.value as UserRole, student.can_vote)}
                          >
                            <option value="voter">Voter</option>
                            <option value="aspirant_rep">Aspirant Rep</option>
                            <option value="ec_admin">EC Admin</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <label className="flex items-center gap-2 text-sm text-navy">
                            <input
                              type="checkbox"
                              checked={student.can_vote}
                              onChange={(event) => void handleRoleChange(student.student_id, student.role, event.target.checked)}
                            />
                            <span>{student.can_vote ? "Yes" : "No"}</span>
                          </label>
                        </td>
                        <td className="px-4 py-3 text-stone">{student.activated ? "Yes" : "No"}</td>
                        <td className="px-4 py-3 text-stone">
                          {student.last_login_at ? new Date(student.last_login_at).toLocaleString() : "Never"}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            className="button-secondary"
                            type="button"
                            onClick={() => void handleResetActivation(student.student_id)}
                          >
                            Reset activation
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {activeTab === "election-control" ? (
            <section className="space-y-6">
              <div className="grid gap-6 2xl:grid-cols-[1.15fr_0.85fr]">
                <div className="section-panel space-y-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="eyebrow">Overview</p>
                      <h2 className="text-3xl font-semibold text-navy">Election control</h2>
                    </div>
                    <StatusBadge liveStatus={liveStatus} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StatCard label="Status" value={getElectionPhase(config?.election ?? null)} note="Current poll state." />
                    <StatCard
                      label="Results"
                      value={config?.election.results_released_at ? "Public" : "Sealed"}
                      note={config?.election.results_released_at ? "Results released." : "Results awaiting EC release."}
                    />
                    <StatCard
                      label="Count"
                      value={config?.election.results_counted_at ? "Ready" : "Pending"}
                      note={config?.election.results_counted_at ? "The official count has been generated." : "Generate the count after polls close."}
                    />
                    <StatCard
                      label="Rep checks"
                      value={formatNumber(results?.verifications.length ?? 0)}
                      note="Verification messages received."
                    />
                  </div>
                </div>

                <div className="section-panel space-y-5">
                  <div className="space-y-2">
                    <p className="eyebrow">Actions</p>
                    <h2 className="text-3xl font-semibold text-navy">Quick control</h2>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button className="button-primary" type="button" onClick={() => void handleOpenPollNow()} disabled={savingConfig}>
                      {savingConfig ? "Working..." : "Open poll now"}
                    </button>
                    <button className="button-secondary" type="button" onClick={() => void handleClosePollNow()} disabled={savingConfig}>
                      Close poll now
                    </button>
                    <button className="button-primary" type="button" onClick={() => void handleCountResults()} disabled={counting}>
                      {counting ? "Counting..." : "Count results"}
                    </button>
                    <button
                      className="button-primary"
                      type="button"
                      onClick={() => void handleReleaseResults()}
                      disabled={releasing || !!config?.election.results_released_at || !(!!config && Date.now() >= new Date(config.election.poll_closes).getTime() && !!config.election.results_counted_at && (results?.verifications.length ?? 0) > 0)}
                    >
                      {config?.election.results_released_at ? "Results already public" : releasing ? "Releasing..." : "Release results"}
                    </button>
                  </div>
                  {config ? (
                    <div className="rounded-[22px] border border-navy/10 bg-cream/70 px-4 py-4 text-sm text-stone">
                      Polls open {new Date(config.election.poll_opens).toLocaleString()} and close{" "}
                      {new Date(config.election.poll_closes).toLocaleString()}.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="section-panel space-y-5">
                <div className="space-y-2">
                  <p className="eyebrow">Schedule</p>
                  <h2 className="text-3xl font-semibold text-navy">Set poll times</h2>
                </div>
                <form className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end" onSubmit={handleSaveSchedule}>
                  <div className="space-y-2">
                    <label htmlFor="admin-poll-opens" className="text-sm font-semibold text-navy">
                      Poll opens
                    </label>
                    <input
                      id="admin-poll-opens"
                      type="datetime-local"
                      className="input-field"
                      value={scheduleForm.poll_opens}
                      onChange={(event) => setScheduleForm((current) => ({ ...current, poll_opens: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="admin-poll-closes" className="text-sm font-semibold text-navy">
                      Poll closes
                    </label>
                    <input
                      id="admin-poll-closes"
                      type="datetime-local"
                      className="input-field"
                      value={scheduleForm.poll_closes}
                      onChange={(event) => setScheduleForm((current) => ({ ...current, poll_closes: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3 rounded-2xl border border-navy/10 bg-white px-4 py-3 text-sm text-navy">
                      <input
                        type="checkbox"
                        checked={scheduleForm.is_locked}
                        onChange={(event) => setScheduleForm((current) => ({ ...current, is_locked: event.target.checked }))}
                      />
                      <span>Keep poll locked</span>
                    </label>
                    <button className="button-primary w-full" type="submit" disabled={savingConfig}>
                      {savingConfig ? "Saving..." : "Save schedule"}
                    </button>
                  </div>
                </form>
              </div>

              <div className="section-panel space-y-5">
                <div className="space-y-2">
                  <p className="eyebrow">Count</p>
                  <h2 className="text-3xl font-semibold text-navy">Votes by position</h2>
                </div>
                {results ? (
                  <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                    {buildPositionGroups(results.rows).map((group) => (
                      <PositionCard key={group.positionId} title={group.title} rows={group.rows} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-navy/10 bg-cream/70 px-5 py-5 text-sm text-stone">
                    {resultsNotice ?? "Vote totals appear here after polls close."}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {activeTab === "audit-log" ? (
            <div className="section-panel space-y-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-2">
                  <p className="eyebrow">Audit Log</p>
                  <h2 className="text-3xl font-semibold text-navy">Recent actions</h2>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    className="input-field"
                    value={auditSearch}
                    onChange={(event) => setAuditSearch(event.target.value)}
                    placeholder="Search audit log"
                  />
                  <button className="button-primary" type="button" onClick={() => void handleRefreshAudit()}>
                    Refresh
                  </button>
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={() => audit && downloadAuditCsv(audit)}
                    disabled={!audit}
                  >
                    Export CSV
                  </button>
                </div>
              </div>
              {auditCounts.length ? (
                <div className="flex flex-wrap gap-3">
                  {auditCounts.map(([eventType, count]) => (
                    <div key={eventType} className="rounded-full border border-navy/10 bg-cream/75 px-4 py-2 text-sm text-navy">
                      <span className="font-semibold">{eventType}</span>
                      <span className="ml-2 text-stone">{formatNumber(count)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="overflow-hidden rounded-[24px] border border-navy/10">
                <table className="min-w-full divide-y divide-navy/10 text-left text-sm">
                  <thead className="bg-navy text-cream">
                    <tr>
                      <th className="px-4 py-3 font-medium">Action</th>
                      <th className="px-4 py-3 font-medium">Actor</th>
                      <th className="px-4 py-3 font-medium">IP address</th>
                      <th className="px-4 py-3 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy/10 bg-white">
                    {filteredAuditEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-4 py-3 text-navy">{entry.event_type}</td>
                        <td className="px-4 py-3 text-stone">{entry.actor_token ?? "N/A"}</td>
                        <td className="px-4 py-3 text-stone">{entry.ip_address ?? "N/A"}</td>
                        <td className="px-4 py-3 text-stone">{new Date(entry.logged_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </SiteFrame>
  );
}
