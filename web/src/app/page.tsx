import { Flame, Scale, ShieldCheck } from "lucide-react";
import { ExampleRoast } from "@/components/example-roast";
import { ProfileInput } from "@/components/profile-input";
import { SiteNavbar } from "@/components/site-navbar";

const JUDGES = [
  { name: "Recruiter", line: "Would they take you seriously?" },
  { name: "Growth Critic", line: "Would they follow you?" },
  { name: "Content Critic", line: "Are you saying anything?" },
  { name: "Profile Critic", line: "Does your profile know you?" },
  { name: "Roast Judge", line: "Choose violence." },
];

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNavbar />

      <main className="flex-1">
        {/* Hero */}
        <section className="container-shell pt-16 sm:pt-24">
          <p className="eyebrow">
            <Flame size={13} strokeWidth={2.4} /> GenLayer jury · zero mercy · no cap
          </p>
          <h1 className="display-title mt-5 text-[44px] sm:text-[64px] lg:text-[76px]">
            Roast My X
          </h1>
          <p className="mt-4 max-w-xl font-display text-[20px] font-semibold text-[var(--ink)] sm:text-[26px]">
            Your profile isn&apos;t as good as you think.
          </p>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--copy-muted)]">
            Give us your X profile. Our independent jury tells you what
            you&apos;re doing right, what you&apos;re doing wrong, and what to fix.
          </p>

          <div className="mt-8 max-w-2xl">
            <ProfileInput />
            <p className="field-help mt-2.5">
              One roast costs 5 credits. All five judges run on every request —
              you get one unified verdict.
            </p>
          </div>
        </section>

        {/* Example output */}
        <section className="container-shell mt-12 grid gap-6 pb-16 sm:mt-16 lg:grid-cols-[1fr_360px]">
          <ExampleRoast />

          {/* The jury panel preview */}
          <aside aria-label="The jury" className="card-sunken px-6 py-6">
            <p className="eyebrow eyebrow-roast">
              <Scale size={13} strokeWidth={2.4} /> The jury
            </p>
            <ul className="mt-4 space-y-3.5">
              {JUDGES.map((judge, index) => (
                <li key={judge.name} className="flex items-baseline gap-3 text-left">
                  <span className="w-5 shrink-0 text-right font-mono text-[11px] font-bold text-[var(--copy-muted)]" aria-hidden>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <span className="block text-[13.5px] font-bold text-[var(--ink)]">
                      {judge.name}
                    </span>
                    <span className="block text-[12.5px] leading-snug text-[var(--copy-muted)]">
                      {judge.line}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t border-[var(--line)] pt-4 text-[12.5px] leading-relaxed text-[var(--copy-muted)]">
              Every judge evaluates independently. A validator consensus must
              agree before a verdict reaches you.
            </p>
          </aside>
        </section>

        {/* Trust strip */}
        <section className="border-t border-[var(--line)] bg-[var(--surface-sunken)]">
          <div className="container-shell flex flex-wrap items-center justify-center gap-x-10 gap-y-3 py-6 text-[12.5px] font-semibold text-[var(--copy-muted)]">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck size={15} className="text-[var(--accent)]" />
              Verified payments on-chain
            </span>
            <span className="inline-flex items-center gap-2">
              <Scale size={15} className="text-[var(--accent)]" />
              Independent AI validators
            </span>
            <span className="font-mono uppercase tracking-[0.14em]">
              Zero mercy. No cap.
            </span>
          </div>
        </section>
      </main>

      <footer className="container-shell flex items-center justify-between py-6 text-[12.5px] text-[var(--copy-muted)]">
        <p>© {new Date().getFullYear()} Roast My X</p>
        <p className="font-mono">Built on GenLayer</p>
      </footer>
    </div>
  );
}
