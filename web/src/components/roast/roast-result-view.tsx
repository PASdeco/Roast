import { Gavel, Scale, Wrench } from "lucide-react";
import { SiteNavbar } from "@/components/site-navbar";
import { JudgeCard, type JudgeView } from "@/components/roast/judge-card";
import { ShareButtons } from "@/components/roast/share-buttons";

export const metadata = { title: "The verdict" };

export interface RoastResult {
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  thesis: string;
  roast: string;
  improvements: { area: string; issue: string; recommendation: string }[];
  disagreement: string;
  evidence: string[];
  data_available: string[];
  judges: JudgeView[];
}

/**
 * Result view (blueprint §17–§21): thesis first, roast second, fixes,
 * then the expandable jury. Qualitative language only — no scores.
 * Currently rendered from a passed-in result; wired to the API in the
 * roast flow integration.
 */
export function RoastResultView({ result }: { result: RoastResult }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNavbar />
      <main className="container-shell max-w-4xl flex-1 py-12">
        {/* Header */}
        <p className="eyebrow eyebrow-roast">
          <Gavel size={13} strokeWidth={2.4} /> Your profile got roasted
        </p>
        <h1 className="display-title mt-3 text-[30px] sm:text-[40px]">
          @{result.username}
        </h1>
        {result.display_name && (
          <p className="mt-1 text-[14px] text-[var(--copy-muted)]">
            {result.display_name}
          </p>
        )}

        {/* Thesis — the product's core output */}
        <section className="mt-8" aria-label="The thesis">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
            The thesis
          </p>
          <blockquote className="thesis-quote mt-3 text-[24px] sm:text-[30px]">
            “{result.thesis}”
          </blockquote>
        </section>

        {/* Roast */}
        <section className="mt-10" aria-label="The roast">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--roast)]">
            The roast
          </p>
          <blockquote className="roast-quote mt-3 text-[16px]">
            “{result.roast}”
          </blockquote>
        </section>

        {/* What to fix */}
        <section className="mt-12" aria-label="What to fix">
          <p className="eyebrow">
            <Wrench size={13} strokeWidth={2.4} /> What to fix
          </p>
          <div className="mt-4 space-y-4">
            {result.improvements.map((item, index) => (
              <div key={item.area + String(index)} className="card px-5 py-5">
                <p className="flex items-baseline gap-3">
                  <span className="font-mono text-[11px] font-bold text-[var(--copy-muted)]" aria-hidden>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="font-display text-[16px] font-bold text-[var(--ink)]">
                    {item.area}
                  </span>
                </p>
                {item.issue && (
                  <p className="mt-2 pl-8 text-[13.5px] leading-relaxed text-[var(--copy-muted)]">
                    {item.issue}
                  </p>
                )}
                <p className="mt-1.5 pl-8 text-[14px] leading-relaxed text-[var(--copy)]">
                  {item.recommendation}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Disagreement — honest, no fabricated votes */}
        {result.disagreement && (
          <section className="mt-12" aria-label="Where the jury disagreed">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--copy-muted)]">
              Where the jury disagreed
            </p>
            <p className="card-sunken mt-3 px-5 py-4 text-[14px] leading-relaxed text-[var(--copy)]">
              {result.disagreement}
            </p>
          </section>
        )}

        {/* The jury */}
        <section className="mt-12" aria-label="The jury">
          <p className="eyebrow">
            <Scale size={13} strokeWidth={2.4} /> The jury
          </p>
          <p className="field-help mt-2">
            Five independent evaluations. Expand any judge to read the full
            reasoning behind their verdict.
          </p>
          <div className="mt-4 space-y-3">
            {result.judges.map((judge, index) => (
              <JudgeCard key={judge.role} judge={judge} index={index} />
            ))}
          </div>
        </section>

        {/* Evidence honesty */}
        <section className="mt-12" aria-label="Evidence">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--copy-muted)]">
            What the jury actually saw
          </p>
          <ul className="mt-3 space-y-1.5">
            {result.evidence.map((item, index) => (
              <li key={index} className="flex gap-2.5 text-[13px] leading-relaxed text-[var(--copy-muted)]">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--copy-muted)]" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Share — primary action after reading (blueprint §45) */}
        <section className="mt-12" aria-label="Share">
          <ShareButtons
            username={result.username}
            thesis={result.thesis}
            roast={result.roast}
          />
        </section>
      </main>
    </div>
  );
}
