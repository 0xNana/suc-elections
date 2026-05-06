import Link from "next/link";

export function SiteFrame({
  title,
  eyebrow,
  lead,
  children,
  actions,
  fullWidth = false
}: {
  title: string;
  eyebrow: string;
  lead?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="fixed top-0 right-0 left-0 z-50 w-full border-b border-[#d8c7a5]/80 bg-[rgba(248,244,236,0.95)] shadow-[0_10px_28px_rgba(0,0,0,0.08)] backdrop-blur-sm">
        <div className="mx-auto grid w-full max-w-[1440px] grid-cols-[1fr_auto] gap-3 px-4 py-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 lg:justify-self-start">
            <Link href="/" className="inline-flex shrink-0 items-center" aria-label="Southshore University College home">
              <picture>
                <source
                  media="(max-width: 640px)"
                  srcSet="https://www.southshore.edu.gh/assets/images/logo-mobile-v.png"
                />
                <img
                  src="https://www.southshore.edu.gh/assets/images/suc-logo.png"
                  alt="Southshore University College"
                  className="h-10 w-auto sm:h-11"
                />
              </picture>
            </Link>
          </div>
          {actions ? <div className="flex shrink-0 justify-self-end lg:order-3 lg:justify-self-end lg:justify-end">{actions}</div> : <div className="justify-self-end lg:order-3" />}
          <div className="col-span-2 min-w-0 text-left lg:order-2 lg:col-span-1 lg:text-center">
            <h1 className="min-w-0 text-lg font-semibold leading-tight text-navy sm:text-2xl">
              {title}
            </h1>
            {lead ? (
              <p className="mx-auto max-w-2xl text-xs leading-5 text-stone sm:text-sm sm:leading-6">{lead}</p>
            ) : null}
          </div>
        </div>
      </header>
      <main id="main-content" className="flex flex-1 flex-col">
        <div className={`${fullWidth ? "page-shell-wide" : "page-shell"} pt-36 sm:pt-32 lg:pt-24`}>{children}</div>
      </main>
      <footer className="w-full border-t border-[#10253c]/15 bg-[#10253c] text-[#f8f2e9]">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-10 text-base sm:px-6 sm:py-12 lg:flex-row lg:items-center lg:justify-between lg:px-8 lg:py-14">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#d6b067]">
              From Africa, A New Light. {eyebrow}
            </p>
            <p className="text-[#e6dccb]">© 2026 Mr. Ace.</p>
            <p>
              Built by <span className="font-semibold text-[#f8f2e9]">Mr. Ace</span>
            </p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-5">
            <a
              href="https://admissions.southshore.edu.gh"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-full bg-[#d6b067] px-5 py-3 font-semibold text-[#10253c] transition hover:bg-[#e3bb73]"
            >
              Apply Now
            </a>
            <div className="flex flex-wrap items-center gap-4">
              <a
                href="tel:0554165745"
                aria-label="Call Mr. Ace"
                className="inline-flex items-center gap-2 rounded-full border border-[#c7a25c]/35 bg-[rgba(255,255,255,0.04)] px-4 py-3 font-medium text-[#f8f2e9] transition hover:border-[#d6b067] hover:text-[#d6b067]"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5 fill-none stroke-current"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.35 1.77.68 2.6a2 2 0 0 1-.45 2.11L8.07 9.91a16 16 0 0 0 6 6l1.48-1.27a2 2 0 0 1 2.11-.45c.83.33 1.7.56 2.6.68A2 2 0 0 1 22 16.92Z" />
                </svg>
                <span>Call</span>
              </a>
              <a
                href="https://wa.me/233554165745"
                target="_blank"
                rel="noreferrer"
                aria-label="WhatsApp Mr. Ace"
                className="inline-flex items-center gap-2 rounded-full border border-[#c7a25c]/35 bg-[rgba(255,255,255,0.04)] px-4 py-3 font-medium text-[#f8f2e9] transition hover:border-[#d6b067] hover:text-[#d6b067]"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5 fill-none stroke-current"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20.52 3.48A11.86 11.86 0 0 0 12.06 0C5.49 0 .15 5.34.15 11.91c0 2.1.55 4.15 1.6 5.97L0 24l6.32-1.66a11.9 11.9 0 0 0 5.74 1.47h.01c6.57 0 11.91-5.34 11.91-11.91 0-3.18-1.24-6.17-3.46-8.42Z" />
                  <path d="M8.6 7.64c-.23-.51-.48-.52-.7-.53h-.6c-.21 0-.56.08-.85.39-.29.31-1.12 1.09-1.12 2.66s1.15 3.08 1.31 3.29c.16.21 2.26 3.62 5.58 4.93 2.75 1.08 3.31.87 3.91.81.6-.06 1.94-.79 2.21-1.55.27-.76.27-1.41.19-1.55-.08-.14-.29-.23-.6-.39-.31-.16-1.85-.93-2.13-1.03-.29-.11-.5-.16-.71.16-.21.31-.81 1.03-.99 1.24-.18.21-.37.23-.68.08-.31-.16-1.33-.5-2.53-1.6-.93-.84-1.56-1.88-1.74-2.19-.18-.31-.02-.48.13-.63.14-.14.31-.37.47-.55.16-.18.21-.31.31-.52.1-.21.05-.39-.03-.55-.08-.16-.71-1.79-1-2.42Z" />
                </svg>
                <span>WhatsApp</span>
              </a>
              <a
                href="mailto:hellodaries@gmail.com"
                aria-label="Email Mr. Ace"
                className="inline-flex items-center gap-2 rounded-full border border-[#c7a25c]/35 bg-[rgba(255,255,255,0.04)] px-4 py-3 font-medium text-[#f8f2e9] transition hover:border-[#d6b067] hover:text-[#d6b067]"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5 fill-none stroke-current"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
                  <path d="m22 7-10 7L2 7" />
                </svg>
                <span>Email</span>
              </a>
            </div>
            <a
              href="https://www.southshore.edu.gh/"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-[#f8f2e9] transition hover:text-[#d6b067]"
            >
              southshore.edu.gh
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
