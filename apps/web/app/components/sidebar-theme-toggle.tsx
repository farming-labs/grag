"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useState } from "react";

type SidebarThemeToggleProps = {
  variant?: "text" | "pill";
};

function applyTheme(nextIsDark: boolean) {
  const nextTheme = nextIsDark ? "dark" : "light";
  const previousTheme = nextIsDark ? "light" : "dark";

  document.documentElement.classList.remove(previousTheme);
  document.documentElement.classList.add(nextTheme);
  document.documentElement.style.colorScheme = nextTheme;

  try {
    localStorage.setItem("theme", nextTheme);
  } catch {}
}

export function SidebarThemeToggle({ variant = "text" }: SidebarThemeToggleProps) {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const syncTheme = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };

    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"]
    });

    return () => observer.disconnect();
  }, [mounted]);

  const toggle = () => {
    const nextIsDark = !isDark;
    const documentWithTransition = document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    };

    if (!documentWithTransition.startViewTransition) {
      applyTheme(nextIsDark);
      setIsDark(nextIsDark);
      return;
    }

    documentWithTransition.startViewTransition(() => {
      applyTheme(nextIsDark);
      setIsDark(nextIsDark);
    });
  };

  if (!mounted) return null;

  if (variant === "pill") {
    return (
      <button
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className="group inline-grid grid-cols-2 border bg-transparent p-0.5 font-mono text-[10px] uppercase tracking-normal transition-colors hover:opacity-90"
        data-theme-toggle
        onClick={toggle}
        style={{
          borderColor: "var(--color-fd-border)",
          color: "var(--color-fd-muted-foreground)"
        }}
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        type="button"
      >
        <span
          className="inline-flex h-7 min-w-15 items-center justify-center gap-1 border px-2 transition-colors"
          style={{
            background: !isDark ? "var(--color-fd-foreground)" : "transparent",
            borderColor: "var(--color-fd-border)",
            color: !isDark ? "var(--color-fd-background)" : "var(--color-fd-muted-foreground)"
          }}
        >
          <SunIcon aria-hidden="true" size={12} />
          Light
        </span>
        <span
          className="inline-flex h-7 min-w-15 items-center justify-center gap-1 border border-l-0 px-2 transition-colors"
          style={{
            background: isDark ? "var(--color-fd-foreground)" : "transparent",
            borderColor: "var(--color-fd-border)",
            color: isDark ? "var(--color-fd-background)" : "var(--color-fd-muted-foreground)"
          }}
        >
          <MoonIcon aria-hidden="true" size={12} />
          Dark
        </span>
      </button>
    );
  }

  return (
    <button
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex items-center gap-1 pr-1 font-mono text-[11px] uppercase tracking-normal text-black/40 dark:text-white/40"
      data-theme-toggle
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      type="button"
    >
      {isDark ? <MoonIcon aria-hidden="true" size={12} /> : <SunIcon aria-hidden="true" size={12} />}
      <span>{isDark ? "Dark" : "Light"}</span>
    </button>
  );
}
