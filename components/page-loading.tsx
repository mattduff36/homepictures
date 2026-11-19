import "./recovery.css";

export function PageLoading() {
  return <main className="vision-recovery"><h1>Opening MPDEE Vision</h1><p role="status">Loading the page…</p>
    <p>If this takes longer than expected, check your connection and reload.</p>
    <div className="vision-recovery-actions"><a href="/watch">Open cameras again</a><a href="/setup">Private access setup</a></div></main>;
}
