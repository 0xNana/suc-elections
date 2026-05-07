"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { BallotResponse } from "@suc-vote/shared";

import { BackendError, castVote, getBallot } from "../lib/api";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";
import { SiteFrame } from "./site-frame";

function getInitials(fullName: string) {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function CandidateAvatar({
  fullName,
  photoUrl,
  large = false
}: {
  fullName: string;
  photoUrl: string | null;
  large?: boolean;
}) {
  const sizeClass = large ? "h-24 w-24 sm:h-28 sm:w-28" : "h-16 w-16";
  const iconClass = large ? "h-14 w-14" : "h-10 w-10";
  const textClass = large ? "text-2xl" : "text-lg";

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={fullName}
        className={`${sizeClass} shrink-0 rounded-full border-2 border-gold/30 object-cover bg-navy/5`}
      />
    );
  }

  return (
    <div className={`relative flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-gold/30 bg-navy text-cream shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]`}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={`absolute ${iconClass} text-cream/10`}
        fill="currentColor"
      >
        <path d="M12 12c2.76 0 5-2.69 5-6s-2.24-6-5-6-5 2.69-5 6 2.24 6 5 6Zm0 2c-4.42 0-8 2.91-8 6.5 0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5C20 16.91 16.42 14 12 14Z" />
      </svg>
      <span className={`relative ${textClass} font-semibold tracking-[0.08em]`}>{getInitials(fullName)}</span>
    </div>
  );
}

