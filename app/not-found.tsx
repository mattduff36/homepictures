import "@/components/recovery.css";

export default function NotFound() {
  return <main className="vision-recovery"><h1>This page could not be found</h1>
    <p>The link may be out of date. Your cameras and private access setup are available below.</p>
    <div className="vision-recovery-actions"><a href="/watch">Open cameras</a><a href="/setup">Private access setup</a></div></main>;
}
