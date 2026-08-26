"use client";

import { useEffect, useState } from "react";

const STAGES = [
  { name: "Recruiter", action: "Reviewing your profile…" },
  { name: "Growth Critic", action: "Examining your presence…" },
  { name: "Content Critic", action: "Looking for substance…" },
  { name: "Profile Critic", action: "Judging your positioning…" },
  { name: "Roast Judge", action: "Preparing violence…" },
];

/**
 * Jury loading experience (blueprint §16): staged judge activation, then
 * deliberation. Purely presentational — the real work happens server-side.
 */
export function JuryLoader({ handle }: { handle: string }) {
  const [active, setActive] = useState(0);
  const [deliberating, setDeliberating] = useState(false);

  useEffect(() => {
    const step = setInterval(() => {
      setActive((current) => {
        if (current >= STAGES.length) {
          clearInterval(step);
          setDeliberating(true);
          return current;
        }
        return current + 1;
      });
    }, 1600);
    return () => clearInterval(step);
  }, []);

  return (
    <div className="mx-auto max-w-md py-16 text-center sm:py-20" aria-live="polite">
      <p className="eyebrow justify-center">
        {deliberating ? "Consensus forming" : "Summoning the jury"}
      </p>
      <h1 className="display-title mt-4 text-[30px] sm:text-[40px]">
        @{handle}
      </h1>

      <ul className="mt-10 space-y-4 text-left">
        {STAGES.map((stage, index) => {
          const done = index < active;
          const working = index === active && !deliberating;
          if (deliberating && index < STAGES.length) {
            return (
              <li key={stage.name} className="flex items-center gap-3 opacity-60">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--good)]" aria-hidden />
                <span className="text-[14px] font-semibold text-[var(--ink)]">{stage.name}</span>
                <span className="text-[13px] text-[var(--copy-muted)]">verdict submitted</span>
              </li>
            );
          }
          if (!done && !working) {
            return (
              <li key={stage.name} className="flex items-center gap-3 opacity-35">
                <span className="h-2 w-2 shrink-0 rounded-full border border-[var(--line-strong)]" aria-hidden />
                <span className="text-[14px] font-semibold text-[var(--ink)]">{stage.name}</span>
              </li>
            );
          }
          return (
            <li key={stage.name} className="flex items-center gap-3">
              <span
                className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--accent)]"
                aria-hidden
              />
              <span className="text-[14px] font-semibold text-[var(--ink)]">{stage.name}</span>
              <span className="text-[13px] text-[var(--copy-muted)]">{stage.action}</span>
            </li>
          );
        })}
      </ul>

      {deliberating && (
        <div className="mt-10 flex items-center justify-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--roast)] [animation-delay:0ms]" />
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--roast)] [animation-delay:150ms]" />
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--roast)] [animation-delay:300ms]" />
          <span className="ml-2 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--roast)]">
            The jury is deliberating
          </span>
        </div>
      )}
    </div>
  );
}
