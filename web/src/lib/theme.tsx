import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";

interface ThemeCtx {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
  toggle: () => void;
}
const Ctx = createContext<ThemeCtx | null>(null);

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem("theme") as Theme) || "system");
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setSystemDark(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const resolved: "light" | "dark" = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const value = useMemo<ThemeCtx>(
    () => ({
      theme,
      resolved,
      setTheme: (t) => {
        localStorage.setItem("theme", t);
        setThemeState(t);
      },
      toggle: () => {
        const next = resolved === "dark" ? "light" : "dark";
        localStorage.setItem("theme", next);
        setThemeState(next);
      },
    }),
    [theme, resolved],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme must be used inside ThemeProvider");
  return v;
}