export function BallotClient() {
  const [ballot, setBallot] = useState<BallotResponse | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const currentOfficeRef = useRef<HTMLHeadingElement>(null);
  const errorId = "ballot-error";

  useEffect(() => {
    let active = true;

    async function loadBallot() {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      if (!accessToken) {
        router.replace("/login");
        return;
      }

      try {
        const nextBallot = await getBallot(accessToken);
        if (active) {
          setBallot(nextBallot);
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof BackendError ? cause.message : "Unable to load ballot");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadBallot();

    return () => {
      active = false;
    };
  }, [router]);

  const unvotedPositions = ballot?.positions.filter((position) => !position.has_voted) ?? [];
  const fallbackPosition = unvotedPositions[0] ?? null;
  const currentPosition =
    ballot?.positions.find((position) => position.id === selectedPositionId && !position.has_voted) ??
    fallbackPosition ??
    null;
  const completed = ballot?.positions.filter((position) => position.has_voted).length ?? 0;
  const total = ballot?.positions.length ?? 0;
  const currentIndex = ballot?.positions.findIndex((position) => position.id === currentPosition?.id) ?? -1;
  const currentPositionId = currentPosition?.id ?? null;
  const selectedCandidate =
    currentPosition?.candidates.find((candidate) => candidate.id === selectedCandidateId) ?? null;

  useEffect(() => {
    if (!ballot) {
      return;
    }

    if (currentPositionId) {
      return;
    }

    setSelectedPositionId(fallbackPosition?.id ?? null);
  }, [ballot, currentPositionId, fallbackPosition?.id]);

  useEffect(() => {
    setSelectedCandidateId(null);
  }, [currentPositionId]);

  useEffect(() => {
    if (!loading && currentOfficeRef.current) {
      currentOfficeRef.current.focus();
    }
  }, [loading, currentPositionId]);

  async function handleVote() {
    if (!ballot || !currentPosition || !selectedCandidateId) {
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;

    if (!accessToken) {
      router.replace("/login");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const confirmation = await castVote(accessToken, currentPosition.id, selectedCandidateId);
      router.push(`/confirmation/${confirmation.confirmation_hash}`);
    } catch (cause) {
      setError(cause instanceof BackendError ? cause.message : "Unable to record vote");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SiteFrame
      eyebrow="Voting interface"
      title="Choose one candidate for each office."
      lead="Review your choice before you submit it."
      actions={
        <Link href="/" className="button-secondary">
          Exit to home
        </Link>
      }
    >
      <p className="visually-hidden" aria-live="polite">
        {loading
          ? "Loading ballot."
          : !currentPosition
            ? "Ballot complete."
            : `${currentPosition.title} selected. ${completed} of ${total} offices completed.`}
      </p>
      <section className="grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
        <aside className="section-panel space-y-6">
          <div className="space-y-2">
            <p className="eyebrow">Ballot paper</p>
            <h2 className="text-3xl font-semibold text-navy" aria-live="polite">
              {completed} of {total} offices completed
            </h2>
            <p className="text-sm leading-7 text-stone">
              Offices appear in the official ballot order. Select an office, then choose one candidate.
            </p>
          </div>

          {ballot ? (
            <ol className="space-y-3">
              {ballot.positions.map((position, index) => {
                const selected = !position.has_voted && index === currentIndex;
                return (
                  <li key={position.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!position.has_voted) {
                          setSelectedPositionId(position.id);
                          setError(null);
                        }
                      }}
                      disabled={position.has_voted}
                      aria-current={selected ? "step" : undefined}
                      className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                        position.has_voted
                          ? "cursor-default border-navy/10 bg-white/70 text-stone"
                          : selected
                            ? "border-gold bg-[#f8e8bd] text-navy shadow-[0_12px_30px_rgba(184,145,58,0.16)]"
                            : "border-navy/10 bg-cream/80 text-stone hover:border-gold/40 hover:bg-white"
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <span
                          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                            position.has_voted
                              ? "border-gold/30 bg-white text-gold"
                              : selected
                                ? "border-gold bg-navy text-cream"
                                : "border-navy/10 bg-white text-navy"
                          }`}
                        >
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-4">
                            <h3 className="text-lg font-semibold text-navy">{position.title}</h3>
                            <span
                              className={`text-xs font-semibold uppercase tracking-[0.22em] ${
                                position.has_voted ? "text-gold" : selected ? "text-navy" : "text-stone"
                              }`}
                            >
                              {position.has_voted ? "Recorded" : selected ? "Current" : "Pending"}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-stone">
                            {position.has_voted
                              ? "Vote already recorded for this office."
                              : selected
                                ? "Choose one candidate from the panel on the right."
                                : "Open this office to make your selection."}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : null}

        </aside>

        <div className="section-panel space-y-6">
          {loading ? (
            <p role="status" className="text-stone">
              Loading ballot...
            </p>
          ) : error ? (
            <div
              id={errorId}
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : !ballot ? (
            <p className="text-stone">Ballot data is unavailable.</p>
          ) : !currentPosition ? (
            <div className="space-y-4">
              <p className="eyebrow">Ballot complete</p>
              <h2 className="text-3xl font-semibold text-navy">All available positions have been recorded.</h2>
              <p className="text-base leading-7 text-stone">
                You may revisit this page to review completion status, but submitted positions cannot be changed.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/" className="button-primary">
                  Return home
                </Link>
                {ballot.election.results_released_at ? (
                  <Link href="/results" className="button-secondary">
                    View results
                  </Link>
                ) : null}
              </div>
              {!ballot.election.results_released_at ? (
                <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-semibold text-amber-800">
                  Results will be available after EC release.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-[26px] border border-navy/10 bg-cream/75 px-6 py-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <p className="eyebrow">Selected office</p>
                    <h2 ref={currentOfficeRef} tabIndex={-1} className="text-4xl font-semibold text-navy">
                      {currentPosition.title}
                    </h2>
                    <p className="text-sm leading-7 text-stone">
                      Choose one candidate for this office, then confirm your selection to record the vote.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:min-w-[220px]">
                    <div className="rounded-[20px] border border-navy/10 bg-white px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold">Office</p>
                      <p className="mt-1 text-base font-semibold text-navy">
                        {currentIndex >= 0 ? `${currentIndex + 1} of ${total}` : `1 of ${total}`}
                      </p>
                    </div>
                    <div className="rounded-[20px] border border-navy/10 bg-white px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold">Status</p>
                      <p className="mt-1 text-base font-semibold text-navy">
                        {selectedCandidate ? "Candidate selected" : "Awaiting selection"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4" role="list" aria-label={`Candidates for ${currentPosition.title}`}>
                {currentPosition.candidates.map((candidate) => {
                  const active = selectedCandidateId === candidate.id;

                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => {
                        setSelectedCandidateId(candidate.id);
                        setError(null);
                      }}
                      aria-pressed={active}
                      aria-describedby={error ? errorId : undefined}
                      className={`rounded-[28px] border px-6 py-6 text-left transition ${
                        active
                          ? "border-gold bg-[#f8e8bd] shadow-[0_18px_36px_rgba(184,145,58,0.18)]"
                          : "border-navy/10 bg-white hover:border-gold/40 hover:bg-cream/50"
                      }`}
                    >
                      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-5">
                          <CandidateAvatar
                            fullName={candidate.full_name}
                            photoUrl={candidate.photo_url}
                            large
                          />
                          <div className="min-w-0">
                            <div className="inline-flex items-center rounded-full border border-gold/30 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-gold">
                              Ballot #{candidate.ballot_num}
                            </div>
                            <h3 className="mt-3 text-3xl font-semibold text-navy">{candidate.full_name}</h3>
                            <p className="mt-2 text-sm leading-6 text-stone">
                              {active
                                ? "Selected for this office."
                                : "Tap to select this candidate for the current office."}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-end">
                          <span
                            className={`inline-flex h-14 w-14 items-center justify-center rounded-full border-2 ${
                              active
                                ? "border-gold bg-navy text-cream"
                                : "border-navy/15 bg-white text-stone"
                            }`}
                            aria-hidden="true"
                          >
                            {active ? "✓" : ""}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="sticky bottom-4 z-10 rounded-[26px] border border-gold/25 bg-[rgba(248,244,236,0.98)] px-5 py-5 shadow-[0_20px_40px_rgba(13,29,48,0.12)] backdrop-blur-sm">
                {selectedCandidate ? (
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold">Ready to record</p>
                      <p className="text-base leading-7 text-stone">
                        <span className="font-semibold text-navy">{selectedCandidate.full_name}</span> selected for{" "}
                        <span className="font-semibold text-navy">{currentPosition.title}</span>.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button className="button-primary" type="button" onClick={handleVote} disabled={submitting}>
                        {submitting ? "Submitting vote..." : "Record vote"}
                      </button>
                      <button
                        className="button-secondary"
                        type="button"
                        onClick={() => setSelectedCandidateId(null)}
                        disabled={submitting}
                      >
                        Clear selection
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm leading-7 text-stone">
                    Select one candidate above to unlock the vote action for <span className="font-semibold text-navy">{currentPosition.title}</span>.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </SiteFrame>
  );
}
