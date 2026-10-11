import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { api } from "../lib/api";

interface UsageData {
  day: string; source: string; creditsBalance: number;
  providers: { provider: string; calls: number }[];
  limits: { maxFreeAiCallsPerDay: number; maxBrowserTasksPerDay: number };
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{label}</span><span className="text-slate-500">{value} / {max} · {pct}%</span></div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"><div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export default function Usage() {
  const { t, tr } = useI18n();
  const [d, setD] = useState<UsageData | null>(null);
  useEffect(() => { api<UsageData>("/api/usage").then(setD).catch(() => setD(null)); }, []);
  if (!d) return <div className="p-6"><div className="skeleton h-40" /></div>;

  const calls = (p: string) => d.providers.find((x) => x.provider === p)?.calls ?? 0;
  const total = d.providers.reduce((s, x) => s + x.calls, 0);
  const cap = d.limits.maxFreeAiCallsPerDay;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">{t("nav.usage")}</h1>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">{tr("Free AI calls today", "طلبات الذكاء الاصطناعي المجانية اليوم")}</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800">{tr("Application-estimated usage", "استخدام مُقدَّر من التطبيق")}</span>
        </div>
        <div className="space-y-4">
          <Bar label={tr("All providers (your daily cap)", "جميع المزوّدين (حدّك اليومي)")} value={total} max={cap} />
          <Bar label="Groq" value={calls("groq")} max={cap} />
          <Bar label="OpenRouter" value={calls("openrouter")} max={cap} />
          <Bar label="Workers AI" value={calls("cloudflare_ai")} max={cap} />
          <Bar label={tr("Browser tasks", "مهام المتصفح")} value={calls("browser_use")} max={d.limits.maxBrowserTasksPerDay} />
        </div>
        <p className="mt-4 text-xs text-slate-500">
          {tr("These counters come from this app's own records (UTC day ", "تستند هذه العدادات إلى سجلات التطبيق نفسه (وفق توقيت UTC، بتاريخ ")}{d.day}
          {tr("). They are not the providers' real remaining quota, which we generally can't see. When a free quota runs out we try the next free provider — we never switch to a paid one.",
              "). ولا تمثل الحصة المتبقية فعليًا لدى المزوّدين، إذ لا يمكننا عادةً الاطلاع عليها. عند نفاد الحصة المجانية لمزوّد ما، نحاول استخدام مزوّد مجاني آخر، ولا ننتقل أبدًا إلى مزوّد مدفوع.")}
        </p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm text-slate-500">{tr("Credits balance", "رصيد الاعتمادات")}</div>
        <div className="text-3xl font-bold">{d.creditsBalance.toLocaleString()}</div>
      </div>
    </div>
  );
}
