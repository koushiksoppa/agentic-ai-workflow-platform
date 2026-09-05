"use client";

import {
  nextPreference,
  setThemePreference,
  useThemePreference,
  type ThemePreference,
} from "@/lib/theme";

const LABEL: Record<ThemePreference, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

const GLYPH: Record<ThemePreference, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

export function ThemeToggle() {
  const preference = useThemePreference();

  return (
    <button
      type="button"
      onClick={() => setThemePreference(nextPreference(preference))}
      title={`Theme: ${LABEL[preference]} — click to change`}
      aria-label={`Theme: ${LABEL[preference]}`}
      className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-[12px] text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      <span aria-hidden>{GLYPH[preference]}</span>
      <span>{LABEL[preference]}</span>
    </button>
  );
}
