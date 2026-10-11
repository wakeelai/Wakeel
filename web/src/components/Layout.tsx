import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useI18n } from "../i18n";
import { useTheme } from "../lib/theme";
import { useAuth } from "../lib/auth";
import { Icon, type IconName } from "./Icon";
import { CommandPalette, type PaletteItem } from "./CommandPalette";

export function LangSwitch() {
  const { lang, setLang } = useI18n();
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs dark:border-slate-700">
      <button onClick={() => setLang("ar")} className={`px-2 py-1 ${lang === "ar" ? "bg-brand-600 text-white" : "text-slate-500"}`}>العربية</button>
      <button onClick={() => setLang("en")} className={`px-2 py-1 ${lang === "en" ? "bg-brand-600 text-white" : "text-slate-500"}`}>English</button>
    </div>
  );
}

export function ThemeButton() {
  const { resolved, toggle } = useTheme();
  return (
    <button onClick={toggle} aria-label="Toggle theme" className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
      <Icon name={resolved === "dark" ? "sun" : "moon"} className="h-4 w-4" />
    </button>
  );
}

export default function Layout() {
  const { t, tr } = useI18n();
  const { profile, user, credits, logout, emailVerified, refreshVerification, resendVerification } = useAuth();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const items: (PaletteItem & { end?: boolean })[] = [
    { to: "/", icon: "plus", label: t("nav.newTask"), end: true },
    { to: "/projects", icon: "folder", label: t("nav.projects") },
    { to: "/tasks", icon: "list", label: t("nav.tasks") },
    { to: "/artifacts", icon: "box", label: t("nav.artifacts") },
    { to: "/files", icon: "file", label: t("nav.files") },
    { to: "/usage", icon: "activity", label: t("nav.usage") },
    { to: "/billing", icon: "card", label: t("nav.billing") },
    { to: "/settings", icon: "sliders", label: t("nav.settings") },
  ];
  if (profile?.role === "admin") items.push({ to: "/admin", icon: "shield", label: t("nav.admin") });

  const initial = (profile?.display_name || user?.email || "?").charAt(0).toUpperCase();

  return (
    <div className="flex h-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {open && <div className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 start-0 z-40 flex w-64 flex-col border-e border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-slate-900 lg:static ${open ? "translate-x-0" : "ltr:-translate-x-full rtl:translate-x-full"} lg:translate-x-0`}>
        <div className="flex items-center gap-2 px-5 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-500 font-bold text-white">W</div>
          <span className="text-lg font-bold">Wakeel</span>
        </div>
        <button onClick={() => setPalette(true)} className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-400 dark:border-slate-700">
          <Icon name="search" className="h-4 w-4" />{tr("Search…", "بحث…")}<kbd className="ms-auto text-[10px]">⌘K</kbd>
        </button>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} onClick={() => setOpen(false)}
              className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
              <Icon name={i.icon} className="h-4 w-4" />{i.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-3 border-t border-slate-200 p-3 dark:border-slate-800">
          <div className="flex items-center gap-2"><LangSwitch /><ThemeButton /></div>
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">{initial}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{profile?.display_name || user?.email}</div>
              <div className="text-xs text-slate-500">{credits.toLocaleString()} {t("nav.credits")}</div>
            </div>
            <button onClick={() => void logout()} title={t("nav.logout")} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Icon name="logout" className="h-4 w-4" /></button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 lg:hidden">
          <button onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <span className="font-bold">Wakeel</span>
        </header>
        {user && !emailVerified && (
          <div className="flex flex-wrap items-center gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            <Icon name="alert" className="h-4 w-4" />
            <span>{note ?? tr("Verify your email to run tasks. Check your inbox.", "فعّل بريدك الإلكتروني لتتمكن من تشغيل المهام، وراجع بريدك الوارد.")}</span>
            <button className="underline" onClick={async () => { await resendVerification(); setNote(tr("Verification email sent.", "تم إرسال رسالة التفعيل.")); }}>{tr("Resend", "إعادة الإرسال")}</button>
            <button className="underline" onClick={() => void refreshVerification()}>{tr("I've verified", "تحققت من بريدي")}</button>
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto"><Outlet /></main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} items={items} />
    </div>
  );
}
