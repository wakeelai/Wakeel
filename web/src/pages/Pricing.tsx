import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { useAuth } from "../lib/auth";
import { PricingSection } from "../components/PricingSection";

export default function Pricing() {
  const { tr } = useI18n();
  const { credits } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold">{tr("Plans & billing", "الخطط والفوترة")}</h1>
      <p className="mb-6 mt-1 text-slate-500">{tr("Current balance", "الرصيد الحالي")}: <b>{credits.toLocaleString()}</b> {tr("credits", "اعتماد")}</p>
      <PricingSection onSelect={(p) => navigate(p.price_usd === 0 ? "/" : `/checkout/${p.id}`)} />
      <p className="mt-6 text-xs text-slate-400">
        {tr("Payments are confirmed server-side (signed webhook or admin review). Credits are added only after confirmation — never from a button click.",
            "تُؤكَّد المدفوعات على الخادم عبر Webhook موقّع أو بعد مراجعة إدارية. ولا تُضاف الاعتمادات إلا بعد التأكيد، وليس بمجرد الضغط على زر.")}
      </p>
    </div>
  );
}
