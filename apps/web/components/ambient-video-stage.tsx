"use client";

import { useEffect, useState } from "react";

const HERO_VIDEO_URL = "https://www.southshore.edu.gh/videos/hero.mp4";

export function AmbientVideoStage() {
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const connection = navigator as Navigator & { connection?: { saveData?: boolean } };

    if (prefersReducedMotion || connection.connection?.saveData) {
      return;
    }

    const scheduleWhenIdle = window.requestIdleCallback;
    const cancelIdleLoad = window.cancelIdleCallback;

    if (typeof scheduleWhenIdle === "function" && typeof cancelIdleLoad === "function") {
      const idleId = scheduleWhenIdle(() => setShouldLoadVideo(true), { timeout: 2_000 });
      return () => cancelIdleLoad(idleId);
    }

    const timer = globalThis.setTimeout(() => setShouldLoadVideo(true), 1_200);
    return () => globalThis.clearTimeout(timer);
  }, []);

  return (
    <div className="video-stage" aria-hidden="true">
      {shouldLoadVideo ? (
        <video
          className="video-stage__media"
          autoPlay
          loop
          muted
          playsInline
          preload="none"
        >
          <source src={HERO_VIDEO_URL} type="video/mp4" />
        </video>
      ) : null}
      <div className="video-stage__overlay" />
      <div className="video-stage__glow" />
    </div>
  );
}
