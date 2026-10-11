import { useState } from "react";
import { useI18n, type Lang } from "../i18n";
import { useAuth } from "../lib/auth";
import { useTheme, type Theme } from "../lib/theme";
import { api } from "../lib/api";

export default function Settings() {
  const { t, tr, lang, setLang } = useI18n();
  const { profile, user, refreshProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(profile?.display_name ?? "");
  const [saved, setSaved] = useState(false);
  const field = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900";

  async function save() {
    await api("/api/auth/me", { method: "PATCH", body: { displayName: name, locale: lang, theme } });
    await refreshProfile();
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 p-6">
      <h1 className="text-2xl font-bold">{t("nav.settings")}</h1>
      <div><label className="mb-1 block text-sm font-medium">{tr("Email", "البريد الإلكتروني")}</label><input className={field} value={user?.email ?? ""} disabled /></div>
      <div><label className="mb-1 block text-sm font-medium">{tr("Display name", "الاسم المعروض")}</label><input className={field} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label className="mb-1 block text-sm font-medium">{tr("Language", "اللغة")}</label>
        <select className={field} value={lang} onChange={(e) => setLang(e.target.value as Lang)}><option value="ar">العربية</option><option value="en">English</option></select></div>
      <div><label className="mb-1 block text-sm font-medium">{tr("Theme", "المظهر")}</label>
        <select className={field} value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
          <option value="system">{tr("System", "النظام")}</option><option value="light">{tr("Light", "فاتح")}</option><option value="dark">{tr("Dark", "داكن")}</option></select></div>
      <button onClick={() => void save()} className="rounded-xl bg-brand-600 px-5 py-2 font-medium text-white hover:bg-brand-700">{saved ? "✓" : t("common.save")}</button>
    </div>
  );
}
