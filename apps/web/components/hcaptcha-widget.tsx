"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    hcaptcha?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => number;
      reset: (widgetId: number) => void;
      remove?: (widgetId: number) => void;
    };
    __hcaptchaScriptPromise?: Promise<void>;
  }
}

function loadHCaptchaScript() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.hcaptcha) {
    return Promise.resolve();
  }

  if (window.__hcaptchaScriptPromise) {
    return window.__hcaptchaScriptPromise;
  }

  window.__hcaptchaScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src*="js.hcaptcha.com/1/api.js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load hCaptcha")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load hCaptcha"));
    document.head.appendChild(script);
  });

  return window.__hcaptchaScriptPromise;
}

export function HCaptchaWidget({
  token,
  onTokenChange,
  resetSignal
}: {
  token: string | null;
  onTokenChange: (token: string | null) => void;
  resetSignal: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    void loadHCaptchaScript()
      .then(() => {
        if (!mounted || !containerRef.current || !window.hcaptcha || widgetIdRef.current !== null) {
          return;
        }

        widgetIdRef.current = window.hcaptcha.render(containerRef.current, {
          sitekey: process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY,
          callback: (nextToken: string) => onTokenChange(nextToken),
          "expired-callback": () => onTokenChange(null),
          "error-callback": () => onTokenChange(null)
        });
      })
      .catch(() => {
        onTokenChange(null);
      });

    return () => {
      mounted = false;
      if (widgetIdRef.current !== null && window.hcaptcha?.remove) {
        window.hcaptcha.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [onTokenChange]);

  useEffect(() => {
    if (widgetIdRef.current !== null && window.hcaptcha) {
      window.hcaptcha.reset(widgetIdRef.current);
      onTokenChange(null);
    }
  }, [resetSignal, onTokenChange]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} />
      {!token ? <p className="text-xs text-stone">Complete the verification check to continue.</p> : null}
    </div>
  );
}
