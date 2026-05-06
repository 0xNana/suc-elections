"use client";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="page-shell pt-24">
      <section className="mx-auto flex w-full flex-1 items-center justify-center py-10 lg:py-16">
        <div className="section-panel w-full max-w-xl space-y-4 text-center">
          <p className="eyebrow">Something went wrong</p>
          <h1 className="text-3xl font-semibold text-navy">This page could not be loaded.</h1>
          <p className="text-sm leading-7 text-stone">
            Please try again. If the problem continues, contact the election team.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button className="button-primary" type="button" onClick={() => reset()}>
              Try again
            </button>
            <a href="/" className="button-secondary">
              Return home
            </a>
          </div>
          {process.env.NODE_ENV !== "production" ? (
            <pre className="overflow-auto rounded-2xl bg-cream px-4 py-3 text-left text-xs text-stone">
              {error.message}
            </pre>
          ) : null}
        </div>
      </section>
    </main>
  );
}
