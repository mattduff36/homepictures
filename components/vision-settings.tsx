"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { VisionPreferences } from "@/lib/vision-layout";

export function VisionSettings({ preferences, onChange, onClose, username, onSessions, onLogout }: {
  preferences: VisionPreferences; onChange: (next: VisionPreferences) => void; onClose: () => void;
  username: string; onSessions: () => void; onLogout: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<"viewing" | "account" | "about">("viewing");
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="vision-settings" aria-labelledby="vision-settings-title" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <header className="vision-settings-heading"><h2 id="vision-settings-title">Settings</h2><button className="vision-icon" aria-label="Close settings" onClick={onClose}>×</button></header>
    <div className="vision-settings-body">
      <nav aria-label="Settings categories">{(["viewing", "account", "about"] as const).map(value => <button key={value} aria-current={section === value ? "page" : undefined} onClick={() => setSection(value)}>{value === "viewing" ? "Viewing" : value === "account" ? "Account" : "About"}</button>)}</nav>
      <div className="vision-settings-editor">
        {section === "viewing" ? <>
          <h3>Viewing</h3><p>These preferences are saved on this device.</p>
          <label className="vision-setting">Featured wall<select value={preferences.layout} onChange={event => onChange({ ...preferences, layout: event.target.value as VisionPreferences["layout"] })}><option value="auto">Automatic</option><option value="featured">Featured</option><option value="grid">Grid</option></select><small>Automatic uses Featured on wide desktop screens and Grid on phones. Select All Cameras again in the menu to switch temporarily.</small></label>
          <label className="vision-setting">Seconds per camera<input type="number" min={5} max={3600} defaultValue={preferences.seconds} onBlur={event => { const seconds = Number(event.target.value); const value = Number.isFinite(seconds) ? Math.round(Math.max(5, Math.min(3600, seconds))) : 15; event.target.value = String(value); onChange({ ...preferences, seconds: value }); }} /><small>Tap the large picture to pause or resume rotation. Double-tap or use Expand to open it fullscreen.</small></label>
          <label className="vision-setting">Picture size<select value={preferences.fit} onChange={event => onChange({ ...preferences, fit: event.target.value as VisionPreferences["fit"] })}><option value="cover">Fill the wall</option><option value="contain">Fit the whole picture</option></select></label>
          <label className="vision-menu-toggle"><span><strong>Data Saver</strong><small>Keep Ring on snapshots, even in fullscreen.</small></span><input type="checkbox" checked={preferences.dataSaver} onChange={event => onChange({ ...preferences, dataSaver: event.target.checked })} /></label>
        </> : section === "account" ? <>
          <h3>Your account</h3><p>Signed in as <strong>{username}</strong>.</p>
          <button className="vision-menu-action" onClick={onSessions}>Manage saved sign-ins</button><p>Review the devices signed in to your account and sign out old sessions.</p>
          <button className="vision-menu-action" onClick={onLogout}>Sign out</button>
          <p>Your camera access is managed by the owner from Website accounts on the Dell.</p>
        </> : <>
          <h3>MPDEE Vision</h3><p>The same camera walls, wherever you are.</p>
          <h4>Website viewing</h4><p>Swann streams in SD, with up to five cameras at once and a 15-minute viewing limit. Ring stays on snapshots until you open a camera and press Play, for up to five minutes.</p>
          <p>Leaving the page, locking your phone or going offline stops live viewing. Press Play or Start wall to resume. Sound comes from one camera at a time.</p>
          <h4>On your phone</h4><p>Swipe between Swann, All Cameras and Ring. Controls hide after three idle seconds: tap once to show them, then tap a picture to open it. In Safari, use Share → Add to Home Screen for an app-like view.</p>
          <Link href="/setup">Private access and recording playback</Link>
        </>}
      </div>
    </div>
  </dialog>;
}
