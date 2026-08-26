import { Gavel } from "lucide-react";

const EXAMPLE = {
  username: "@username",
  thesis:
    "You don't have a content problem. You have a 'why should I follow you?' problem.",
  roast:
    "ts profile is fighting for its life 💀 Bio giving 'I do everything' but somehow saying nothing. Your pinned post is from the stone age, your content is everywhere and your actual identity is nowhere",
};

export function ExampleRoast() {
  return (
    <section aria-label="Example evaluation" className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--line)] px-5 py-4 sm:px-6">
        <p className="eyebrow">
          <Gavel size={13} strokeWidth={2.4} /> The jury has spoken
        </p>
        <span className="verdict-pill">5 independent evaluations</span>
      </div>

      <div className="grid gap-6 px-6 py-6 sm:grid-cols-2 sm:gap-8 sm:px-8">
        <div>
          <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--copy-muted)]">
            {EXAMPLE.username} — the thesis
          </p>
          <blockquote className="thesis-quote mt-3 text-[22px] sm:text-[24px]">
            “{EXAMPLE.thesis}”
          </blockquote>
        </div>

        <div className="sm:border-l sm:border-[var(--line)] sm:pl-8">
          <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--roast)]">
            The roast
          </p>
          <blockquote className="roast-quote mt-3 text-[15px]">
            “{EXAMPLE.roast}”
          </blockquote>
        </div>
      </div>
    </section>
  );
}
