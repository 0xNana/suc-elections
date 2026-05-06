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
  photoUrl
}: {
  fullName: string;
  photoUrl: string | null;
}) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={fullName}
        className="h-16 w-16 shrink-0 rounded-full border-2 border-gold/30 object-cover bg-navy/5"
      />
    );
  }

  return (
    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-gold/30 bg-navy text-cream shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="absolute h-10 w-10 text-cream/10"
        fill="currentColor"
      >
        <path d="M12 12c2.76 0 5-2.69 5-6s-2.24-6-5-6-5 2.69-5 6 2.24 6 5 6Zm0 2c-4.42 0-8 2.91-8 6.5 0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5C20 16.91 16.42 14 12 14Z" />
      </svg>
      <span className="relative text-lg font-semibold tracking-[0.08em]">{getInitials(fullName)}</span>
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
      <section className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <aside className="section-panel space-y-6">
          <div className="space-y-2">
            <p className="eyebrow">Progress</p>
            <h2 className="text-3xl font-semibold text-navy" aria-live="polite">
              {completed} of {total} offices completed
            </h2>
          </div>

          {ballot ? (
            <ol className="space-y-3">
              {ballot.positions.map((position, index) => (
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
                    aria-current={!position.has_voted && index === currentIndex ? "step" : undefined}
                    className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      position.has_voted
                        ? "cursor-default border-navy/10 bg-cream/70 text-stone"
                        : index === currentIndex
                          ? "border-gold bg-gold/10 text-navy"
                          : "border-navy/10 bg-cream/80 text-stone hover:border-gold/40 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-semibold text-navy">{position.title}</span>
                      <span className={position.has_voted ? "text-gold" : index === currentIndex ? "text-navy" : "text-stone"}>
                        {position.has_voted ? "Done" : index === currentIndex ? "Selected" : "Select"}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}

          <div className="rounded-2xl border border-gold/20 bg-navy px-5 py-5 text-sm leading-7 text-cream/80">
            Select an office here, then choose a candidate on the right.
          </div>
        </aside>

        <div className="section-panel">
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
              <Link href="/" className="button-primary">
                Return home
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <p className="eyebrow">Selected office</p>
                <h2 ref={currentOfficeRef} tabIndex={-1} className="text-3xl font-semibold text-navy">
                  {currentPosition.title}
                </h2>
                <p className="text-sm leading-7 text-stone">
                  Choose one candidate, then submit your vote.
                </p>
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
                      className={`rounded-[26px] border px-5 py-5 text-left transition ${
                        active
                          ? "border-gold bg-gold/10"
                          : "border-navy/10 bg-white hover:border-gold/40"
                      }`}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-4">
                          <CandidateAvatar
                            fullName={candidate.full_name}
                            photoUrl={candidate.photo_url}
                          />
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold">
                              Ballot #{candidate.ballot_num}
                            </p>
                            <h3 className="mt-2 text-2xl font-semibold text-navy">{candidate.full_name}</h3>
                          </div>
                        </div>
                        <span
                          className={`inline-flex h-12 w-12 items-center justify-center rounded-full border ${
                            active ? "border-gold bg-gold text-navy" : "border-navy/15 text-stone"
                          }`}
                        >
                          {active ? "✓" : candidate.ballot_num}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedCandidateId ? (
                <div className="rounded-[24px] border border-gold/20 bg-cream/80 px-5 py-5">
                  <p className="text-sm leading-7 text-stone">
                    You chose a candidate for <span className="font-semibold text-navy">{currentPosition.title}</span>.
                    Submit to record this office and move on to any remaining one.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button className="button-primary" type="button" onClick={handleVote} disabled={submitting}>
                      {submitting ? "Submitting vote..." : "Confirm selection"}
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
              ) : null}
            </div>
          )}
        </div>
      </section>
    </SiteFrame>
  );
}
