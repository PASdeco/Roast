"use client";

import { Copy, Check, Share2 } from "lucide-react";
import { useCallback, useState } from "react";

/**
 * X share flow (blueprint §24): prefilled intent URL, user edits before
 * publishing — never auto-posts. Card preview links to the OG image.
 */
export function ShareButtons({
  username,
  thesis,
  roast,
}: {
  username: string;
  thesis: string;
  roast: string;
}) {
  const [copied, setCopied] = useState(false);

  const appUrl = typeof window !== "undefined"
    ? `${window.location.origin}/roast?profile=${encodeURIComponent(username)}`
    : `/roast?profile=${encodeURIComponent(username)}`;
  const cardUrl = typeof window !== "undefined"
    ? `${window.location.origin}/share/card?username=${encodeURIComponent("@" + username)}&thesis=${encodeURIComponent(thesis)}&roast=${encodeURIComponent(roast)}`
    : "/share/card";

  const intentText =
    `GenLayer's jury just roasted my X profile 🔥\n\n` +
    `Apparently my biggest problem is:\n"${thesis}"\n\n` +
    `Roast yours:`;
  const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(intentText)}&url=${encodeURIComponent(appUrl)}`;

  const copyRoast = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        `"${thesis}"\n\n"${roast}"\n\n— the GenLayer jury, via Roast My X`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable; no-op
    }
  }, [thesis, roast]);

  return (
    <div className="card px-6 py-6">
      <p className="eyebrow">
        <Share2 size={13} strokeWidth={2.4} /> Spread the damage
      </p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--copy-muted)]">
        The post opens pre-filled — edit it however you like before publishing.
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <a
          className="btn-primary flex-1"
          href={intentUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Share my roast on X
        </a>
        <button type="button" className="btn-ghost" onClick={() => void copyRoast()}>
          {copied ? <Check size={16} className="text-[var(--good)]" /> : <Copy size={16} />}
          {copied ? "Copied" : "Copy roast"}
        </button>
      </div>

      <p className="field-help mt-4">
        Share card preview:{" "}
        <a
          href={cardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-[var(--accent)] underline decoration-[var(--accent-line)] underline-offset-2"
        >
          view your 1:1 card
        </a>
      </p>
    </div>
  );
}
