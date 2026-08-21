import { connection } from "next/server";
import { PasswordGate } from "@/components/password-gate";
import { SetupFlow } from "@/components/setup-flow";
import { hasValidSession } from "@/lib/auth";
import { getCameraUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  await connection();

  const authenticated = await hasValidSession();
  if (!authenticated) {
    return <PasswordGate />;
  }

  const cameraUrl = getCameraUrl();
  if (!cameraUrl) {
    return (
      <main className="page-shell mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col justify-center px-[max(1rem,env(safe-area-inset-left))] py-[max(1.5rem,env(safe-area-inset-bottom))] pr-[max(1rem,env(safe-area-inset-right))]">
        <h1 className="text-2xl font-semibold tracking-tight">Home Camera Access</h1>
        <p className="mt-3 text-mute">Setup is temporarily unavailable.</p>
      </main>
    );
  }

  return <SetupFlow cameraUrl={cameraUrl} />;
}
