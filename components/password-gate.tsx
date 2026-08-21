"use client";

import { FormEvent, useId, useState } from "react";
import { Eye } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlash } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { LockSimple } from "@phosphor-icons/react/dist/csr/LockSimple";

type GateError = "invalid" | "rate" | "unavailable" | "network" | null;

function errorMessage(error: GateError): string {
  switch (error) {
    case "invalid":
      return "Incorrect password";
    case "rate":
      return "Too many attempts. Try again later.";
    case "unavailable":
      return "Setup is temporarily unavailable.";
    case "network":
      return "Unable to reach the setup page. Check your connection and try again.";
    default:
      return "";
  }
}

export function PasswordGate() {
  const passwordId = useId();
  const errorId = useId();
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<GateError>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (response.status === 429) {
        setError("rate");
        return;
      }

      if (response.status === 503) {
        setError("unavailable");
        return;
      }

      if (!response.ok) {
        setError("invalid");
        return;
      }

      window.location.replace("/setup");
    } catch {
      setError("network");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell grid min-h-[100dvh] w-full items-center gap-10 px-[max(1.25rem,env(safe-area-inset-left))] pt-[max(2rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(7rem,calc(env(safe-area-inset-bottom)+6rem))] lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-16 lg:pb-[max(2rem,env(safe-area-inset-bottom))] xl:grid-cols-[minmax(0,1fr)_26rem] xl:gap-24">
      <div>
        <div className="mb-6 flex items-center gap-2 text-mute">
          <LockSimple size={18} weight="regular" aria-hidden="true" />
          <span className="text-sm">Locked</span>
        </div>

        <h1 className="text-[1.75rem] font-semibold tracking-tight lg:text-4xl">
          Home Camera Access
        </h1>
        <p className="mt-2 max-w-xl text-mute">Private authorised access only.</p>
      </div>

      <form className="lg:panel lg:p-6" onSubmit={onSubmit} noValidate>
        <label className="mb-2 block text-sm font-medium" htmlFor={passwordId}>
          Password
        </label>
        <div className="relative">
          <input
            id={passwordId}
            className="field"
            type={visible ? "text" : "password"}
            name="password"
            autoComplete="current-password"
            spellCheck={false}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={error === "invalid"}
            aria-describedby={error ? errorId : undefined}
            disabled={loading}
            required
          />
          <button
            type="button"
            className="absolute top-1/2 right-1.5 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-mute hover:text-ink"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
          >
            {visible ? (
              <EyeSlash size={20} weight="regular" aria-hidden="true" />
            ) : (
              <Eye size={20} weight="regular" aria-hidden="true" />
            )}
          </button>
        </div>

        {error ? (
          <p
            id={errorId}
            className="mt-3 text-sm text-danger"
            role="alert"
            aria-live="polite"
          >
            {errorMessage(error)}
          </p>
        ) : null}

        <div className="setup-sticky-cta mt-6">
          <button
            className="btn btn-primary w-full"
            type="submit"
            data-setup-cta="primary"
            disabled={loading || password.length === 0}
            aria-busy={loading}
          >
            {loading ? "Unlocking..." : "Unlock"}
          </button>
        </div>
      </form>
    </main>
  );
}
