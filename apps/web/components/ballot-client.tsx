"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { BallotResponse } from "@suc-vote/shared";

import { BackendError, castVote, getBallot } from "../lib/api";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";
import { SiteFrame } from "./site-frame";

export function BallotClient() {
  const [ballot, setBallot] = useState<BallotResponse | null>(null);
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

  const currentPosition = ballot?.positions.find((position) => !position.has_voted) ?? null;
  const completed = ballot?.positions.filter((position) => position.has_voted).length ?? 0;
  const total = ballot?.positions.length ?? 0;
  const currentIndex = ballot?.positions.findIndex((position) => !position.has_voted) ?? -1;
  const currentPositionId = currentPosition?.id ?? null;

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
            : `${currentPosition.title}. ${completed} of ${total} positions recorded.`}
      </p>
      <section className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <aside className="section-panel space-y-6">
          <div className="space-y-2">
            <p className="eyebrow">Progress</p>
            <h2 className="text-3xl font-semibold text-navy" aria-live="polite">
              {completed} of {total} positions recorded
            </h2>
          </div>

          {ballot ? (
            <ol className="space-y-3">
              {ballot.positions.map((position, index) => (
                <li
                  key={position.id}
                  className="rounded-2xl border border-navy/10 bg-cream/80 px-4 py-3 text-sm text-stone"
                  aria-current={!position.has_voted && index === currentIndex ? "step" : undefined}
                >
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-semibold text-navy">{position.title}</span>
                    <span className={position.has_voted ? "text-gold" : "text-stone"}>
                      {position.has_voted ? "Recorded" : !position.has_voted && index === currentIndex ? "Current" : "Pending"}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}

          <div className="rounded-2xl border border-gold/20 bg-navy px-5 py-5 text-sm leading-7 text-cream/80">
            Pick a candidate and confirm your choice.
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
                <p className="eyebrow">Current office</p>
                <h2 ref={currentOfficeRef} tabIndex={-1} className="text-3xl font-semibold text-navy">
                  {currentPosition.title}
                </h2>
                <p className="text-sm leading-7 text-stone">
                  Select one candidate, then confirm.
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
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold">
                            Ballot #{candidate.ballot_num}
                          </p>
                          <h3 className="mt-2 text-2xl font-semibold text-navy">{candidate.full_name}</h3>
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
                    Confirm to submit.
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
