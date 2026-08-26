"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

export interface JudgeView {
  role: string;
  label: string;
  verdict: string;
  summary: string;
  reasoning: string;
}

const VERDICT_CLASS: Record<string, string> = {
  STRONG: "verdict-strong",
  SOLID: "verdict-solid",
  NEEDS_WORK: "verdict-needs-work",
  WEAK: "verdict-weak",
  UNCLEAR: "",
};

/**
 * Collapsible judge row (blueprint §19): summary always visible,
 * reasoning on expand — the GenLayer transparency layer.
 */
export function JudgeCard({ judge, index }: { judge: JudgeView; index: number }) {
  const [open, setOpen] = useState(false);
  const pill = VERDICT_CLASS[judge.verdict] ?? "";
  const verdictLabel = judge.verdict.replace("_", " ");

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="font-mono text-[11px] font-bold text-[var(--copy-muted)]" aria-hidden>
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="text-[14.5px] font-bold text-[var(--ink)]">
              {judge.label}
            </span>
            <span className={`verdict-pill ${pill}`}>{verdictLabel}</span>
          </span>
          <span className="mt-2 block text-[14px] leading-relaxed text-[var(--copy)]">
            “{judge.summary}”
          </span>
        </span>
        <ChevronDown
          size={17}
          className={`mt-1 shrink-0 text-[var(--copy-muted)] transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="border-t border-[var(--line)] bg-[var(--surface-sunken)] px-5 py-4">
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--copy-muted)]">
            Read reasoning
          </p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--copy)]">
            {judge.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
