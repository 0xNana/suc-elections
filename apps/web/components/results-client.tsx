"use client";

import { useEffect, useState } from "react";

import type { ResultsResponse } from "@suc-vote/shared";

import { BackendError, getResults } from "../lib/api";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";
import { SiteFrame } from "./site-frame";

interface ElectionWindow {
  poll_closes: string;
}

function isEmptyElectionConfigError(cause: unknown) {
  return cause instanceof BackendError && cause.status === 503 && cause.message === "Election configuration is unavailable";
}

export function ResultsClient() {
  const [response, setResponse] = useState<ResultsResponse | null>(null);
  const [closeWindow, setCloseWindow] = useState<ElectionWindow | null>(null);
  const [sealedMessage, setSealedMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadResults() {
    try {
      const data = await getResults();
      setResponse(data);
      setSealedMessage(null);
    } catch (cause) {
      if (cause instanceof BackendError && cause.status === 403) {
        setSealedMessage(cause.message);
        return;
      }

      if (isEmptyElectionConfigError(cause)) {
        setSealedMessage(null);
        return;
      }

      setSealedMessage("Unable to load results.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase
      .from("election_config")
      .select("poll_closes")
      .order("poll_closes", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setCloseWindow(data);
        }
      });

    void loadResults();

    const channel = supabase
      .channel("results")
      .on("broadcast", { event: "results.refresh" }, () => {
        void loadResults();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const grouped = new Map<string, Array<ResultsResponse["rows"][number]>>();
  for (const row of response?.rows ?? []) {
    const existing = grouped.get(row.position) ?? [];
    existing.push(row);
    grouped.set(row.position, existing);
  }

  return (
    <SiteFrame
      eyebrow="Results"
      title="Official results"
      lead="Results appear here only after the EC releases them."
    >
      <section className="space-y-6">
        {loading ? <div className="section-panel text-stone">Loading results...</div> : null}

        {sealedMessage ? (
          <div className="section-panel space-y-3">
            <p className="eyebrow">Results status</p>
            <h2 className="text-3xl font-semibold text-navy">{sealedMessage}</h2>
            <p className="text-sm leading-7 text-stone">
              {closeWindow
                ? `Polls close at ${new Date(closeWindow.poll_closes).toLocaleString()}. Results stay hidden until the EC releases them.`
                : "Election close time is being loaded."}
            </p>
          </div>
        ) : null}

        {!sealedMessage && response ? (
          [...grouped.entries()].map(([position, rows]) => (
            <div key={position} className="section-panel">
              <div className="mb-5 flex items-end justify-between gap-4">
                <div>
                  <p className="eyebrow">Position</p>
                  <h2 className="text-3xl font-semibold text-navy">{position}</h2>
                </div>
                <p className="text-sm text-stone">
                  Refreshed {new Date(response.refreshed_at).toLocaleTimeString()}
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {rows.map((row) => (
                  <div
                    key={row.candidate_id}
                    className="rounded-[24px] border border-navy/10 bg-cream/70 px-5 py-5"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold">
                      Ballot #{row.ballot_num}
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold text-navy">{row.candidate}</h3>
                    <p className="mt-4 text-sm text-stone">Recorded votes</p>
                    <p className="text-3xl font-semibold text-navy">{row.vote_count}</p>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : null}
      </section>
    </SiteFrame>
  );
}
