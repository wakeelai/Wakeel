import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { api, parseJson } from "../lib/api";
import type { PlanRow } from "../lib/types";
import { Icon } from "./Icon";

export function PricingSection({ onSelect }: { onSelect: (p: PlanRow) => void }) {
  const { tr } = useI18n();
  const [plans, setPlans] = useState<PlanRow[] | null>(null);

  useEffect(() => {
    api<{ plans: PlanRow[] }>("/api/plans").then((r) => setPlans(r.plans)).catch(() => setPlans([]));
  }, []);

  if (!plans) return <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-72" />)}</div>;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {plans.map((p) => {
        const features = parseJson<string[]>(p.features_json, []);
        const featured = p.id === "pro";
        return (
          <div key={p.id} className={`flex flex-col rounded-2xl border p-6 shadow-card ${featured ? "border-brand-500 ring-2 ring-brand-500/30" : "border-slate-200 dark:border-slate-800"} bg-white dark:bg-slate-900`}>
            <h3 className="text-lg font-semibold">{p.name}</h3>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-4xl font-bold">{p.price_usd === 0 ? "$0" : `${p.price_usd}`}</span>
              {p.price_usd > 0 && <span className="text-sm text-slate-500">USDT</span>}
            </div>
            <p className="mt-1 text-sm text-slate-500">{p.credits_included.toLocaleString()} {tr("credits", "اعتماد")}</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{f}</li>
              ))}
            </ul>
            <button onClick={() => onSelect(p)} className={`mt-6 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${featured ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"}`}>
              {p.price_usd === 0 ? tr("Start for Free", "ابدأ مجانًا") : tr("Pay with Crypto", "ادفع بالعملات الرقمية")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
