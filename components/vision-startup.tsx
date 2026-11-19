"use client";

import { useEffect, useRef, useState } from "react";

/** The exact Dell artwork, with a bounded reveal suitable for signed-in web viewing. */
export function VisionStartup({ ready, onComplete }: { ready: boolean; onComplete: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [animationDone, setAnimationDone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [skippable, setSkippable] = useState(false);
  const completed = useRef(false);
  const finishRef = useRef(onComplete);
  useEffect(() => { finishRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    const media = video.current;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finish = () => setAnimationDone(true);
    const minimum = setTimeout(() => setSkippable(true), 1200);
    const maximum = setTimeout(finish, 6500);
    const absolute = setTimeout(() => setLeaving(true), 15000);
    if (reduced) {
      const still = setTimeout(finish, 350);
      return () => { clearTimeout(still); clearTimeout(minimum); clearTimeout(maximum); clearTimeout(absolute); };
    }
    void media?.play().catch(finish);
    return () => { clearTimeout(minimum); clearTimeout(maximum); clearTimeout(absolute); media?.pause(); };
  }, []);

  useEffect(() => {
    if (!ready || !animationDone) return;
    const timer = setTimeout(() => setLeaving(true), 120);
    return () => clearTimeout(timer);
  }, [ready, animationDone]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      if (completed.current) return;
      completed.current = true;
      finishRef.current();
    }, 360);
    return () => clearTimeout(timer);
  }, [leaving]);

  return <div className={`vision-startup${leaving ? " is-leaving" : ""}`} role="status" aria-label="Starting MPDEE Vision">
    <video ref={video} muted playsInline preload="auto" poster="/branding/vision-splash.png"
      src="/MPDEE-Vision2.mp4" aria-hidden="true" tabIndex={-1} disablePictureInPicture
      onEnded={() => setAnimationDone(true)} onError={() => setAnimationDone(true)} />
    <div className="vision-startup-loading"><span className="vision-startup-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{ready ? "Opening Vision…" : "Connecting to Vision…"}</span>
      {skippable ? <button onClick={() => setLeaving(true)}>Tap or click to skip</button> : null}
    </div>
    <span className="vision-startup-version">MPDEE Vision · Web</span>
  </div>;
}
