import Link from "next/link";

import { LandingCountdownBadge } from "./landing-countdown-badge";
import { SiteFrame } from "./site-frame";

export function LandingPage() {
  return (
    <SiteFrame
      eyebrow="SRC Elections"
      title="SRC Electronic Voting System"
      actions={<LandingCountdownBadge />}
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
