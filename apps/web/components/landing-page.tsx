"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "../lib/supabase-browser";
import { SiteFrame } from "./site-frame";

interface ElectionWindow {
  poll_opens: string;
  poll_closes: string;
  is_locked: boolean;
}

function formatDistance(target: string, now: number) {
  const diff = Math.max(0, new Date(target).getTime() - now);
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

export function LandingPage() {
  const [windowState, setWindowState] = useState<ElectionWindow | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase
      .from("election_config")
      .select("poll_opens, poll_closes, is_locked")
      .order("poll_closes", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setWindowState(data);
        }
      });

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const pollOpen = windowState ? new Date(windowState.poll_opens).getTime() : null;
  const pollClose = windowState ? new Date(windowState.poll_closes).getTime() : null;
  const hasOpened = pollOpen !== null && now >= pollOpen;
  const hasClosed = pollClose !== null && now >= pollClose;
  const countdownValue = windowState
    ? !hasOpened
      ? formatDistance(windowState.poll_opens, now)
      : hasClosed
        ? "Closed"
        : formatDistance(windowState.poll_closes, now)
    : "--";
  const countdownLabel = !windowState
    ? "Waiting for schedule"
    : !hasOpened
      ? "Polls open in"
      : hasClosed
        ? "Polls are closed"
        : "Polls close in";

  return (
    <SiteFrame
      eyebrow="SRC Elections"
      title="SRC Electronic Voting System"
      actions={
        <div className="min-w-[13rem] rounded-[16px] border border-[#c7a25c]/35 bg-[rgba(5,14,24,0.9)] px-4 py-1.5 text-right shadow-[0_10px_24px_rgba(0,0,0,0.18)] sm:min-w-[16rem]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d6b067]">
              {countdownLabel}
            </p>
            <p className="text-base font-semibold text-[#f8f2e9] sm:text-xl">{countdownValue}</p>
          </div>
        </div>
      }
    >
      <section className="mx-auto flex w-full flex-1 items-center justify-center py-10 lg:py-16">
        <div className="section-panel w-full max-w-xl space-y-3 shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
          <Link
            href="/login"
            className="flex items-center justify-between rounded-[24px] bg-[#10253c] px-5 py-5 text-base font-semibold text-[#f8f2e9] transition hover:bg-[#17324f]"
          >
            <span>Students</span>
            <span className="text-[#d6b067]">01</span>
          </Link>
          <Link
            href="/admin"
            className="flex items-center justify-between rounded-[24px] border border-navy/15 bg-white px-5 py-5 text-base font-semibold text-navy transition hover:border-gold hover:text-gold"
          >
            <span>Electoral Commission</span>
            <span>02</span>
          </Link>
          <Link
            href="/rep/dashboard"
            className="flex items-center justify-between rounded-[24px] border border-navy/15 bg-white px-5 py-5 text-base font-semibold text-navy transition hover:border-gold hover:text-gold"
          >
            <span>Aspirant Reps</span>
            <span>03</span>
          </Link>
        </div>
      </section>
    </SiteFrame>
  );
}
