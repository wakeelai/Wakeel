import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { useI18n } from "../i18n";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import type { PlanRow } from "../lib/types";
import { Icon } from "../components/Icon";

interface Methods { nowpayments: boolean; directWallet: { address: string; network: string; token: string; tokenContract?: string; chainId?: number } | null }
interface Created { paymentId: string; provider: "nowpayments" | "direct_wallet"; payAddress: string; payAmount: number; payCurrency: string; network?: string; tokenContract?: string; explorerUrl?: string; qrPayload?: string }
interface PaymentRow { id: string; status: string; tx_hash: string | null; amount_usd: number; credits_awarded: number | null }
const TERMINAL = ["finished", "failed", "expired", "refunded"];
const NOW_CURRENCIES = ["usdtbsc", "usdttrc20", "usdterc20"];

export default function Checkout() {
  const { planId = "" } = useParams();
  const { tr } = useI18n();
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [methods, setMethods] = useState<Methods | null>(null);
  const [currency, setCurrency] = useState("usdtbsc");
  const [created, setCreated] = useState<Created | null>(null);
  const [payment, setPayment] = useState<PaymentRow | null>(null);
  const [qr, setQr] = useState("");
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(3600);

  useEffect(() => {
    api<{ plans: PlanRow[] }>("/api/plans").then((r) => setPlan(r.plans.find((p) => p.id === planId) ?? null)).catch(() => setPlan(null));
    api<Methods>("/api/payments/methods").then(setMethods).catch(() => setMethods({ nowpayments: false, directWallet: null }));
  }, [planId]);

  useEffect(() => { if (created) void QRCode.toDataURL(created.qrPayload || created.payAddress, { margin: 1, width: 220 }).then(setQr); }, [created]);

  useEffect(() => {
    if (!created) return;
    const tick = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    const poll = setInterval(async () => {
      try {
        const r = await api<{ payment: PaymentRow }>(`/api/payments/${created.paymentId}`);
        setPayment(r.payment);
        if (r.payment.status === "finished") void refreshProfile();
        if (TERMINAL.includes(r.payment.status)) clearInterval(poll);
      } catch { /* transient — keep polling */ }
    }, 10000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [created, refreshProfile]);

  async function create(method: "nowpayments" | "direct_wallet") {
    setBusy(true); setError(null);
    try {
      const r = await api<Created>("/api/payments/create", { body: { planId, method, payCurrency: currency } });
      setCreated(r); setSecondsLeft(3600);
      setPayment({ id: r.paymentId, status: method === "nowpayments" ? "pending" : "created", tx_hash: null, amount_usd: plan?.price_usd ?? 0, credits_awarded: null });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function submitTx() {
    if (!created || !txHash.trim()) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ status: string }>(`/api/payments/${created.paymentId}/submit-tx`, { body: { txHash } });
      setPayment((p) => (p ? { ...p, status: result.status, tx_hash: txHash.toLowerCase() } : p));
      if (result.status === "finished") void refreshProfile();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const statusText: Record<string, string> = {
    created: tr("Created — waiting for your payment. BSC transfers are monitored automatically.", "أُنشئ طلب الدفع وبانتظار التحويل. تُراقَب التحويلات على شبكة BSC تلقائيًا."),
    pending: tr("Pending — waiting for the transfer", "قيد الانتظار — بانتظار وصول التحويل"),
    confirming: tr("Transfer verified — waiting for 15 BSC confirmations. Credits are added automatically.", "تم التحقق من التحويل. ننتظر 15 تأكيدًا على شبكة BSC، ثم تُضاف الاعتمادات تلقائيًا."),
    confirmed: tr("Confirmed — finalizing", "تم التأكيد — جارٍ الإنهاء"),
    finished: tr("Payment confirmed — credits added ✓", "تم تأكيد الدفع — أُضيفت الأرصدة ✓"),
    failed: tr("Payment failed", "فشلت الدفعة"),
    expired: tr("Payment expired", "انتهت صلاحية طلب الدفع"),
    refunded: tr("Refunded", "تم الاسترداد"),
    pending_review: tr("Legacy payment awaiting manual review", "دفعة قديمة بانتظار المراجعة اليدوية"),
  };

  if (!plan) return <div className="p-6"><div className="skeleton h-40" /></div>;
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const isEvm = created && /^0x[0-9a-fA-F]{40}$/.test(created.payAddress);
  const none = methods && !methods.nowpayments && !methods.directWallet;

  return (
    <div className="mx-auto max-w-lg space-y-5 p-6">
      <h1 className="text-2xl font-bold">{tr("Checkout", "إتمام الدفع")}</h1>
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div><div className="font-semibold">{plan.name}</div><div className="text-sm text-slate-500">{plan.credits_included.toLocaleString()} {tr("credits", "اعتماد")}</div></div>
        <div className="text-2xl font-bold">{plan.price_usd} <span className="text-sm font-normal text-slate-500">USDT</span></div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {none && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{tr("No payment method is configured on this server yet.", "لم تُهيَّأ أي وسيلة دفع على هذا الخادم بعد.")}</p>}

      {!created && methods && (
        <div className="space-y-3">
          {methods.nowpayments && (
            <div className="space-y-2 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="font-medium">NOWPayments <span className="text-xs font-normal text-slate-500">({tr("automatic", "تلقائي")})</span></div>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                {NOW_CURRENCIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
              </select>
              <button disabled={busy} onClick={() => void create("nowpayments")} className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50">{tr("Pay with NOWPayments", "الدفع عبر NOWPayments")}</button>
            </div>
          )}
          {methods.directWallet && (
            <div className="space-y-2 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="font-medium">{tr("Direct wallet", "الدفع مباشرةً عبر المحفظة")} <span className="text-xs font-normal text-slate-500">({methods.directWallet.token} · {methods.directWallet.network} · {tr("automatic detection and verification", "الرصد والتحقق التلقائيان")})</span></div>
              <button disabled={busy} onClick={() => void create("direct_wallet")} className="w-full rounded-xl border border-slate-300 py-2.5 font-semibold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">{tr("Pay from my wallet", "الدفع من محفظتي")}</button>
            </div>
          )}
        </div>
      )}

      {created && (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-center">
            <div className="text-lg font-bold">{tr("Pay", "ادفع")} {created.provider === "direct_wallet" ? created.payAmount.toFixed(6) : created.payAmount} {created.payCurrency.toUpperCase()}</div>
            {created.network && <div className="text-sm text-slate-500">{tr("Network", "الشبكة")}: <b>{created.network}</b></div>}
            {created.provider === "direct_wallet" && <div className="mx-auto mt-1 max-w-sm text-xs text-slate-500">{tr("This invoice includes a unique amount suffix of less than 0.01 USDT. Send the exact amount shown, including all decimals.", "يتضمن المبلغ جزءًا عشريًا فريدًا يقل عن 0.01 USDT لتمييز عملية الدفع. أرسل المبلغ المعروض كما هو، بجميع منازله العشرية.")}</div>}
          </div>
          {qr && <img src={qr} alt="QR" className="mx-auto h-44 w-44 rounded-lg border border-slate-200 bg-white p-1" />}
          <div className="break-all rounded-lg bg-slate-100 p-3 text-center font-mono text-xs dark:bg-slate-800">{created.payAddress}</div>
          <div className="flex gap-2">
            <button onClick={() => { void navigator.clipboard.writeText(created.payAddress); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-300 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
              <Icon name="copy" className="h-4 w-4" />{copied ? tr("Copied", "تم النسخ") : tr("Copy address", "نسخ العنوان")}
            </button>
            {isEvm && created.provider === "nowpayments" && <a href={`ethereum:${created.payAddress}`} className="flex flex-1 items-center justify-center rounded-xl border border-slate-300 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">{tr("Open in Wallet", "افتح في المحفظة")}</a>}
          </div>
          <p className="text-center text-xs text-slate-500">{tr("Suggested window", "المهلة المقترحة")}: {mm}:{ss}</p>
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{tr("Send only the exact token on the exact network shown. We will NEVER ask for your seed phrase or private key.", "أرسل الرمز المحدد فقط عبر الشبكة المحددة. لن نطلب منك مطلقًا عبارة الاسترداد أو مفتاحك الخاص.")}</p>
          {created.provider === "direct_wallet" && created.tokenContract && (
            <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <div className="font-semibold">{tr("Accepted token contract (check before sending)", "عنوان عقد الرمز المقبول — تحقّق منه قبل الإرسال")}</div>
              <a className="break-all font-mono underline" href={`https://bscscan.com/token/${created.tokenContract}`} target="_blank" rel="noreferrer">{created.tokenContract}</a>
              <p>{tr("This checkout verifies the BSC BEP-20 Binance-Peg BSC-USD representation commonly labelled USDT by wallets; it is not Ethereum ERC-20 or TRC-20 USDT.", "تتحقق صفحة الدفع هذه من رمز Binance-Peg BSC-USD على شبكة BSC (BEP-20)، الذي تعرضه بعض المحافظ باسم USDT. لا ترسل USDT عبر شبكتي Ethereum (ERC-20) أو Tron (TRC-20).")}</p>
            </div>
          )}

          {payment && (
            <div className={`rounded-xl p-3 text-center text-sm font-medium ${payment.status === "finished" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : ["failed", "expired"].includes(payment.status) ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" : "bg-slate-100 dark:bg-slate-800"}`}>
              {statusText[payment.status] ?? payment.status}
            </div>
          )}
          {payment?.tx_hash && created.provider === "direct_wallet" && (
            <a href={`https://bscscan.com/tx/${payment.tx_hash}`} target="_blank" rel="noreferrer" className="block text-center text-xs text-brand-600 underline">{tr("View submitted transaction on BscScan", "عرض المعاملة على BscScan")}</a>
          )}

          {created.provider === "direct_wallet" && payment && ["created", "pending"].includes(payment.status) && (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">{tr("After sending the exact amount on BSC, the system scans confirmed blocks about every five minutes and adds credits automatically. You do not need to submit a hash; paste it below only if you want an immediate check. No manual approval is required.", "بعد إرسال المبلغ المحدد عبر شبكة BSC، يفحص النظام الكتل المؤكدة تلقائيًا كل خمس دقائق تقريبًا، ثم يضيف الاعتمادات إلى رصيدك. لا يلزم إدخال معرّف المعاملة؛ الصقه أدناه إذا أردت التحقق فورًا. ولا حاجة إلى موافقة إدارية.")}</p>
              <input value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="0x…" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900" />
              <button disabled={busy || !txHash.trim()} onClick={() => void submitTx()} className="w-full rounded-xl bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">{tr("Verify transaction now (optional)", "تحقق من المعاملة الآن (اختياري)")}</button>
            </div>
          )}
          {payment?.status === "finished" && <button onClick={() => navigate("/")} className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white">{tr("Start working", "ابدأ العمل")}</button>}
        </div>
      )}
    </div>
  );
}
