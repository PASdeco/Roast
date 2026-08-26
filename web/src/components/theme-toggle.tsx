"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

/**
 * Both icons are always rendered and CSS picks the visible one via the
 * data-theme attribute — no mount state, no hydration mismatch.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Toggle color theme"
      className="btn-ghost !min-h-9 !rounded-lg !px-2.5"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun size={16} className="dark:hidden" />
      <Moon size={16} className="hidden dark:block" />
    </button>
  );
}
