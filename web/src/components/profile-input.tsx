"use client";

import { ArrowRight, Flame } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Slice 1: input + validation only. The submit action wires into the
 * credit check and jury flow in Slices 3–5; until then it routes to
 * /roast with the handle so the flow is demonstrable end-to-end.
 */
export function ProfileInput() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function normalize(raw: string): string | null {
    let text = raw.trim();
    if (text.length === 0) return null;
    text = text.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "");
    text = text.replace(/^@+/, "").replace(/\/.*$/, "").split("?")[0];
    if (!/^[A-Za-z0-9_]{1,15}$/.test(text)) return null;
    return text.toLowerCase();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const handle = normalize(value);
    if (!handle) {
      setError(
        "That doesn't look like an X profile. Try https://x.com/username or @username.",
      );
      return;
    }
    setError(null);
    router.push(`/roast?profile=${encodeURIComponent(handle)}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor="profile-input" className="sr-only">
        Your X profile
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="profile-input"
          className="field flex-1"
          placeholder="https://x.com/username"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
        />
        <button type="submit" className="btn-roast sm:w-auto">
          <Flame size={17} strokeWidth={2.4} />
          Roast it
          <ArrowRight size={16} className="hidden sm:inline" />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2.5 text-[13px] font-medium text-[var(--roast)]">
          {error}
        </p>
      )}
    </form>
  );
}
